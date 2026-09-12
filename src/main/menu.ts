import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { Command, Settings } from '@shared/types'

export function buildMenu(win: () => BrowserWindow | null, settings: () => Settings): void {
  const send = (cmd: Command) => () => { const w = win(); if (w) w.webContents.send('command', cmd) }
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = []
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: 'ShuffleTube について' },
        { type: 'separator' },
        { label: '設定…', accelerator: 'Command+,', click: send('settings') },
        { type: 'separator' },
        { role: 'hide', label: 'ShuffleTube を隠す' },
        { role: 'hideOthers', label: 'ほかを隠す' },
        { role: 'unhide', label: 'すべてを表示' },
        { type: 'separator' },
        { role: 'quit', label: 'ShuffleTube を終了' },
      ],
    })
  }
  template.push({
    label: 'ファイル',
    submenu: [
      { label: '新規プレイリスト', accelerator: 'CmdOrCtrl+N', click: send('new-playlist') },
      { label: 'URL を追加…', accelerator: 'CmdOrCtrl+L', click: send('focus-url') },
      { type: 'separator' },
      { label: 'プレイリストを書き出し…', accelerator: 'CmdOrCtrl+S', click: send('export') },
      { label: 'プレイリストを読み込み…', accelerator: 'CmdOrCtrl+O', click: send('import') },
      { type: 'separator' },
      ...(isMac ? [] : [{ label: '設定…', accelerator: 'Ctrl+,', click: send('settings') } as MenuItemConstructorOptions, { type: 'separator' } as MenuItemConstructorOptions]),
      isMac ? { role: 'close', label: 'ウィンドウを閉じる' } : { role: 'quit', label: '終了' },
    ],
  })
  template.push({
    label: '編集',
    submenu: [
      { role: 'undo', label: '取り消す' },
      { role: 'redo', label: 'やり直す' },
      { type: 'separator' },
      { role: 'cut', label: 'カット' },
      { role: 'copy', label: 'コピー' },
      { role: 'paste', label: 'ペースト' },
      { role: 'selectAll', label: 'すべてを選択' },
    ],
  })
  template.push({
    label: '再生',
    submenu: [
      { label: '再生 / 一時停止', accelerator: 'CmdOrCtrl+P', click: send('play-pause') },
      { label: '次のクリップ', accelerator: 'CmdOrCtrl+Right', click: send('next') },
      { label: '前のクリップ', accelerator: 'CmdOrCtrl+Left', click: send('prev') },
      { type: 'separator' },
      { label: 'シャッフル', type: 'checkbox', checked: settings().shuffle, accelerator: 'CmdOrCtrl+Shift+S', click: send('toggle-shuffle') },
      { label: `リピート切替（現在: ${{ off: 'オフ', all: '全曲', one: '1曲' }[settings().loop]}）`, accelerator: 'CmdOrCtrl+Shift+R', click: send('cycle-loop') },
      { type: 'separator' },
      { label: '開始点 = 現在位置', accelerator: 'CmdOrCtrl+[', click: send('mark-start') },
      { label: '終了点 = 現在位置', accelerator: 'CmdOrCtrl+]', click: send('mark-end') },
      { label: 'この区間をクリップとして追加', accelerator: 'CmdOrCtrl+Enter', click: send('add-clip') },
    ],
  })
  const viewSub: MenuItemConstructorOptions[] = [
    { label: 'ライブラリ', accelerator: 'CmdOrCtrl+Shift+L', click: send('show-library') },
    { type: 'separator' },
    { label: 'ミニプレーヤー', type: 'checkbox', checked: settings().miniPlayer, accelerator: 'CmdOrCtrl+Shift+M', click: send('toggle-mini') },
    { label: '常に最前面', type: 'checkbox', checked: settings().alwaysOnTop, accelerator: 'CmdOrCtrl+Shift+T', click: send('toggle-top') },
    { type: 'separator' },
    { role: 'togglefullscreen', label: 'フルスクリーン' },
  ]
  if (!app.isPackaged) {
    viewSub.push({ type: 'separator' }, { role: 'reload', label: '再読み込み' }, { role: 'toggleDevTools', label: '開発者ツール' })
  }
  template.push({ label: '表示', submenu: viewSub })
  template.push({
    label: 'ウィンドウ',
    role: 'window',
    submenu: [
      { role: 'minimize', label: 'しまう' },
      { role: 'zoom', label: '拡大 / 縮小' },
      { type: 'separator' },
      { role: 'front', label: 'すべてを手前に移動' },
    ],
  })
  template.push({
    label: 'ヘルプ',
    role: 'help',
    submenu: [
      { label: 'データフォルダを開く', click: () => { shell.openPath(app.getPath('userData')) } },
    ],
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
