// הרדיו של שי - Windows desktop wrapper.
// The app always loads the live website, so any change published to the site
// shows up in the app immediately without reinstalling.
const { app, BrowserWindow, shell, Menu, Tray, nativeImage, session } = require('electron');
const path = require('path');

const SITE_URL = 'https://shay-radio-il.netlify.app/';
const SITE_ORIGIN = new URL(SITE_URL).origin;
const APP_NAME = 'הרדיו של שי';

// Let the radio start playing without requiring an extra click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Never slow down or suspend the page (and its audio stream) while the window
// is minimized or hidden to the tray.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-media-suspend');
app.commandLine.appendSwitch('disable-features', 'IntensiveWakeUpThrottling,CalculateNativeWinOcclusion');
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('il.shayradio.app');

// Only one window of the app at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.png');

let mainWindow;
let tray;
let isQuitting = false;
let trayHintShown = false;

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Icon next to the clock (system tray) so the app can always be reopened
// while the radio keeps playing in the background.
function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'פתח את הרדיו של שי', click: showWindow },
    { label: 'רענן', click: () => { showWindow(); loadSite(); } },
    { type: 'separator' },
    { label: 'יציאה', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide();
    } else {
      showWindow();
    }
  });
  tray.on('double-click', showWindow);
}

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
    icon: ICON_PATH,
    backgroundColor: '#1a1033',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      // Keep the audio playing when the window is minimized.
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Minimizing sends the app to the tray (icon next to the clock).
  mainWindow.on('minimize', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  // Closing the window (X) hides it to the tray and the radio keeps playing.
  // Use "יציאה" in the tray menu to really quit.
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow.hide();
    if (!trayHintShown && tray && process.platform === 'win32') {
      trayHintShown = true;
      tray.displayBalloon({
        iconType: 'info',
        title: APP_NAME,
        content: 'הרדיו ממשיך לנגן ברקע. לחצו על האייקון ליד השעון כדי לפתוח, או קליק ימני ← יציאה.',
      });
    }
  });

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

app.on('second-instance', showWindow);
app.on('before-quit', () => { isQuitting = true; });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // Allow microphone / notifications etc. only for the radio site itself.
  session.defaultSession.setPermissionRequestHandler((wc, _perm, cb) => {
    cb(isInternal(wc.getURL()));
  });
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
