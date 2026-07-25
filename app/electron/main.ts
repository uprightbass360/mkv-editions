import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { scanDisc } from './scan'
import { writeProjectFile, readProjectFile } from './project-io'
import { createOpener, cleanupExtractions } from './disc-input'
import { inspectBuild, runBuild } from './build'

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
    if (!(filePath === BUILD_DIR || filePath.startsWith(BUILD_DIR + path.sep))) return new Response('Forbidden', { status: 403 })
    try {
      const data = await fs.readFile(filePath)
      const type = MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream'
      return new Response(data, { headers: { 'content-type': type } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

// The app's single window, captured at creation. Dialogs parent to THIS rather
// than BrowserWindow.getFocusedWindow(), which returns null on WSLg when a
// modal-overlay context is up - leaving the dialog unparented and unable to
// surface ("does not open").
let mainWindow: BrowserWindow | null = null

function dialogParent(): BrowserWindow | undefined {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
}
function showOpen(opts: Electron.OpenDialogOptions) {
  const win = dialogParent()
  if (win) { win.focus(); return dialog.showOpenDialog(win, opts) }
  return dialog.showOpenDialog(opts)
}
function showSave(opts: Electron.SaveDialogOptions) {
  const win = dialogParent()
  if (win) { win.focus(); return dialog.showSaveDialog(win, opts) }
  return dialog.showSaveDialog(opts)
}

ipcMain.handle('ping', () => `pong from main @ ${new Date().toISOString()}`)

ipcMain.handle('scan', async (event, bdmv: string) => {
  const cacheDir = path.join(app.getPath('userData'), 'probe-cache')
  return scanDisc(bdmv, cacheDir, (p) => event.sender.send('scan:progress', p))
})

const opener = createOpener({ showOpenDialog: showOpen })
ipcMain.handle('openInput', async (event, kind: 'folder' | 'zip') =>
  opener.openInput(kind, (p) => event.sender.send('extract:progress', p)))

ipcMain.handle('saveProject', async (_e, json: unknown, title: string) => {
  const r = await showSave({ defaultPath: `${title || 'movie'}.mkvedproj` })
  if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' }
  try { await writeProjectFile(r.filePath, json); return { ok: true, path: r.filePath } }
  catch (e) { return { ok: false, error: String(e) } }
})
ipcMain.handle('openProject', async () => {
  const r = await showOpen({ properties: ['openFile'], filters: [{ name: 'mkvedproj', extensions: ['mkvedproj', 'json'] }] })
  if (r.canceled || r.filePaths.length === 0) return null
  try { return { ok: true, json: await readProjectFile(r.filePaths[0]) } }
  catch (e) { return { ok: false, error: String(e) } }
})

let lastBuildDir: string | undefined
ipcMain.handle('buildPickFolder', async () => {
  console.log(`[main] buildPickFolder: opening directory dialog (parent=${dialogParent() ? 'window' : 'none'})`)
  try {
    const r = await showOpen({ properties: ['openDirectory'], defaultPath: lastBuildDir ?? '/' })
    console.log(`[main] buildPickFolder: canceled=${r.canceled} paths=${r.filePaths.length}`)
    if (r.canceled || r.filePaths.length === 0) return null
    lastBuildDir = r.filePaths[0]
    return lastBuildDir
  } catch (e) {
    console.error('[main] buildPickFolder: dialog threw', e)
    return null
  }
})
ipcMain.handle('buildInspect', async (_e, json: unknown, outdir: string) => inspectBuild(json, outdir))
ipcMain.handle('buildRun', async (event, json: unknown, outdir: string, overwrite: boolean) =>
  runBuild(json, outdir, overwrite,
    (p) => event.sender.send('build:progress', p),
    (line) => event.sender.send('build:log', { line })))

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 720, show: false,
    webPreferences: {
      preload: path.join(dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  })
  mainWindow = win
  win.on('closed', () => { if (mainWindow === win) mainWindow = null })
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
app.on('will-quit', () => cleanupExtractions())
