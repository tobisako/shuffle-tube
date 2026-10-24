import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com https://s.ytimg.com",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "img-src 'self' https://i.ytimg.com https://*.ytimg.com https://*.ggpht.com data:",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
].join('; ')

/** root 配下の静的ファイルを返す。該当が無ければ false */
export function serveStatic(root: string, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const rootAbs = path.resolve(root)
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p === '/' || p === '') p = '/index.html'
  const file = path.normalize(path.join(rootAbs, p))
  if (!file.startsWith(rootAbs)) { res.writeHead(403); res.end(); return true }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false
  const data = fs.readFileSync(file)
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Security-Policy': CSP,
    'Cache-Control': 'no-cache',
  })
  res.end(data)
  return true
}

/**
 * 本番用: renderer を 127.0.0.1 の空きポートから配信し、http://localhost:<port>/ で読み込む。
 * file:// で読み込むと YouTube 埋め込みが Referer 無しでエラー 153 になるため。
 * また http://127.0.0.1:<port>/ のような IP アドレスのページだと、一部の動画（Ado の公式動画など）が
 * エラー 150（埋め込み禁止）になる（2026-10-23 に確認。localhost の名前なら再生できる）。
 */
export function startStaticServer(root: string): Promise<string> {
  const server = http.createServer((req, res) => {
    if (!serveStatic(root, req, res)) { res.writeHead(404); res.end('not found') }
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve(`http://localhost:${port}/`)
    })
  })
}
