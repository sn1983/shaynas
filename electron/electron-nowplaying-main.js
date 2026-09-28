/**
 * Now-playing helpers for the radio site (exposed to it as window.electronAPI,
 * see preload.js). The site can't read song titles from other domains in a
 * normal browser because of CORS; the main process has no such limits.
 *
 *   radio:fetch      -> { ok, status, text }   raw text of a URL (Triton/Kan XML, APIs)
 *   radio:icyTitle   -> string | null          ICY StreamTitle of an Icecast/SHOUTcast stream
 *   radio:scrapeGlz  -> string | null          glz.co.il current song ("artist - title"), or the
 *                                               program name during talk; read from a hidden window
 *                                               after the page's own JS has filled it in
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

// Titles some stream providers send instead of the song (e.g. "CDN - Powered By ...").
function isJunkTitle(title) {
  return /powered by|^cdn\b|^[\s\-–]*$/i.test(title);
}

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
      // Metadata blocks repeat every metaInt audio bytes; the first ones may be
      // empty, so keep scanning until a real title shows up (or the size cap).
      let buffer = Buffer.alloc(0);
      let pos = metaInt; // position of the next metadata length byte
      res.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length > pos) {
          const metaLen = buffer[pos] * 16;
          if (buffer.length < pos + 1 + metaLen) break; // wait for the rest of the block
          if (metaLen > 0) {
            const metaStr = buffer.subarray(pos + 1, pos + 1 + metaLen).toString('utf8').replace(/\0+$/, '');
            const m = metaStr.match(/StreamTitle='([^']*)'/);
            const title = m && m[1] ? m[1].trim() : '';
            if (title && !isJunkTitle(title)) return done(title);
          }
          pos += 1 + metaLen + metaInt;
        }
        if (buffer.length > MAX_ICY_BYTES) done(null);
      });
      res.on('error', () => done(null));
    });
    req.on('error', () => done(null));
    req.setTimeout(8000, () => done(null));
  });
});

const GLZ_SCRIPT = `
  (function () {
    const box = document.querySelector('.playLiveText') || document;
    const read = (sel) => {
      const el = box.querySelector(sel);
      if (!el) return '';
      return ((el.textContent || '').trim() || (el.getAttribute('data-live-fallback') || '').trim());
    };
    return { song: read('.talent') || null, program: read('.title') || null };
  })();
`;

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
    // In .playLiveText the page shows the program (.title) and the current song
    // (.talent = "artist - title"), filled in by the page's own JS (Alpine.js).
    // Prefer the song; during talk segments there is none, so fall back to the program.
    let program = null;
    for (let i = 0; i < 16; i++) {
      const found = await win.webContents.executeJavaScript(GLZ_SCRIPT);
      if (found && found.song) return found.song;
      if (found && found.program) program = found.program;
      await new Promise((r) => setTimeout(r, 500));
    }
    return program;
  } catch {
    return null;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
});
