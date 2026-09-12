import type { JSX } from 'react'
import { useState, type FormEvent } from 'react'
import { addFromInput } from '../actions'
import { useStore } from '../store'

export default function AddBar(): JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const isLib = useStore(s => s.settings.view === 'library')

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const text = url.trim()
    if (!text) return
    setBusy(true)
    try { await addFromInput(text) } finally { setBusy(false) }
    setUrl('')
  }

  return (
    <form className="add-bar" onSubmit={onSubmit} autoComplete="off">
      <input id="input-url" type="text" value={url} onChange={e => setUrl(e.target.value)}
        placeholder={isLib
          ? 'ライブラリに保存する YouTube の URL / Shorts / 動画ID を貼り付け（複数はスペース区切り・再生リスト URL も可）'
          : 'YouTube の URL / Shorts / 動画ID を貼り付けてこのプレイリストに追加（複数はスペース区切り・再生リスト URL も可）'} />
      <button type="submit" className="primary" disabled={busy}>{busy ? '…' : (isLib ? '保存' : '追加')}</button>
    </form>
  )
}
