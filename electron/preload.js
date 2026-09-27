// Runs before the site's own scripts.
// 1. Makes the page believe it is always visible, so the site's player does
//    not pause/stop the stream when the window is minimized or in the tray.
// 2. Tracks the site's audio players so the tray menu can play/stop the
//    stream and show whether it is playing.
const { webFrame, ipcRenderer } = require('electron');

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

  // Used by the tray menu.
  window.__shayRadio = {
    stop() {
      scan();
      media.forEach((el) => { if (!el.paused) el.pause(); });
    },
    play() {
      scan();
      const el = lastPlayed || [...media][0];
      if (!el) return false;
      // Live stream: reconnect so playback resumes "live" instead of from an old buffer.
      if (el.src && !el.src.startsWith('blob:') && !Number.isFinite(el.duration)) el.load();
      el.play().catch(() => {});
      return true;
    },
    toggle() {
      scan();
      if (isPlaying()) { this.stop(); return true; }
      return this.play();
    },
  };
}})();`);

window.addEventListener('shayradio-playing', () => ipcRenderer.send('radio-state', true));
window.addEventListener('shayradio-stopped', () => ipcRenderer.send('radio-state', false));
