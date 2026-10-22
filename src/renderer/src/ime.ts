import type { KeyboardEvent } from 'react'

/** 日本語入力の変換中か（変換確定の Enter・取り消しの Escape を編集の確定・取り消しと取り違えないため） */
export const isComposing = (e: KeyboardEvent): boolean => e.nativeEvent.isComposing || e.keyCode === 229
