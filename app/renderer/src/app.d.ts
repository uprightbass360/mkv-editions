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

  interface ElectronApi {
    ping: () => Promise<string>
    scanDisc: (bdmv: string) => Promise<ScanResult>
    onScanProgress: (cb: (p: ScanProgress) => void) => () => void
  }

  interface Window {
    api: ElectronApi
  }
}

export {}
