import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { scanDisc } from './scan'

// Built to CJS by tsup, so __dirname is available natively at runtime.
const dirname = __dirname

const DEV_URL = process.env.ELECTRON_RENDERER_DEV_URL
const BUILD_DIR = path.join(dirname, '..', 'renderer', 'build')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2'
}

/**
 * The file:// fix. SvelteKit's default pathname router matches location.pathname
 * against routes; under a plain loadFile(), pathname is the absolute OS path, so
 * route "/" never matches and the router throws "Not found". adapter-static also
 * emits root-absolute asset paths ("/_app/...") which 404 under file://.
 * Intercepting the 'file' scheme to resolve every request against BUILD_DIR, then
 * navigating to "file:///" (pathname "/"), fixes both at once - no local HTTP
 * server, no custom scheme, renderer stays a plain prerendered static build.
 */
function registerBuildProtocol() {
  protocol.handle('file', async (request) => {
    const url = new URL(request.url)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/' || pathname === '') pathname = '/index.html'
    const filePath = path.normalize(path.join(BUILD_DIR, pathname))
    if (!filePath.startsWith(BUILD_DIR)) return new Response('Forbidden', { status: 403 })
    try {
      const data = await fs.readFile(filePath)
      const type = MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream'
      return new Response(data, { headers: { 'content-type': type } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

ipcMain.handle('ping', () => `pong from main @ ${new Date().toISOString()}`)

ipcMain.handle('scan', async (event, bdmv: string) => {
  const cacheDir = path.join(app.getPath('userData'), 'probe-cache')
  return scanDisc(bdmv, cacheDir, (p) => event.sender.send('scan:progress', p))
})

ipcMain.handle('pickBdmv', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 720, show: false,
    webPreferences: {
      preload: path.join(dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  })
  win.webContents.on('console-message', (e) => console.log(`[renderer console] ${e.message}`))
  win.webContents.on('did-finish-load', () => console.log('[main] did-finish-load'))
  win.once('ready-to-show', () => { console.log('[main] ready-to-show'); win.show() })
  if (DEV_URL) { console.log(`[main] loading dev URL: ${DEV_URL}`); win.loadURL(DEV_URL) }
  else { console.log(`[main] loading file:/// (intercepted -> ${BUILD_DIR})`); win.loadURL('file:///') }
  return win
}

app.whenReady().then(() => {
  if (!DEV_URL) registerBuildProtocol()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
