// Injected into the site by ShayRadioPlugin, before the site's own scripts.
// 1. The page always looks visible, so the player never stops the stream
//    when the app goes to the background.
// 2. Streams on plain http:// (e.g. ECO99FM) are tried over https:// first,
//    falling back to http:// if the station doesn't support it.
// 3. Tells the app when the radio plays/stops (and which station), and lets the
//    notification's play / stop buttons drive the site's own player.
(function () {
  if (window.__shayRadio) return;

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

  // --- http:// streams: try https:// first, fall back to the original. ---
  var srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (srcDesc && srcDesc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      enumerable: srcDesc.enumerable,
      get: function () { return srcDesc.get.call(this); },
      set: function (value) {
        var v = String(value);
        if (/^http:\/\//i.test(v)) {
          this.__shayHttpFallback = v;
          v = 'https://' + v.slice(7);
        } else {
          this.__shayHttpFallback = null;
        }
        srcDesc.set.call(this, v);
      }
    });
  }
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (!(el instanceof HTMLMediaElement) || !el.__shayHttpFallback) return;
    var original = el.__shayHttpFallback;
    el.__shayHttpFallback = null;
    srcDesc.set.call(el, original);
    el.play().catch(function () {});
  }, true);

  // --- Tell the app whether the radio is playing. ---
  var media = new Set();
  var lastState = null, lastTitle = null;
  function stationName() {
    var el = document.getElementById('vfdName');
    return el ? (el.textContent || '').trim() : '';
  }
  function isPlaying() {
    var playing = false;
    document.querySelectorAll('audio, video').forEach(function (el) { media.add(el); });
    media.forEach(function (el) { if (!el.paused && !el.ended) playing = true; });
    return playing;
  }
  function report() {
    var playing = isPlaying();
    var name = stationName();
    if ((playing === lastState && name === lastTitle) || !window.ShayRadioNative) return;
    lastState = playing;
    lastTitle = name;
    window.ShayRadioNative.setPlaying(playing, name);
  }
  function track(el) {
    if (media.has(el)) return;
    media.add(el);
    ['play', 'playing', 'pause', 'ended', 'emptied'].forEach(function (t) { el.addEventListener(t, report); });
  }
  var originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    track(this);
    setTimeout(report, 500);
    return originalPlay.apply(this, arguments);
  };
  document.addEventListener('play', function (e) { track(e.target); report(); }, true);
  document.addEventListener('pause', report, true);
  setInterval(report, 3000);

  // --- Play / stop from the notification, lock screen or headphones. ---
  window.__shayRadio = {
    play: function () {
      // Re-tune the current station so it reconnects to the live broadcast.
      if (typeof selectStation === 'function' && typeof currentIndex === 'number' && currentIndex >= 0) {
        selectStation(currentIndex);
        return true;
      }
      var btn = document.getElementById('playBtn');
      if (btn) { btn.click(); return true; }
      var el = document.querySelector('audio, video');
      if (el) { el.play().catch(function () {}); return true; }
      return false;
    },
    stop: function () {
      var btn = document.getElementById('stopBtn');
      if (btn) btn.click();
      media.forEach(function (el) { if (!el.paused) el.pause(); });
      return true;
    },
    toggle: function () {
      return isPlaying() ? this.stop() : this.play();
    }
  };
})();
