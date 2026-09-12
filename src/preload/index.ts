import { contextBridge, ipcRenderer } from 'electron'
import type { Api, Command, DataChange } from '@shared/types'

const api: Api = {
  loadAll: () => ipcRenderer.invoke('data:load'),
  savePlaylists: (playlists) => ipcRenderer.invoke('playlists:save', playlists),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  saveHistory: (history) => ipcRenderer.invoke('history:save', history),
  saveLibrary: (videos) => ipcRenderer.invoke('library:save', videos),
  fetchMeta: (videoId) => ipcRenderer.invoke('meta:fetch', videoId),
  setPlaybackState: (isPlaying) => ipcRenderer.send('playback:state', isPlaying),
  exportPlaylists: (json, suggestedName) => ipcRenderer.invoke('dialog:export', json, suggestedName),
  importPlaylists: () => ipcRenderer.invoke('dialog:import'),
  openExternal: (url) => ipcRenderer.send('shell:open', url),
  mediaKeysStatus: () => ipcRenderer.invoke('mediaKeys:status'),
  requestAccessibility: () => ipcRenderer.invoke('mediaKeys:requestAccess'),
  onCommand: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, cmd: Command): void => cb(cmd)
    ipcRenderer.on('command', handler)
    return () => ipcRenderer.removeListener('command', handler)
  },
  onDataChanged: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, change: DataChange): void => cb(change)
    ipcRenderer.on('data:changed', handler)
    return () => ipcRenderer.removeListener('data:changed', handler)
  },
  lanInfo: () => ipcRenderer.invoke('lan:info'),
  platform: process.platform,
}

contextBridge.exposeInMainWorld('api', api)
