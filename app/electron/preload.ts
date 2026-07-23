import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  scanDisc: (bdmv: string) => ipcRenderer.invoke('scan', bdmv),
  onScanProgress: (cb: (p: { clip: string; done: number; total: number }) => void) => {
    const h = (_e: unknown, p: any) => cb(p)
    ipcRenderer.on('scan:progress', h)
    return () => ipcRenderer.removeListener('scan:progress', h)
  },
  pickBdmv: (): Promise<string | null> => ipcRenderer.invoke('pickBdmv')
}

contextBridge.exposeInMainWorld('api', api)
