// Temporary: run the new content-tab code from site/radio-israel.html inside the live site.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
require(path.join(process.cwd(), 'electron/electron-nowplaying-main.js'));
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ err: 'TIMEOUT' }), ms))]);
app.whenReady().then(async () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'site/radio-israel.html'), 'utf8');
  const items = html.slice(html.indexOf('const CONTENT_ITEMS'), html.indexOf('let lastContentItem'));
  const helpers = html.slice(html.indexOf('// Content items must play'), html.indexOf('async function playContentItem'));
  const code = `window.__T = (() => { let lastContentItem = null; const setStatus = (s) => console.log('status: ' + s); ${items} ${helpers} return { CONTENT_ITEMS, resolveContentAudio }; })(); window.__T.CONTENT_ITEMS.map(i => i.id)`;
  const site = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    preload: path.join(process.cwd(), 'electron/preload.js') } });
  site.webContents.setAudioMuted(true);
  await site.loadURL('https://shay-radio-il.netlify.app/');
  const ids = await site.webContents.executeJavaScript(code);
  const probe = new BrowserWindow({ show: false, webPreferences: { sandbox: true, autoplayPolicy: 'no-user-gesture-required' } });
  await probe.loadURL('https://shay-radio-il.netlify.app/');
  const order = ['glglz-hadar-marks', 'glglz-hadar-marks', 'glglz-hadar-marks', ...ids.filter((i) => i !== 'glglz-hadar-marks')];
  for (const id of order) {
    const t0 = Date.now();
    const r = await withTimeout(site.webContents.executeJavaScript(`__T.resolveContentAudio(__T.CONTENT_ITEMS.find(i => i.id === ${JSON.stringify(id)}))`).catch((e) => ({ err: e.message })), 120000);
    let play = '-';
    if (r.url) play = await probe.webContents.executeJavaScript(`new Promise((res) => {
      const a = new Audio(); a.muted = true; let done = false;
      const fin = (x) => { if (!done) { done = true; a.src = ''; res(x); } };
      a.onloadedmetadata = () => fin('plays (' + Math.round(a.duration / 60) + ' min)');
      a.onerror = () => fin('ERROR code=' + (a.error && a.error.code));
      setTimeout(() => fin('timeout'), 20000);
      a.src = ${JSON.stringify(r.url)};
    })`);
    console.log(`RES ${play.startsWith('plays') ? 'OK  ' : 'FAIL'} ${id} | ${Date.now() - t0} ms | ${play} | ${JSON.stringify(r).slice(0, 170)}`);
  }
  app.exit(0);
});
