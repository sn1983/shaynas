// Temporary end-to-end check: real Electron + our preload + handlers, on the live site.
const { app, BrowserWindow } = require('electron');
const path = require('path');
require(path.join(process.cwd(), 'electron/electron-nowplaying-main.js'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    preload: path.join(process.cwd(), 'electron/preload.js') } });
  await win.loadURL('https://shay-radio-il.netlify.app/');
  const run = (js) => win.webContents.executeJavaScript(js).catch((e) => 'ERR ' + e.message);
  console.log('electronAPI:', await run('Object.keys(window.electronAPI||{}).join(",")'));
  const html = await run('document.documentElement.outerHTML');
  console.log('site mentions scrapePageAudio:', (html.match(/scrapePageAudio/g) || []).length, '| "תוכן נבחר":', html.includes('תוכן נבחר'));
  (html.match(/.{0,160}scrapePageAudio.{0,200}/g) || []).slice(0, 6).forEach((m) => console.log('  ctx:', m.replace(/\s+/g, ' ')));
  (html.match(/\{[^{}]{0,400}pageUrl[^{}]{0,400}\}/g) || []).slice(0, 12).forEach((m) => console.log('  item:', m.replace(/\s+/g, ' ')));
  const pages = [...new Set((html.match(/pageUrl\s*:\s*["'`](https?:\/\/[^"'`]+)["'`]/g) || [])
    .map((m) => m.match(/https?:\/\/[^"'`]+/)[0]))];
  console.log('candidate program pages:', pages.length);
  for (const p of pages) {
    const t0 = Date.now();
    const r = await run('window.electronAPI.scrapePageAudio(' + JSON.stringify(p) + ')');
    console.log('scrapePageAudio', p, '->', JSON.stringify(r), `(${Date.now() - t0} ms)`);
    if (!r || String(r).startsWith('ERR')) {
      // show what the page contains, like the glz debug
      const g = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      g.webContents.setAudioMuted(true);
      await g.loadURL(p).catch(() => {});
      await new Promise((r2) => setTimeout(r2, 5000));
      const dbg = await g.webContents.executeJavaScript(`JSON.stringify({
        audio: [...document.querySelectorAll('audio,video,source')].map(e => e.tagName + ' src=' + (e.currentSrc || e.src || '') ),
        data: [...document.querySelectorAll('*')].flatMap(e => [...e.attributes].filter(a => /^data-.*(src|audio|mp3|file|stream|url)/i.test(a.name)).map(a => a.name + '=' + a.value.slice(0,120))).slice(0,15),
        media: performance.getEntriesByType('resource').map(e => e.name).filter(n => /mp3|m4a|aac|m3u8|audio|podcast|omny|spotify|soundcloud|player/i.test(n)).slice(0,15),
        iframes: [...document.querySelectorAll('iframe')].map(f => f.src).slice(0,10)
      })`).catch((e) => 'ERR ' + e.message);
      console.log('   debug:', dbg);
      g.destroy();
    }
  }
  app.exit(0);
});
