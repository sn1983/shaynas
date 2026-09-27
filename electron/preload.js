// Runs before the site's own scripts. Makes the page believe it is always
// visible, so the site's player does not pause/stop the stream when the
// window is minimized or hidden to the tray.
const { webFrame } = require('electron');

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
}})();`);
