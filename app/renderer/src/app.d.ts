declare global {
  namespace App {}

  interface ScanProgress {
    clip: string
    done: number
    total: number
  }

  type ScanResult =
    | { ok: true; data: Record<string, any> }
    | { ok: false; error: string }

  type SaveProjectResult = { ok: true; path: string } | { ok: false; error: string }
  type OpenProjectResult = { ok: true; json: unknown } | { ok: false; error: string }

  interface ElectronApi {
    ping: () => Promise<string>
    scanDisc: (bdmv: string) => Promise<ScanResult>
    onScanProgress: (cb: (p: ScanProgress) => void) => () => void
    pickBdmv: () => Promise<string | null>
    saveProject: (json: unknown, title: string) => Promise<SaveProjectResult>
    openProject: () => Promise<OpenProjectResult | null>
  }

  interface Window {
    api: ElectronApi
  }
}

export {}
