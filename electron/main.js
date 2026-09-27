// הרדיו של שי - Windows desktop wrapper.
// The app always loads the live website, so any change published to the site
// shows up in the app immediately without reinstalling.
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const path = require('path');

const SITE_URL = 'https://shay-radio-il.netlify.app/';
const SITE_ORIGIN = new URL(SITE_URL).origin;
const APP_NAME = 'הרדיו של שי';

// Let the radio start playing without requiring an extra click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('il.shayradio.app');

// Only one window of the app at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow;

function isInternal(url) {
  try {
    return new URL(url).origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}

function loadSite() {
  mainWindow.loadURL(SITE_URL).catch(() => {});
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 500,
    title: APP_NAME,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#1a1033',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep the audio playing when the window is minimized.
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Keep our Hebrew app name in the title bar.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  // Links to other sites open in the user's normal browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url) && !url.startsWith('file:')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // No internet / site down: show a friendly page with a retry button.
  mainWindow.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ABORTED */) return;
    mainWindow.loadFile(path.join(__dirname, '..', 'www', 'offline.html'), {
      query: { retry: url || SITE_URL },
    });
  });

  // Keyboard shortcuts: F5 / Ctrl+R reload, F11 full screen, F12 dev tools.
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
      e.preventDefault();
      loadSite();
    } else if (input.key === 'F11') {
      e.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (input.key === 'F12') {
      e.preventDefault();
      mainWindow.webContents.toggleDevTools();
    }
  });

  loadSite();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // Allow microphone / notifications etc. only for the radio site itself.
  session.defaultSession.setPermissionRequestHandler((wc, _perm, cb) => {
    cb(isInternal(wc.getURL()));
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
