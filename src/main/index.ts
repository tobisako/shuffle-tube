import { app, BrowserWindow, dialog, globalShortcut, ipcMain, powerSaveBlocker, screen, shell, systemPreferences } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { store } from './store'
import { startStaticServer } from './server'
import { buildMenu } from './menu'
import { ELECTRON_CLIENT, publish, subscribe } from './hub'
import { fetchMeta } from './meta'
import { lanInfo, startLanServer, stopLanServer } from './lan'
import type { Command, HistoryEntry, LibraryVideo, MediaKeysStatus, Playlist, Settings } from '@shared/types'

// 動作確認用: YTPL_DEBUG_PORT=9222 で Chrome DevTools Protocol を開く
if (process.env.YTPL_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.YTPL_DEBUG_PORT)
}

const NORMAL_MIN = { width: 760, height: 520 }
const MINI_SIZE = { width: 440, height: 336 }
const MINI_MIN = { width: 320, height: 260 }

let win: BrowserWindow | null = null
let settings: Settings = store.loadSettings()
let isMini = false
let normalBounds: Electron.Rectangle | null = null
let isPlaying = false
let blockerId: number | null = null
let boundsTimer: NodeJS.Timeout | null = null
let mediaKeysRegistered = false

function send(cmd: Command): void {
  if (win && !win.isDestroyed()) win.webContents.send('command', cmd)
}

/* ---------- 設定の副作用 ---------- */
function applyMediaKeys(): void {
  globalShortcut.unregisterAll()
  mediaKeysRegistered = false
  if (!settings.mediaKeys) return
  const results: Record<string, boolean> = {}
  for (const [key, cmd] of [['MediaPlayPause', 'play-pause'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'prev']] as [string, Command][]) {
    try { results[key] = globalShortcut.register(key, () => send(cmd)) } catch (e) { results[key] = false; console.warn('[media-keys]', key, e) }
  }
  mediaKeysRegistered = Object.values(results).every(Boolean)
  if (!mediaKeysRegistered) {
    const trusted = process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : true
    console.warn('[media-keys] 登録結果:', JSON.stringify(results), 'アクセシビリティ許可:', trusted)
  }
}

function mediaKeysStatus(): MediaKeysStatus {
  return {
    registered: mediaKeysRegistered,
    trusted: process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : true,
  }
}

function applySleepBlocker(): void {
  const want = isPlaying && settings.preventSleep
  if (want && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-display-sleep')
  } else if (!want && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

function applyAlwaysOnTop(): void {
  if (!win) return
  win.setAlwaysOnTop(isMini || settings.alwaysOnTop, 'floating')
}

function applyMini(): void {
  if (!win) return
  const want = settings.miniPlayer
  if (want === isMini) return
  isMini = want
  if (want) {
    normalBounds = win.getBounds()
    const wa = screen.getDisplayMatching(normalBounds).workArea
    win.setMinimumSize(MINI_MIN.width, MINI_MIN.height)
    win.setBounds({
      width: MINI_SIZE.width,
      height: MINI_SIZE.height,
      x: wa.x + wa.width - MINI_SIZE.width - 16,
      y: wa.y + wa.height - MINI_SIZE.height - 16,
    }, true)
  } else {
    win.setMinimumSize(NORMAL_MIN.width, NORMAL_MIN.height)
    if (normalBounds) win.setBounds(normalBounds, true)
  }
  applyAlwaysOnTop()
}

let rendererRoot = ''
async function applyLan(): Promise<void> {
  if (settings.lanServer) {
    const info = await startLanServer(rendererRoot, settings.lanPort || 8787)
    if (!info.enabled) console.warn('[lan]', info.error)
  } else {
    await stopLanServer()
  }
}

function applySettings(prev: Settings): void {
  if (prev.mediaKeys !== settings.mediaKeys) applyMediaKeys()
  if (prev.lanServer !== settings.lanServer || prev.lanPort !== settings.lanPort) applyLan()
  if (prev.preventSleep !== settings.preventSleep) applySleepBlocker()
  if (prev.miniPlayer !== settings.miniPlayer) applyMini()
  if (prev.alwaysOnTop !== settings.alwaysOnTop) applyAlwaysOnTop()
  if (prev.shuffle !== settings.shuffle || prev.loop !== settings.loop ||
      prev.miniPlayer !== settings.miniPlayer || prev.alwaysOnTop !== settings.alwaysOnTop) {
    buildMenu(() => win, () => settings)
  }
}

/* ---------- ウィンドウ ---------- */
async function createWindow(): Promise<void> {
  const b = settings.windowBounds
  win = new BrowserWindow({
    width: b?.width ?? 1100,
    height: b?.height ?? 760,
    x: b?.x,
    y: b?.y,
    minWidth: NORMAL_MIN.width,
    minHeight: NORMAL_MIN.height,
    show: false,
    title: 'ShuffleTube',
    backgroundColor: '#0f0f0f',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // 画面外に復元されないように
  if (b) {
    const inAny = screen.getAllDisplays().some(d => {
      const a = d.workArea
      return (b.x ?? 0) >= a.x - 50 && (b.y ?? 0) >= a.y - 50 && (b.x ?? 0) < a.x + a.width && (b.y ?? 0) < a.y + a.height
    })
    if (!inAny) win.center()
  }

  win.once('ready-to-show', () => { win?.show() })
  win.on('closed', () => { win = null })

  const saveBounds = (): void => {
    if (!win || isMini || win.isFullScreen()) return
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win || isMini) return
      settings = { ...settings, windowBounds: win.getBounds() }
      store.saveSettings(settings)
    }, 500)
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  // 外部リンクは既定ブラウザで
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) e.preventDefault()
  })

  rendererRoot = path.join(__dirname, '../renderer')
  if (process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    const url = await startStaticServer(rendererRoot)
    await win.loadURL(url)
  }

  // 起動時のミニプレーヤー状態を適用
  if (settings.miniPlayer) { isMini = false; applyMini() }
  applyAlwaysOnTop()
}

/* ---------- IPC ---------- */
function registerIpc(): void {
  ipcMain.handle('data:load', () => ({
    playlists: store.loadPlaylists(),
    settings,
    history: store.loadHistory(),
    library: store.loadLibrary(),
  }))
  ipcMain.handle('playlists:save', (_e, playlists: Playlist[]) => { publish('playlists', playlists, ELECTRON_CLIENT) })
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const prev = settings
    settings = { ...settings, ...patch }
    store.saveSettings(settings)
    applySettings(prev)
    return settings
  })
  ipcMain.handle('history:save', (_e, entries: HistoryEntry[]) => { publish('history', entries, ELECTRON_CLIENT) })
  ipcMain.handle('library:save', (_e, videos: LibraryVideo[]) => { publish('library', videos, ELECTRON_CLIENT) })
  // スマホなど他クライアントの変更を renderer に転送
  subscribe((kind, data, clientId) => {
    if (clientId === ELECTRON_CLIENT) return
    if (win && !win.isDestroyed()) win.webContents.send('data:changed', { kind, data, clientId })
  })
  ipcMain.on('playback:state', (_e, playing: boolean) => { isPlaying = !!playing; applySleepBlocker() })
  ipcMain.handle('meta:fetch', (_e, videoId: string) => fetchMeta(videoId))
  ipcMain.handle('lan:info', () => lanInfo())
  ipcMain.handle('dialog:export', async (_e, json: string, suggestedName: string) => {
    if (!win) return false
    const r = await dialog.showSaveDialog(win, {
      title: 'プレイリストを書き出し',
      defaultPath: path.join(app.getPath('downloads'), suggestedName),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (r.canceled || !r.filePath) return false
    fs.writeFileSync(r.filePath, json, 'utf8')
    return true
  })
  ipcMain.handle('dialog:import', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, {
      title: 'プレイリストを読み込み',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (r.canceled || !r.filePaths[0]) return null
    return fs.readFileSync(r.filePaths[0], 'utf8')
  })
  ipcMain.handle('mediaKeys:status', () => mediaKeysStatus())
  ipcMain.handle('mediaKeys:requestAccess', () => {
    // macOS のシステムダイアログでアクセシビリティ許可を求める（ユーザー操作起点）
    if (process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true)
    applyMediaKeys()
    return mediaKeysStatus()
  })
  ipcMain.on('shell:open', (_e, url: string) => {
    if (/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) shell.openExternal(url)
  })
}

/* ---------- ライフサイクル ---------- */
app.whenReady().then(async () => {
  app.setName('ShuffleTube')
  registerIpc()
  buildMenu(() => win, () => settings)
  await createWindow()
  applyMediaKeys()
  applyLan()

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  stopLanServer()
  globalShortcut.unregisterAll()
  if (blockerId !== null) powerSaveBlocker.stop(blockerId)
})
