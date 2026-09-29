// Injected into the site by ShayRadioPlugin, before the site's own scripts.
//
// On Android the radio is played by the app's native player (ExoPlayer) instead
// of the WebView: it keeps playing in the background, plays every stream format
// (e.g. ECO99FM) and reconnects by itself. This script routes the site's
// <audio id="player"> to it, and reports the native player's state back to the
// element so the site's display and buttons keep working as before.
(function () {
  if (window.__shayRadio) return;
  var N = window.ShayRadioNative;

  // The page always looks visible, so it never pauses itself in the background.
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

  if (!N) return; // not inside the Android app

  // Now-playing helpers, same API as the Windows app's window.electronAPI
  // (see NowPlaying.java): the app does the requests, so CORS doesn't apply.
  var npCalls = {}, npSeq = 0;
  window.__shayNP = function (id, result) {
    var done = npCalls[id];
    if (!done) return;
    delete npCalls[id];
    done(result);
  };
  function npCall(method, url, fallback) {
    return new Promise(function (resolve) {
      var id = String(++npSeq);
      var timer = setTimeout(function () { window.__shayNP(id, fallback); }, 20000);
      npCalls[id] = function (result) { clearTimeout(timer); resolve(result); };
      try { N[method](id, String(url)); } catch (e) { window.__shayNP(id, fallback); }
    });
  }
  window.electronAPI = {
    fetchRaw: function (url) { return npCall('fetchRaw', url, { ok: false, status: 0, text: '', error: 'failed' }); },
    icyTitle: function (streamUrl) { return npCall('icyTitle', streamUrl, null); },
    scrapeGlz: function (pageUrl) { return npCall('scrapeGlz', pageUrl, null); }
  };

  // Exit button inside the app (Android has no tray icon with "exit" like Windows).
  function addExitButton() {
    if (document.getElementById('shay-exit-btn') || !document.body) return;
    var b = document.createElement('button');
    b.id = 'shay-exit-btn';
    b.type = 'button';
    b.textContent = '✕ יציאה';
    b.setAttribute('aria-label', 'יציאה מהאפליקציה');
    b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;'
      + 'padding:8px 14px;border:1px solid rgba(255,255,255,.25);border-radius:999px;'
      + 'background:rgba(20,20,22,.85);color:#e9e6df;font:600 14px Heebo,Arial,sans-serif;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,.5);cursor:pointer;';
    b.addEventListener('click', function () {
      if (window.confirm('לצאת מהאפליקציה? הרדיו יפסיק לנגן.')) N.exitApp();
    });
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addExitButton);
  else addExitButton();

  // HLS stations (.m3u8) are played natively too: make the site hand the
  // playlist URL to the player instead of using hls.js in the page.
  var realHls;
  try {
    Object.defineProperty(window, 'Hls', {
      configurable: true,
      get: function () { return realHls; },
      set: function (v) {
        if (v) { try { v.isSupported = function () { return false; }; } catch (e) {} }
        realHls = v;
      }
    });
  } catch (e) {}

  var proto = HTMLMediaElement.prototype;
  var srcDesc = Object.getOwnPropertyDescriptor(proto, 'src');
  var volDesc = Object.getOwnPropertyDescriptor(proto, 'volume');
  var origPlay = proto.play;
  var origPause = proto.pause;

  var el = null;          // the site's <audio id="player">
  var nativePlaying = false;
  var pending = null;     // promise returned by the last play()

  function isMain(media) { return media && media.id === 'player'; }
  function fire(type) { if (el) el.dispatchEvent(new Event(type)); }
  function stationName() {
    var n = document.getElementById('vfdName');
    return n ? (n.textContent || '').trim() : '';
  }

  function adopt(media) {
    if (el === media) return;
    el = media;
    Object.defineProperty(media, 'paused', { configurable: true, get: function () { return !nativePlaying; } });
    Object.defineProperty(media, 'volume', {
      configurable: true,
      get: function () { return volDesc.get.call(media); },
      set: function (v) { volDesc.set.call(media, v); try { N.setVolume(Number(v)); } catch (e) {} }
    });
  }

  // Keep the stream URL for the native player; the WebView never loads it.
  Object.defineProperty(proto, 'src', {
    configurable: true,
    enumerable: srcDesc.enumerable,
    get: function () { return isMain(this) ? (this.__shayUrl || '') : srcDesc.get.call(this); },
    set: function (v) {
      if (isMain(this)) { adopt(this); this.__shayUrl = v ? new URL(String(v), location.href).href : ''; return; }
      srcDesc.set.call(this, v);
    }
  });

  proto.play = function () {
    if (!isMain(this)) return origPlay.apply(this, arguments);
    adopt(this);
    var url = this.__shayUrl;
    if (!url) return Promise.reject(new DOMException('No station selected', 'NotSupportedError'));
    var p = {};
    var promise = new Promise(function (resolve, reject) { p.resolve = resolve; p.reject = reject; });
    promise.catch(function () {});
    pending = p;
    fire('play');
    N.playStream(url, stationName(), Number(volDesc.get.call(this)));
    return promise;
  };

  proto.pause = function () {
    if (!isMain(this)) return origPause.apply(this, arguments);
    N.stopStream();
  };

  // Called by the app when the native player's state changes.
  window.__shayRadio = {
    _native: function (state) {
      if (state === 'playing') {
        nativePlaying = true;
        if (pending) { pending.resolve(); pending = null; }
        fire('playing');
      } else if (state === 'buffering') {
        fire('waiting');
        if (typeof setStatus === 'function' && !nativePlaying) setStatus('מתחבר...');
      } else if (state === 'paused') {
        var was = nativePlaying;
        nativePlaying = false;
        pending = null; // stopped while connecting: no error message
        if (was) fire('pause');
      } else if (state === 'error') {
        nativePlaying = false;
        if (pending) {
          pending.reject(new DOMException('Stream failed', 'NotSupportedError'));
          pending = null;
        } else if (typeof setStatus === 'function') {
          setStatus('שגיאת שידור — נסו תחנה אחרת.');
        }
        fire('pause');
      }
    }
  };
})();
