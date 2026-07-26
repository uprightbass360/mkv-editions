import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  scanDisc: (bdmv: string) => ipcRenderer.invoke('scan', bdmv),
  onScanProgress: (cb: (p: { clip: string; done: number; total: number }) => void) => {
    const h = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on('scan:progress', h)
    return () => ipcRenderer.removeListener('scan:progress', h)
  },
  openInput: (kind: 'folder' | 'zip') => ipcRenderer.invoke('openInput', kind),
  onExtractProgress: (cb: (p: { percent: number }) => void) => {
    const h = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on('extract:progress', h)
    return () => ipcRenderer.removeListener('extract:progress', h)
  },
  saveProject: (json: unknown, title: string) => ipcRenderer.invoke('saveProject', json, title),
  openProject: () => ipcRenderer.invoke('openProject'),
  buildPickFolder: (): Promise<string | null> => ipcRenderer.invoke('buildPickFolder'),
  buildInspect: (json: unknown, outdir: string) => ipcRenderer.invoke('buildInspect', json, outdir),
  buildRun: (json: unknown, outdir: string, overwrite: boolean) => ipcRenderer.invoke('buildRun', json, outdir, overwrite),
  chaptersPickFile: (): Promise<string | null> => ipcRenderer.invoke('chaptersPickFile'),
  chaptersInspect: (file: string) => ipcRenderer.invoke('chaptersInspect', file),
  onBuildProgress: (cb: (p: { percent: number }) => void) => {
    const h = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on('build:progress', h)
    return () => ipcRenderer.removeListener('build:progress', h)
  },
  onBuildLog: (cb: (p: { line: string }) => void) => {
    const h = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on('build:log', h)
    return () => ipcRenderer.removeListener('build:log', h)
  },
}

contextBridge.exposeInMainWorld('api', api)
