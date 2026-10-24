import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { LanInfo, MediaKeysStatus, Settings } from '@shared/types'
import { clearHistory, toast, updateSettings, useStore } from '../store'

interface Row { key: keyof Settings; label: string; desc: string; web?: boolean }
const ROWS: Row[] = [
  { key: 'mediaKeys', label: 'メディアキー', desc: 'キーボードの 前 / 再生停止 / 次 のメディアキー。アプリが背面でも効きます。' },
  { key: 'alwaysOnTop', label: '常に最前面', desc: 'ウィンドウを他のアプリより前に表示します。' },
  { key: 'miniPlayer', label: 'ミニプレーヤー', desc: '小さな窓で再生します（Command + Shift + M）。' },
  { key: 'rememberVolume', label: '音量・再生速度を記憶', desc: '終了時の音量と速度を次回起動時に復元します。', web: true },
  { key: 'history', label: '視聴履歴を記録', desc: '再生したクリップを最大 500 件記録します（「履歴」）。', web: true },
  { key: 'preventSleep', label: '再生中はスリープしない', desc: '再生中は画面をスリープ・オフさせません。一時停止で解除。', web: true },
]

export default function SettingsDialog(): JSX.Element {
  const settings = useStore(s => s.settings)
  const historyCount = useStore(s => s.history.length)
  const isWeb = useStore(s => s.isWeb)
  const rows = isWeb ? ROWS.filter(r => r.web) : ROWS
  const [lan, setLan] = useState<LanInfo | null>(null)
  const [qr, setQr] = useState<string>('')
  useEffect(() => {
    if (isWeb) return
    let alive = true
    const load = (): void => { window.api.lanInfo().then(i => { if (alive) setLan(i) }).catch(() => { /* ignore */ }) }
    load()
    const t = window.setTimeout(load, 800)
    return () => { alive = false; window.clearTimeout(t) }
  }, [isWeb, settings.lanServer, settings.lanPort])
  useEffect(() => {
    const url = lan?.urls[0]
    if (!url) { setQr(''); return }
    QRCode.toDataURL(url, { margin: 1, width: 200, color: { dark: '#000000', light: '#ffffff' } }).then(setQr).catch(() => setQr(''))
  }, [lan])
  const close = (): void => useStore.setState({ settingsOpen: false })
  const [mk, setMk] = useState<MediaKeysStatus | null>(null)
  useEffect(() => { window.api.mediaKeysStatus().then(setMk).catch(() => setMk(null)) }, [settings.mediaKeys])
  const requestAccess = async (): Promise<void> => {
    const st = await window.api.requestAccessibility()
    setMk(st)
    if (st.registered) toast('メディアキーを登録しました')
    else toast('許可後にアプリを再起動すると有効になります')
  }
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="dialog" role="dialog" aria-label="設定">
        <div className="dialog-head">
          <h2>設定</h2>
          <button className="icon-btn" onClick={close} title="閉じる (Esc)">✕</button>
        </div>
        <div className="settings-rows">
          {rows.map(r => {
            const on = !!settings[r.key]
            return (
              <label key={r.key} className="setting-row">
                <div className="sr-text">
                  <div className="sr-label">{r.label}</div>
                  <div className="sr-desc">{r.desc}</div>
                </div>
                <span className={'switch' + (on ? ' on' : '')}>
                  <input type="checkbox" checked={on} onChange={e => updateSettings({ [r.key]: e.target.checked } as Partial<Settings>)} />
                  <span className="knob" />
                </span>
              </label>
            )
          })}
        </div>
        {!isWeb && (
          <div className="lan-section">
            <label className="setting-row">
              <div className="sr-text">
                <div className="sr-label">スマホ連携（同じ Wi-Fi に公開）</div>
                <div className="sr-desc">この Mac がサーバーになり、同じネットワークのスマホのブラウザから同じプレイリスト・ライブラリを使えます。</div>
              </div>
              <span className={'switch' + (settings.lanServer ? ' on' : '')}>
                <input type="checkbox" checked={settings.lanServer} onChange={e => updateSettings({ lanServer: e.target.checked })} />
                <span className="knob" />
              </span>
            </label>
            {settings.lanServer && (
              <div className="lan-body">
                {lan?.enabled ? (
                  <>
                    <div className="lan-urls">
                      <div className="sr-desc">スマホの Chrome でこの URL を開く（QR をカメラで読み取っても開けます）</div>
                      {lan.urls.map(u => <div key={u} className="lan-url">{u}</div>)}
                      {lan.urls.length === 0 && <div className="sr-desc">Wi-Fi の IP アドレスが見つかりません。ネットワーク接続を確認してください。</div>}
                      {lan.urls.length > 0 && (
                        <div className="sr-desc">
                          ホーム画面に置く: スマホの Chrome で開き、右上の ⋮ →「ホーム画面に追加」。
                          {lan.localUrl && <> PC の IP が変わっても切れない URL: <b className="lan-apk">{lan.localUrl}</b>（スマホによっては開けません。そのときは上の URL を使う）</>}
                        </div>
                      )}
                    </div>
                    {qr && <img className="lan-qr" src={qr} alt="QR" />}
                  </>
                ) : (
                  <div className="sr-desc">{lan?.error || '起動中…'}</div>
                )}
                <div className="sf-note">初回は macOS のファイアウォールが「接続を許可しますか」と聞くことがあります。許可してください。</div>
              </div>
            )}
          </div>
        )}
        {isWeb && !window.matchMedia('(display-mode: standalone)').matches && (
          <div className="lan-section">
            <div className="setting-row" style={{ cursor: 'default' }}>
              <div className="sr-text">
                <div className="sr-label">ホーム画面に置く</div>
                <div className="sr-desc">Chrome 右上の ⋮ →「ホーム画面に追加」で、このページのショートカットをホーム画面に作れます。</div>
              </div>
            </div>
          </div>
        )}
        <div className="settings-foot">
          <div className="sf-line">記憶中の音量: <b>{Math.round(settings.volume)}</b>　再生速度: <b>{settings.playbackRate}x</b></div>
          <div className="sf-line">
            視聴履歴: <b>{historyCount}</b> 件
            {historyCount > 0 && <button className="text-btn small danger" onClick={() => { if (window.confirm('視聴履歴を全て消去しますか？')) clearHistory() }}>消去</button>}
          </div>
          {!isWeb && settings.mediaKeys && mk && (
            <div className="sf-line">
              メディアキー: <b>{mk.registered ? '有効' : '未登録'}</b>
              {!mk.trusted && <>
                <span className="sf-warn">アクセシビリティの許可が必要です</span>
                <button className="text-btn small" onClick={requestAccess}>許可を求める…</button>
              </>}
            </div>
          )}
          {!isWeb && window.api.platform === 'darwin' && (
            <div className="sf-note">
              メディアキーが効かない場合は「システム設定 → プライバシーとセキュリティ → アクセシビリティ」でこのアプリを許可し、アプリを再起動してください。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
