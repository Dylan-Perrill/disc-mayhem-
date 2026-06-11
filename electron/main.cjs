// electron/main.cjs — desktop wrapper for DISC MAYHEM! (Steam-ready path).
// Boots the bundled game server in-process on a private port, then opens the
// game in a frameless-friendly BrowserWindow. CommonJS so plain `electron .`
// works regardless of package.json "type".

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const PORT = process.env.DISC_MAYHEM_PORT || '37425';

async function boot() {
  process.env.PORT = PORT;
  // server/index.js is ESM; dynamic import works fine from CJS in Electron.
  await import(path.join(__dirname, '..', 'server', 'index.js').replace(/\\/g, '/'));

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'DISC MAYHEM!',
    backgroundColor: '#8fd3ff',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(`http://localhost:${PORT}/client/index.html`);
}

app.whenReady().then(boot);
app.on('window-all-closed', () => app.quit());
