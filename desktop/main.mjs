import { app, BrowserWindow, dialog, Menu, net, protocol, screen, session, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_URL, CONTENT_SECURITY_POLICY, allowPermission, externalLink, isAppUrl, resolveAsset } from './security.mjs';

app.setName('Faithful Keys');
// A stable profile and origin preserve localStorage, cookies and IndexedDB between releases.
app.setPath('userData', path.join(app.getPath('appData'), 'Faithful Keys'));
protocol.registerSchemesAsPrivileged([{ scheme: 'faithful-keys', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

const releaseUrl = 'https://github.com/KeysWithDon/faithful-keys/releases';
let mainWindow;
async function openLink(value) {
  const url = externalLink(value);
  if (url) await shell.openExternal(url);
}

async function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    title: 'Faithful Keys', width: Math.min(1440, width), height: Math.min(940, height),
    minWidth: Math.min(800, width), minHeight: Math.min(600, height),
    backgroundColor: '#132045', show: false, autoHideMenuBar: process.platform !== 'darwin',
    icon: path.join(app.getAppPath(), 'icon.png'),
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      spellcheck: false, backgroundThrottling: false,
      partition: 'persist:faithful-keys',
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openLink(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) { event.preventDefault(); void openLink(url).catch(() => {}); }
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', () => {
    void dialog.showMessageBox({ type: 'error', message: 'Faithful Keys needs to reopen.',
      detail: 'Your saved progress is kept on this computer.', buttons: ['Reopen', 'Close']
    }).then(({ response }) => response === 0 ? mainWindow?.reload() : app.quit());
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadURL(APP_URL);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show(); mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    const ses = session.fromPartition('persist:faithful-keys');
    const root = path.join(app.getAppPath(), 'web');
    ses.protocol.handle('faithful-keys', async request => {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      const file = resolveAsset(root, request.url);
      if (!file) return new Response('Forbidden', { status: 403 });
      try {
        if (!(await fs.stat(file)).isFile()) return new Response('Not found', { status: 404 });
        const response = await net.fetch(pathToFileURL(file).href, { method: request.method });
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
        headers.set('X-Content-Type-Options', 'nosniff');
        return new Response(response.body, { status: response.status, headers });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    ses.setPermissionCheckHandler((contents, permission, origin, details) =>
      allowPermission(permission, details.requestingUrl || origin, contents?.getURL(), details.isMainFrame));
    ses.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback(allowPermission(permission, details.requestingUrl, contents?.getURL(), details.isMainFrame)));
    // Blob exports retain the existing app flow and use the OS save dialog.
    ses.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ title: 'Save from Faithful Keys', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
    });
    const template = [
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [{ role: 'close' }, ...(process.platform === 'darwin' ? [] : [{ role: 'quit' }])] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
      { label: 'Help', submenu: [
        { label: 'Desktop guide', click: () => mainWindow?.loadURL(APP_URL + 'desktop-guide.html') },
        { label: 'Back to Faithful Keys', click: () => mainWindow?.loadURL(APP_URL) },
        { label: 'Check for updates', click: () => void openLink(releaseUrl) },
        { label: 'About Faithful Keys', click: () => dialog.showMessageBox({ title: 'Faithful Keys', message: `Faithful Keys ${app.getVersion()}`, detail: 'Practice, grow, and praise Him with every instrument.\nDesktop edition for Mac and Windows.' }) },
      ] },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    await createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  }).catch(error => { dialog.showErrorBox('Unable to open Faithful Keys', String(error)); app.quit(); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (app.isReady()) session.fromPartition('persist:faithful-keys').flushStorageData(); });
