import http from 'node:http'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AddressInfo } from 'node:net'
import { serveStatic } from './server'
import { store } from './store'
import { publish, subscribe } from './hub'
import { fetchMeta } from './meta'
import type { DataKind, LanInfo } from '@shared/types'

const MAX_BODY = 8 * 1024 * 1024

let server: http.Server | null = null
let listenPort = 0
let lastError: string | undefined
const sseClients = new Set<http.ServerResponse>()
let unsubscribe: (() => void) | null = null

/** この Mac の LAN 上の IPv4 アドレス（en0 などを優先） */
export function lanAddresses(): string[] {
  const out: { name: string; addr: string }[] = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      out.push({ name, addr: i.address })
    }
  }
  const rank = (n: string): number => (n.startsWith('en') ? 0 : n.startsWith('bridge') ? 2 : 1)
  out.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  return out.map(o => o.addr)
}

/** 配布用 APK の場所: アプリ同梱の resources/ または開発ツリーの dist/ */
export function findApk(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'ShuffleTube.apk'),
    path.join(app.getAppPath(), '..', '..', 'ShuffleTube.apk'),
    path.join(process.cwd(), 'dist', 'ShuffleTube.apk'),
  ]
  for (const c of candidates) { try { if (fs.existsSync(c) && fs.statSync(c).size > 0) return c } catch { /* ignore */ } }
  return null
}

export function lanInfo(): LanInfo {
  const port = server ? listenPort : 0
  return {
    enabled: !!server,
    port,
    urls: server ? lanAddresses().map(a => `http://${a}:${port}/`) : [],
    error: lastError,
    apk: !!findApk(),
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function broadcast(kind: DataKind, data: unknown, clientId: string): void {
  const payload = `event: change\ndata: ${JSON.stringify({ kind, data, clientId })}\n\n`
  for (const c of sseClients) {
    try { c.write(payload) } catch { sseClients.delete(c) }
  }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, root: string): Promise<void> {
  const url = new URL(req.url || '/', 'http://x')
  const p = url.pathname
  if (p.startsWith('/api/')) {
    if (p === '/api/data' && req.method === 'GET') {
      json(res, 200, { playlists: store.loadPlaylists(), library: store.loadLibrary(), history: store.loadHistory() })
      return
    }
    const putKind: Record<string, DataKind> = { '/api/playlists': 'playlists', '/api/library': 'library', '/api/history': 'history' }
    if (putKind[p] && req.method === 'PUT') {
      const clientId = String(req.headers['x-client-id'] || 'lan')
      let data: unknown
      try { data = JSON.parse(await readBody(req)) } catch { json(res, 400, { error: 'bad json' }); return }
      if (!Array.isArray(data)) { json(res, 400, { error: 'array expected' }); return }
      publish(putKind[p], data, clientId)
      json(res, 200, { ok: true })
      return
    }
    const meta = p.match(/^\/api\/meta\/([A-Za-z0-9_-]{11})$/)
    if (meta && req.method === 'GET') {
      json(res, 200, await fetchMeta(meta[1]))
      return
    }
    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      sseClients.add(res)
      const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* ignore */ } }, 25000)
      req.on('close', () => { clearInterval(ping); sseClients.delete(res) })
      return
    }
    json(res, 404, { error: 'not found' })
    return
  }
  // Android 版 APK（dist/ にあれば配信。スマホの Chrome でこの URL を開いてインストール）
  if (p === '/app.apk' && req.method === 'GET') {
    const apk = findApk()
    if (!apk) { res.writeHead(404); res.end('APK がありません'); return }
    const st = fs.statSync(apk)
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': st.size,
      'Content-Disposition': 'attachment; filename="ShuffleTube.apk"',
      'Cache-Control': 'no-store',
    })
    fs.createReadStream(apk).pipe(res)
    return
  }
  // SPA: 未知のパスは index.html
  if (!serveStatic(root, req, res)) {
    req.url = '/'
    if (!serveStatic(root, req, res)) { res.writeHead(404); res.end('not found') }
  }
}

/** 0.0.0.0:port で待ち受ける。port が使用中なら +1 して最大 10 回試す */
export async function startLanServer(root: string, port: number): Promise<LanInfo> {
  await stopLanServer()
  lastError = undefined
  for (let i = 0; i < 10; i++) {
    const tryPort = port + i
    const srv = http.createServer((req, res) => {
      handle(req, res, root).catch(e => { console.warn('[lan]', e); try { res.writeHead(500); res.end() } catch { /* ignore */ } })
    })
    const ok = await new Promise<boolean>(resolve => {
      srv.once('error', () => resolve(false))
      srv.listen(tryPort, '0.0.0.0', () => resolve(true))
    })
    if (ok) {
      server = srv
      listenPort = (srv.address() as AddressInfo).port
      unsubscribe = subscribe(broadcast)
      console.log('[lan] listening on', listenPort)
      return lanInfo()
    }
    srv.removeAllListeners()
  }
  lastError = `ポート ${port}〜${port + 9} が全て使用中です`
  return lanInfo()
}

export function stopLanServer(): Promise<void> {
  return new Promise(resolve => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null }
    for (const c of sseClients) { try { c.end() } catch { /* ignore */ } }
    sseClients.clear()
    if (!server) { resolve(); return }
    const s = server
    server = null
    listenPort = 0
    s.close(() => resolve())
    // keep-alive 接続を待たない
    setTimeout(resolve, 500)
  })
}
