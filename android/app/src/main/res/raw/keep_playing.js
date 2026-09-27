// Injected into the site by MainActivity.
// 1. The page always looks visible, so the site's player does not stop the
//    stream when the app goes to the background.
// 2. Tells the app when audio starts/stops, so Android keeps the app alive
//    (with a "now playing" notification) while the radio plays.
(function () {
  if (window.__shayRadioKeepPlaying) return;
  window.__shayRadioKeepPlaying = true;

  var always = function (value) { return { configurable: true, get: function () { return value; } }; };
  Object.defineProperty(Document.prototype, 'hidden', always(false));
  Object.defineProperty(Document.prototype, 'visibilityState', always('visible'));
  Object.defineProperty(Document.prototype, 'webkitHidden', always(false));
  Object.defineProperty(Document.prototype, 'webkitVisibilityState', always('visible'));
  Document.prototype.hasFocus = function () { return true; };
  ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'freeze', 'blur'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (e.target === window || e.target === document) e.stopImmediatePropagation();
    }, true);
  });

  var media = new Set();
  var lastState = null;
  function report() {
    var playing = false;
    document.querySelectorAll('audio, video').forEach(function (el) { media.add(el); });
    media.forEach(function (el) { if (!el.paused && !el.ended) playing = true; });
    if (playing !== lastState && window.ShayRadioNative) {
      lastState = playing;
      window.ShayRadioNative.setPlaying(playing);
    }
  }
  function track(el) {
    if (media.has(el)) return;
    media.add(el);
    ['play', 'playing', 'pause', 'ended', 'emptied'].forEach(function (t) { el.addEventListener(t, report); });
  }
  // Catch players created with `new Audio()` that are never added to the page.
  var originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    track(this);
    var result = originalPlay.apply(this, arguments);
    setTimeout(report, 300);
    return result;
  };
  document.addEventListener('play', function (e) { track(e.target); report(); }, true);
  document.addEventListener('pause', report, true);
  document.querySelectorAll('audio, video').forEach(track);
  setInterval(report, 3000);
  report();
})();
