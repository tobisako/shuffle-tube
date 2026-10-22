import { useStore } from './store'

/** ドラッグ中のクリップ（プレイリスト内の並べ替え・サイドバーのプレイリストへの移動で共有する） */
export interface DraggingClip { playlistId: string; clipId: string }

let current: DraggingClip | null = null
export const getDraggingClip = (): DraggingClip | null => current
export const setDraggingClip = (v: DraggingClip | null): void => {
  current = v
  useStore.setState({ draggingFrom: v?.playlistId ?? null })
}
