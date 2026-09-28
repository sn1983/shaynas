/**
 * Now-playing helpers for the radio site (exposed to it as window.electronAPI,
 * see preload.js). The site can't read song titles from other domains in a
 * normal browser because of CORS; the main process has no such limits.
 *
 *   radio:fetch      -> { ok, status, text }   raw text of a URL (Triton/Kan XML, APIs)
 *   radio:icyTitle   -> string | null          ICY StreamTitle of an Icecast/SHOUTcast stream
 *   radio:scrapeGlz  -> string | null          glz.co.il "now playing" (rendered by the page's
 *                                               own JS, so it is read from a hidden window)
 *
 * Safety: only the radio site's own pages may call these, only http(s) URLs
 * are fetched, and every request has a timeout and a size limit.
 *
 * Wire-up: require('./electron-nowplaying-main.js') from main.js; it registers
 * its ipcMain handlers as a side effect.
 */

const { ipcMain, BrowserWindow } = require('electron');
const https = require('https');
const http = require('http');

const SITE_ORIGIN = 'https://shay-radio-il.netlify.app';
const USER_AGENT = 'Mozilla/5.0 (RadioApp)';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_ICY_BYTES = 600 * 1024;
const MAX_REDIRECTS = 5;
const GLZ_HOSTS = ['glz.co.il', 'www.glz.co.il'];

function assertFromSite(event) {
  let origin = '';
  try {
    origin = new URL(event.senderFrame.url).origin;
  } catch {
    // no frame / bad URL: rejected below
  }
  if (origin !== SITE_ORIGIN) throw new Error('Not allowed');
}

function parseHttpUrl(url) {
  const u = new URL(String(url));
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed');
  return u;
}

function get(url, headers) {
  const u = parseHttpUrl(url);
  const lib = u.protocol === 'https:' ? https : http;
  return lib.get(u, { headers: { 'User-Agent': USER_AGENT, ...headers } });
}

// ---- Generic raw GET: { ok, status, text }, follows redirects --------------
function fetchRaw(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve) => {
    const fail = (error) => resolve({ ok: false, status: 0, text: '', error });
    let req;
    try {
      req = get(url);
    } catch (err) {
      return fail(err.message);
    }
    req.on('response', (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location && redirectsLeft > 0) {
        res.resume();
        let next;
        try {
          next = new URL(headers.location, url).href;
        } catch {
          return fail('bad redirect');
        }
        return resolve(fetchRaw(next, redirectsLeft - 1));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_TEXT_BYTES) {
          req.destroy();
          return fail('response too large');
        }
        chunks.push(c);
      });
      res.on('end', () => {
        resolve({
          ok: statusCode >= 200 && statusCode < 300,
          status: statusCode,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
      res.on('error', (err) => fail(err.message));
    });
    req.on('error', (err) => fail(err.message));
    req.setTimeout(10000, () => {
      req.destroy();
      fail('timeout');
    });
  });
}

ipcMain.handle('radio:fetch', async (event, url) => {
  assertFromSite(event);
  return fetchRaw(url);
});

// ---- ICY StreamTitle reader (reads icy-metaint from the raw headers) --------
ipcMain.handle('radio:icyTitle', async (event, streamUrl) => {
  assertFromSite(event);
  return new Promise((resolve) => {
    let req;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      if (req) req.destroy();
      resolve(value);
    };
    try {
      req = get(streamUrl, { 'Icy-MetaData': '1' });
    } catch {
      return done(null);
    }
    req.on('response', (res) => {
      const metaInt = parseInt(res.headers['icy-metaint'], 10);
      if (!metaInt) return done(null);
      let buffer = Buffer.alloc(0);
      res.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > metaInt) {
          const metaLen = buffer[metaInt] * 16;
          if (metaLen === 0) return done(null);
          if (buffer.length >= metaInt + 1 + metaLen) {
            const metaStr = buffer
              .subarray(metaInt + 1, metaInt + 1 + metaLen)
              .toString('utf8')
              .replace(/\0+$/, '');
            const m = metaStr.match(/StreamTitle='([^']*)'/);
            return done(m && m[1] ? m[1] : null);
          }
        }
        if (buffer.length > MAX_ICY_BYTES) done(null);
      });
      res.on('error', () => done(null));
    });
    req.on('error', () => done(null));
    req.setTimeout(8000, () => done(null));
  });
});

// ---- glz.co.il scraper: hidden, muted window that runs the page's own JS ----
ipcMain.handle('radio:scrapeGlz', async (event, pageUrl) => {
  assertFromSite(event);
  let u;
  try {
    u = parseHttpUrl(pageUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !GLZ_HOSTS.includes(u.hostname)) return null;

  let win;
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadURL(u.href);
    // The page fills the value in after load (Alpine.js); wait for it, up to ~8s.
    for (let i = 0; i < 16; i++) {
      const value = await win.webContents.executeJavaScript(`
        (function () {
          const el = document.querySelector('[data-live-fallback]');
          const v = el ? el.getAttribute('data-live-fallback') : null;
          return v && v.trim() ? v : null;
        })();
      `);
      if (value) return value;
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  } catch {
    return null;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
});
