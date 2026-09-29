// Runs before the site's own scripts.
// 1. Makes the page believe it is always visible, so the site's player does
//    not pause/stop the stream when the window is minimized or in the tray.
// 2. Tracks the site's audio players so the tray menu can play/stop the
//    stream and show whether it is playing.
const { webFrame, ipcRenderer, contextBridge } = require('electron');

webFrame.executeJavaScript(`(${function keepPlaying() {
  const always = (value) => ({ configurable: true, get: () => value });
  Object.defineProperty(Document.prototype, 'hidden', always(false));
  Object.defineProperty(Document.prototype, 'visibilityState', always('visible'));
  Object.defineProperty(Document.prototype, 'webkitHidden', always(false));
  Object.defineProperty(Document.prototype, 'webkitVisibilityState', always('visible'));
  Document.prototype.hasFocus = () => true;
  // Swallow "page hidden" / "window lost focus" events before the site sees them.
  for (const type of ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'freeze', 'blur']) {
    window.addEventListener(type, (e) => {
      if (e.target === window || e.target === document) e.stopImmediatePropagation();
    }, true);
  }

  const media = new Set();
  let lastPlayed = null;
  let lastState = null;

  const isPlaying = () => [...media].some((el) => !el.paused && !el.ended);
  const report = () => {
    const playing = isPlaying();
    if (playing === lastState) return;
    lastState = playing;
    window.dispatchEvent(new Event(playing ? 'shayradio-playing' : 'shayradio-stopped'));
  };
  const track = (el) => {
    if (!el || media.has(el)) return;
    media.add(el);
    for (const t of ['play', 'playing', 'pause', 'ended', 'emptied']) el.addEventListener(t, report);
    el.addEventListener('playing', () => { lastPlayed = el; });
  };
  const scan = () => document.querySelectorAll('audio, video').forEach(track);

  // Also catch players created with `new Audio()` that are never added to the page.
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play(...args) {
    track(this);
    lastPlayed = this;
    return originalPlay.apply(this, args);
  };
  document.addEventListener('play', (e) => { track(e.target); report(); }, true);
  setInterval(() => { scan(); report(); }, 2000);

  // ----- Automatic reconnect -----
  // While the user wants the radio on, re-tune the station whenever the stream
  // errors, ends, or is stuck loading (network drop, server hiccup), waiting a
  // little longer each time (3 s ... 30 s), and right away when the internet
  // comes back. Pressing stop (site button or tray) turns this off.
  let wantPlay = false;
  let retries = 0;
  let retryTimer = null;
  let stuckSince = 0;
  const player = () => document.getElementById('player');
  const canRetune = () => typeof selectStation === 'function' && typeof currentIndex === 'number' && currentIndex >= 0;
  const retune = () => {
    retryTimer = null;
    if (!wantPlay || !canRetune()) return;
    const el = player();
    if (el && !el.paused && el.readyState >= 3) { retries = 0; return; } // recovered by itself
    retries++;
    selectStation(currentIndex);
  };
  const scheduleRetune = (delay) => {
    if (!wantPlay || retryTimer) return;
    const d = delay != null ? delay : Math.min(30000, 3000 * Math.pow(2, Math.min(retries, 4)));
    retryTimer = setTimeout(retune, d);
  };
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('#stopBtn')) { wantPlay = false; clearTimeout(retryTimer); retryTimer = null; }
  }, true);
  document.addEventListener('playing', (e) => {
    if (e.target && e.target.id === 'player') { wantPlay = true; retries = 0; stuckSince = 0; }
  }, true);
  for (const type of ['error', 'ended', 'stalled']) {
    document.addEventListener(type, (e) => { if (e.target && e.target.id === 'player') scheduleRetune(); }, true);
  }
  window.addEventListener('online', () => { if (wantPlay) { clearTimeout(retryTimer); retryTimer = null; scheduleRetune(1000); } });
  setInterval(() => {
    const el = player();
    if (!wantPlay || !el) return;
    const ok = !el.paused && el.readyState >= 3;
    if (ok) { stuckSince = 0; return; }
    if (!stuckSince) stuckSince = Date.now();
    else if (Date.now() - stuckSince > 15000) { stuckSince = 0; scheduleRetune(0); }
  }, 5000);

  // Used by the tray menu. Prefer the site's own controls so its screen stays in sync.
  window.__shayRadio = {
    stop() {
      wantPlay = false;
      clearTimeout(retryTimer);
      retryTimer = null;
      const btn = document.getElementById('stopBtn');
      if (btn) btn.click();
      scan();
      media.forEach((el) => { if (!el.paused) el.pause(); });
      return true;
    },
    play() {
      // Re-tune the current station so it reconnects to the live broadcast.
      if (typeof selectStation === 'function' && typeof currentIndex === 'number' && currentIndex >= 0) {
        wantPlay = true;
        selectStation(currentIndex);
        return true;
      }
      scan();
      const el = lastPlayed || [...media][0];
      if (!el) return false;
      el.play().catch(() => {});
      return true;
    },
    toggle() {
      scan();
      return isPlaying() ? this.stop() : this.play();
    },
  };
}})();`);

window.addEventListener('shayradio-playing', () => ipcRenderer.send('radio-state', true));
window.addEventListener('shayradio-stopped', () => ipcRenderer.send('radio-state', false));

// Lets the site fetch now-playing info (song titles) without browser CORS
// limits: the app's main process does the request (see electron/main.js).
contextBridge.exposeInMainWorld('electronAPI', {
  fetchRaw: (url) => ipcRenderer.invoke('radio:fetch', url),
  icyTitle: (streamUrl) => ipcRenderer.invoke('radio:icyTitle', streamUrl),
  scrapeGlz: (pageUrl) => ipcRenderer.invoke('radio:scrapeGlz', pageUrl),
  scrapePageAudio: (pageUrl) => ipcRenderer.invoke('radio:scrapePageAudio', pageUrl),
});
