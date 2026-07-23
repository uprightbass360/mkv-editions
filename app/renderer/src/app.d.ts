declare global {
  namespace App {}

  interface ElectronApi {
    ping: () => Promise<string>
  }

  interface Window {
    api: ElectronApi
  }
}

export {}
