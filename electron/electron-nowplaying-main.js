/**
 * Now-playing helpers for the radio site (exposed to it as window.electronAPI,
 * see preload.js). The site can't read song titles from other domains in a
 * normal browser because of CORS; the main process has no such limits.
 *
 *   radio:fetch      -> { ok, status, text }   raw text of a URL (Triton/Kan XML, APIs)
 *   radio:icyTitle   -> string | null          ICY StreamTitle of an Icecast/SHOUTcast stream
 *   radio:scrapePageAudio -> string | null     audio URL that a program's web page plays
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

// Hebrew titles often arrive in the old Windows-1255 encoding, either as raw
// bytes (not valid UTF-8) or already mangled into Latin-1 letters ("ùéø" for
// "שיר"). Turn both back into proper Hebrew.
function decodeTitleBytes(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1255').decode(bytes);
  }
  if (/^[\u0000-\u00ff]*$/.test(text) && /[\u00e0-\u00fa]{2,}/.test(text)) {
    return new TextDecoder('windows-1255').decode(Buffer.from(text, 'latin1'));
  }
  return text;
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
            const metaStr = decodeTitleBytes(buffer.subarray(pos + 1, pos + 1 + metaLen)).replace(/\0+$/, '');
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

// ---- On-demand audio pages: find the audio URL a program page plays -------
// Opens the page in a hidden, muted window, lets its own player set up, and
// returns a real (http/https) audio URL: from <audio>/<source>, any data-*
// attribute holding an audio file (e.g. data-url, data-player-hls-src), or an
// audio file the page requested. If the page address names an episode
// (?audio=...), the matching file is preferred. Checks every 500 ms for up to
// ~10 s. Returns null when nothing is found.
const PAGE_AUDIO_SCRIPT = "(function () {\n  var AUDIO = /\\.(mp3|m4a|aac|m3u8|ogg|wav|opus)(\\?|$)/i;\n  var LIVE = /icecast|livestream|live-redirect|\\/live(hls)?\\/|\\.livx|streamtheworld|glzwizzlv|\\/live[_-]|_(mp3|aac)$|\\/stream\\/[^\\/.]*\\/?$/i; var isHttp = function (u) { return typeof u === 'string' && /^https?:\\/\\//i.test(u); };\n  // Audio the page's own player asked for after we pressed its play button.\n  var picked = window.__shayPicked || [];\n  if (picked.length) return { url: picked[0], exact: true };\n  var found = [];\n  var add = function (u, fromPlayer) {\n    try {\n      if (!u) return;\n      var h = new URL(u, location.href).href;\n      if (!isHttp(h) || LIVE.test(h) || (!fromPlayer && !AUDIO.test(h))) return;\n      if (found.indexOf(h) < 0) found.push(h);\n    } catch (e) {}\n  };\n  document.querySelectorAll('audio, video').forEach(function (a) { add(a.currentSrc || a.src, true); });\n  document.querySelectorAll('audio source, video source').forEach(function (s) { add(s.src, true); });\n  document.querySelectorAll('*').forEach(function (el) {\n    for (var i = 0; i < el.attributes.length; i++) {\n      var at = el.attributes[i];\n      if (at.name.indexOf('data-') === 0 && AUDIO.test(at.value)) add(at.value, false);\n    }\n  });\n  performance.getEntriesByType('resource').forEach(function (e) { add(e.name, false); });\n  if (!found.length) return null;\n  // The page address may name a specific episode (e.g. ?audio=minheret-25-06-25):\n  // prefer the file whose name matches it.\n  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]/g, ''); };\n  // Hints: the address's query values first (an episode name), then its last path\n  // segment (e.g. kan-gimel -> matches .../kan_gimel/... over another station's stream).\n  var hints = [];\n  var q = new URLSearchParams(location.search);\n  q.forEach(function (v) { if (norm(v).length >= 4) hints.push(norm(v)); });\n  var seg = location.pathname.split('/').filter(Boolean).pop();\n  if (seg && norm(decodeURIComponent(seg)).length >= 4) hints.push(norm(decodeURIComponent(seg)));\n  var match = null;\n  for (var h = 0; h < hints.length && !match; h++) {\n    for (var j = 0; j < found.length; j++) {\n      var file = decodeURIComponent(found[j].split('?')[0].split('/').pop());\n      var path = decodeURIComponent(found[j].split('?')[0]);\n      if (norm(file).indexOf(hints[h]) >= 0 || norm(path).indexOf(hints[h]) >= 0) { match = found[j]; break; }\n    }\n  }\n  return { url: match || found[0], exact: !!match || !hints.length };\n})()";

// Some pages load the audio only after pressing play (e.g. glz.co.il episodes).
// Press it once, with the page's player intercepted so it only reports which file
// it would play and never actually plays anything.
const CLICK_PLAY_SCRIPT = "(function () {\n  if (window.__shayHooked) return 0;\n  window.__shayHooked = true;\n  window.__shayPicked = []; var LIVE = /icecast|livestream|live-redirect|\\/live(hls)?\\/|\\.livx|streamtheworld|glzwizzlv|\\/live[_-]|_(mp3|aac)$|\\/stream\\/[^\\/.]*\\/?$/i;\n  var live = [].map.call(document.querySelectorAll('[data-live-url]'), function (e) {\n    try { return new URL(e.getAttribute('data-live-url'), location.href).href; } catch (x) { return ''; }\n  });\n  var rec = function (u) {\n    try {\n      var h = new URL(u, location.href).href;\n      if (/^https?:/i.test(h) && !LIVE.test(h) && live.indexOf(h) < 0 && window.__shayPicked.indexOf(h) < 0) window.__shayPicked.push(h);\n    } catch (e) {}\n  };\n  var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');\n  Object.defineProperty(HTMLMediaElement.prototype, 'src', {\n    configurable: true,\n    get: function () { return d.get.call(this); },\n    set: function (v) { rec(v); }\n  });\n  var setAttr = Element.prototype.setAttribute;\n  Element.prototype.setAttribute = function (n, v) {\n    if (this instanceof HTMLMediaElement && String(n).toLowerCase() === 'src') { rec(v); return; }\n    return setAttr.apply(this, arguments);\n  };\n  HTMLMediaElement.prototype.play = function () { if (this.currentSrc) rec(this.currentSrc); return Promise.resolve(); };\n  var RealAudio = window.Audio;\n  window.Audio = function (u) { var a = new RealAudio(); if (u) rec(u); return a; };\n  var n = 0;\n  [].slice.call(document.querySelectorAll('button, a, [role=button]')).forEach(function (e) {\n    if (n >= 6) return;\n    var label = (e.getAttribute('class') || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.textContent || '').slice(0, 30);\n    if (!/play|\u05d4\u05d0\u05d6\u05e0\u05d4|\u05e0\u05d2\u05df|listen/i.test(label) || /youtube/i.test(e.outerHTML.slice(0, 300))) return;\n    var href = e.tagName === 'A' ? (e.getAttribute('href') || '') : '';\n    if (href && !/^(#|javascript:)/i.test(href)) return;\n    n++;\n    try { e.click(); } catch (x) {}\n  });\n  return n;\n})()";

ipcMain.handle('radio:scrapePageAudio', async (event, pageUrl) => {
  assertFromSite(event);
  let u;
  try {
    u = parseHttpUrl(pageUrl);
  } catch {
    return null;
  }
  let win;
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadURL(u.href);
    win.webContents.on('will-navigate', (e) => e.preventDefault()); // stay on this page
    // A page can list many episodes; wait for the one its address names (?audio=...),
    // otherwise settle for the first audio file found.
    let best = null;
    for (let i = 0; i < 20; i++) {
      if (i === 6) await win.webContents.executeJavaScript(CLICK_PLAY_SCRIPT).catch(() => 0);
      const found = await win.webContents.executeJavaScript(PAGE_AUDIO_SCRIPT);
      if (found && found.url) {
        if (found.exact) return found.url;
        best = found.url;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return best;
  } catch {
    return null;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
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
