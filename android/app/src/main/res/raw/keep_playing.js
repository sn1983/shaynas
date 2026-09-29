// Injected into the site by ShayRadioPlugin, before the site's own scripts.
//
// On Android the radio is played by the app's native player (ExoPlayer) instead
// of the WebView: it keeps playing in the background, plays every stream format
// (e.g. ECO99FM) and reconnects by itself. This script routes the site's
// <audio id="player"> to it, and reports the native player's state back to the
// element so the site's display and buttons keep working as before.
(function () {
  // Only the site's main page (not ad/Netlify iframes inside it).
  if (window.top !== window) return;
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
    scrapeGlz: function (pageUrl) { return npCall('scrapeGlz', pageUrl, null); },
    scrapePageAudio: function (pageUrl) { return npCall('scrapePageAudio', pageUrl, null); }
  };

  // ----- Car mode -----
  // Full-screen "locked" view with only big controls: previous / stop / play /
  // next station, and an unlock button that needs a long press (so a touch
  // while driving doesn't leave car mode). The screen stays on meanwhile.
  var car = null;

  function visibleIndexes() {
    if (typeof stations === 'undefined' || !stations) return [];
    var favOnly = (typeof currentTab !== 'undefined' && currentTab === 'fav');
    var list = [];
    for (var i = 0; i < stations.length; i++) {
      if (stations[i] && stations[i].url && (!favOnly || stations[i].favorite)) list.push(i);
    }
    if (!list.length && favOnly) return visibleIndexesAll();
    return list;
  }
  function visibleIndexesAll() {
    var list = [];
    for (var i = 0; i < stations.length; i++) if (stations[i] && stations[i].url) list.push(i);
    return list;
  }
  function stepStation(dir) {
    if (typeof selectStation !== 'function') return;
    var list = visibleIndexes();
    if (!list.length) return;
    var cur = (typeof currentIndex === 'number') ? list.indexOf(currentIndex) : -1;
    var next = cur === -1 ? (dir > 0 ? 0 : list.length - 1) : (cur + dir + list.length) % list.length;
    selectStation(list[next]);
  }
  function carPlay() {
    if (typeof selectStation !== 'function') return;
    if (typeof currentIndex === 'number' && currentIndex >= 0) selectStation(currentIndex);
    else stepStation(1);
  }
  function carStop() {
    var btn = document.getElementById('stopBtn');
    if (btn) btn.click();
  }

  function carButton(icon, label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span style="font-size:44px;line-height:1">' + icon + '</span><span style="font-size:15px;margin-top:6px">' + label + '</span>';
    b.style.cssText = 'flex:1;min-width:0;min-height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;'
      + 'border:none;border-radius:18px;background:linear-gradient(180deg,#4a4a51,#2a2a2f);color:#ffb040;'
      + 'box-shadow:0 4px 0 #111,inset 0 1px 0 rgba(255,255,255,.2);font-family:Heebo,Arial,sans-serif;font-weight:700;'
      + '-webkit-tap-highlight-color:transparent;touch-action:manipulation;';
    b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
    return b;
  }

  function openCarMode() {
    if (car) return;
    car = document.createElement('div');
    car.id = 'shay-car-mode';
    car.setAttribute('dir', 'rtl');
    car.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0d0d0f;color:#e9e6df;'
      + 'display:flex;flex-direction:column;justify-content:space-between;gap:16px;'
      + 'padding:calc(16px + env(safe-area-inset-top,0px)) 16px calc(16px + env(safe-area-inset-bottom,0px));'
      + 'font-family:Heebo,Arial,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none;';
    // swallow every touch that isn't on one of our buttons (the page underneath is locked)
    ['click', 'touchstart', 'touchmove', 'pointerdown', 'wheel', 'contextmenu'].forEach(function (t) {
      car.addEventListener(t, function (e) { if (!e.target.closest('button')) e.preventDefault(); e.stopPropagation(); }, { passive: false });
    });

    var info = document.createElement('div');
    info.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:0;';
    info.innerHTML = '<div style="font-size:14px;color:#8a5a1e;letter-spacing:2px">🚗 מצב רכב</div>'
      + '<div data-car="name" style="font-size:clamp(30px,9vw,56px);font-weight:900;color:#ffb040;text-shadow:0 0 12px rgba(255,176,64,.6);margin-top:10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>'
      + '<div data-car="song" style="font-size:clamp(16px,4.5vw,24px);color:#e9e6df;margin-top:10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>'
      + '<div data-car="status" style="font-size:15px;color:#9a978f;margin-top:8px"></div>';

    var row = document.createElement('div');
    row.setAttribute('dir', 'ltr');
    row.style.cssText = 'display:flex;gap:12px;';
    row.appendChild(carButton('⏮', 'הקודמת', function () { stepStation(-1); }));
    row.appendChild(carButton('■', 'עצור', carStop));
    row.appendChild(carButton('▶', 'נגן', carPlay));
    row.appendChild(carButton('⏭', 'הבאה', function () { stepStation(1); }));

    // Unlock: hold for 1.2 s
    var unlock = document.createElement('button');
    unlock.type = 'button';
    unlock.style.cssText = 'position:relative;overflow:hidden;min-height:56px;border:1px solid #48484f;border-radius:14px;'
      + 'background:#1c1c1f;color:#e9e6df;font:700 16px Heebo,Arial,sans-serif;-webkit-tap-highlight-color:transparent;touch-action:none;';
    unlock.innerHTML = '<span data-car="fill" style="position:absolute;inset:0;width:0;background:rgba(255,176,64,.35)"></span>'
      + '<span style="position:relative">🔓 החזיקו לחוץ לפתיחת הנעילה</span>';
    var fill = unlock.querySelector('[data-car="fill"]');
    var holdTimer = null, holdStart = 0, raf = null;
    function holdStartFn(e) {
      e.preventDefault(); e.stopPropagation();
      holdStart = Date.now();
      var tick = function () {
        var p = Math.min(1, (Date.now() - holdStart) / 1200);
        fill.style.width = (p * 100) + '%';
        if (p >= 1) { closeCarMode(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    function holdEndFn(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      fill.style.width = '0';
    }
    unlock.addEventListener('pointerdown', holdStartFn);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { unlock.addEventListener(t, holdEndFn); });
    unlock.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });

    car.appendChild(info);
    car.appendChild(row);
    car.appendChild(unlock);
    document.body.appendChild(car);

    var update = function () {
      if (!car) return;
      var get = function (id) { var el = document.getElementById(id); return el ? (el.textContent || '').trim() : ''; };
      car.querySelector('[data-car="name"]').textContent = get('vfdName') || 'בחרו תחנה';
      car.querySelector('[data-car="song"]').textContent = get('vfdSong');
      car.querySelector('[data-car="status"]').textContent = get('vfdStatus');
    };
    update();
    car._timer = setInterval(update, 1000);
    try { N.setKeepScreenOn(true); } catch (e) {}
  }

  function closeCarMode() {
    if (!car) return;
    clearInterval(car._timer);
    car.remove();
    car = null;
    try { N.setKeepScreenOn(false); } catch (e) {}
  }

  // Small buttons above the site's clock: car mode and exit (Android has no tray
  // icon with "exit" like Windows). The clock moves down a little so nothing is covered.
  function smallButton(id, text, label) {
    var b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('aria-label', label);
    b.style.cssText = 'padding:2px 8px;border:1px solid rgba(255,255,255,.25);border-radius:999px;'
      + 'background:rgba(20,20,22,.85);color:#e9e6df;font:600 11px Heebo,Arial,sans-serif;'
      + 'line-height:16px;cursor:pointer;white-space:nowrap;';
    return b;
  }
  function addExitButton() {
    if (document.getElementById('shay-exit-btn') || !document.body) return;
    var exitBtn = smallButton('shay-exit-btn', '✕ יציאה', 'יציאה מהאפליקציה');
    exitBtn.addEventListener('click', function () {
      if (window.confirm('לצאת מהאפליקציה? הרדיו יפסיק לנגן.')) N.exitApp();
    });
    var carBtn = smallButton('shay-car-btn', '🚗 מצב רכב', 'מצב רכב');
    carBtn.addEventListener('click', openCarMode);

    var buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:6px;';
    buttons.appendChild(carBtn);
    buttons.appendChild(exitBtn);

    var clock = document.getElementById('clock');
    if (clock && clock.parentNode) {
      var box = document.createElement('div');
      box.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:4px;';
      clock.parentNode.insertBefore(box, clock);
      box.appendChild(buttons);
      box.appendChild(clock);
    } else {
      // No clock on the page: small buttons fixed in the top-left corner.
      buttons.style.cssText += 'position:fixed;left:8px;top:calc(8px + env(safe-area-inset-top, 0px));z-index:2147483646;';
      document.body.appendChild(buttons);
    }
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
