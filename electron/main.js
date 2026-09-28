// הרדיו של שי - Windows desktop wrapper.
// The app always loads the live website, so any change published to the site
// shows up in the app immediately without reinstalling.
const { app, BrowserWindow, shell, Menu, Tray, nativeImage, session, ipcMain, net } = require('electron');
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

// Fixed id so Windows remembers the user's "always show this icon" choice.
const TRAY_GUID = '6f1f6a0e-3c1b-4f7e-9a53-5d8a2b7c41e2';

let isPlaying = false;

function radioCommand(cmd) {
  if (!mainWindow) return Promise.resolve(false);
  return mainWindow.webContents
    .executeJavaScript(`window.__shayRadio ? window.__shayRadio.${cmd}() : false`, true)
    .catch(() => false);
}

// Play/stop from the tray. If the site hasn't started a player yet, open the
// window so the user can pick what to play.
async function togglePlayback() {
  const handled = await radioCommand('toggle');
  if (!handled) showWindow();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setToolTip(isPlaying ? `${APP_NAME} - מנגן` : APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    isPlaying
      ? { label: '⏸  עצור', click: () => radioCommand('stop') }
      : { label: '▶  נגן', click: togglePlayback },
    { type: 'separator' },
    { label: 'פתח את הרדיו של שי', click: showWindow },
    { label: 'רענן', click: () => { showWindow(); loadSite(); } },
    { type: 'separator' },
    { label: 'יציאה', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

// Icon next to the clock (system tray): always there while the app runs, so the
// radio can be played/stopped and the window reopened at any time.
function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 32, height: 32 });
  try {
    tray = process.platform === 'win32' ? new Tray(icon, TRAY_GUID) : new Tray(icon);
  } catch {
    tray = new Tray(icon);
  }
  updateTrayMenu();
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide();
    } else {
      showWindow();
    }
  });
  tray.on('double-click', showWindow);
}

// ----- Now-playing helpers for the site (window.electronAPI, see preload.js) -----
// The site can't read song titles from other domains because of browser CORS
// rules, so the app's main process fetches them instead. Only the radio site
// itself may call these, only http(s) URLs are allowed, and every request has
// a timeout and a size limit.

const FETCH_TIMEOUT_MS = 10000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_ICY_BYTES = 600 * 1024;

function assertFromSite(event) {
  const frameUrl = event.senderFrame && event.senderFrame.url;
  if (!frameUrl || !isInternal(frameUrl)) throw new Error('Not allowed');
}

function checkUrl(url) {
  const u = new URL(String(url));
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed');
  return u.href;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await net.fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

async function readText(res, limit = MAX_TEXT_BYTES) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, limit).toString('utf8');
}

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Raw text of any URL (e.g. an XML/JSON now-playing feed).
ipcMain.handle('radio:fetch', async (event, url) => {
  assertFromSite(event);
  const res = await fetchWithTimeout(checkUrl(url));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return readText(res);
});

// Current song title from a SHOUTcast/Icecast stream's ICY metadata, or null.
ipcMain.handle('radio:icyTitle', async (event, streamUrl) => {
  assertFromSite(event);
  const res = await fetchWithTimeout(checkUrl(streamUrl), { headers: { 'Icy-MetaData': '1' } });
  const metaInt = parseInt(res.headers.get('icy-metaint'), 10);
  if (!res.ok || !metaInt || !res.body) {
    res.body && res.body.cancel().catch(() => {});
    return null;
  }
  const reader = res.body.getReader();
  let buf = Buffer.alloc(0);
  try {
    while (buf.length < MAX_ICY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = Buffer.concat([buf, Buffer.from(value)]);
      if (buf.length > metaInt) {
        const metaLen = buf[metaInt] * 16;
        if (metaLen === 0) return null;
        if (buf.length >= metaInt + 1 + metaLen) {
          const meta = buf.subarray(metaInt + 1, metaInt + 1 + metaLen).toString('utf8').replace(/\0+$/, '');
          const m = meta.match(/StreamTitle='([^']*)'/);
          return m && m[1] ? m[1].trim() : null;
        }
      }
    }
    return null;
  } finally {
    reader.cancel().catch(() => {});
  }
});

// Now-playing text from a glz.co.il station page, or null.
ipcMain.handle('radio:scrapeGlz', async (event, pageUrl) => {
  assertFromSite(event);
  const res = await fetchWithTimeout(checkUrl(pageUrl));
  if (!res.ok) return null;
  const html = await readText(res);
  const m = html.match(/data-live-fallback="([^"]*)"/);
  if (m && m[1]) return decodeEntities(m[1]).trim() || null;
  return null;
});

ipcMain.on('radio-state', (_e, playing) => {
  isPlaying = Boolean(playing);
  updateTrayMenu();
});

function isInternal(url) {
  try {
    return new URL(url).origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}

function loadSite() {
  isPlaying = false;
  updateTrayMenu();
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
        content: 'הרדיו ממשיך לנגן ברקע. קליק ימני על האייקון ליד השעון: נגן / עצור / יציאה.',
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
