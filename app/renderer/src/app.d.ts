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

  type OpenInputResult = { ok: true; bdmvPath: string } | { ok: false; error: string }
  interface ExtractProgress { percent: number }

  interface BuildProgress { percent: number }
  type BuildResult =
    | { ok: true; outputs: string[] }
    | { ok: false; error: string }

  interface ElectronApi {
    ping: () => Promise<string>
    scanDisc: (bdmv: string) => Promise<ScanResult>
    onScanProgress: (cb: (p: ScanProgress) => void) => () => void
    openInput: (kind: 'folder' | 'zip') => Promise<OpenInputResult | null>
    onExtractProgress: (cb: (p: ExtractProgress) => void) => () => void
    saveProject: (json: unknown, title: string) => Promise<SaveProjectResult>
    openProject: () => Promise<OpenProjectResult | null>
    buildProject: (json: unknown) => Promise<BuildResult | null>
    onBuildProgress: (cb: (p: BuildProgress) => void) => () => void
  }

  interface Window {
    api: ElectronApi
  }
}

export {}
