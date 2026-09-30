// Temporary: run the new content-tab code from site/radio-israel.html inside the live site
// (real origin, so the app's handlers accept it) against every CONTENT_ITEMS entry.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
require(path.join(process.cwd(), 'electron/electron-nowplaying-main.js'));
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ err: 'TIMEOUT' }), ms))]);
app.whenReady().then(async () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'site/radio-israel.html'), 'utf8');
  const items = html.slice(html.indexOf('const CONTENT_ITEMS'), html.indexOf('let lastContentItem'));
  const helpers = html.slice(html.indexOf('// Content items must play'), html.indexOf('async function playContentItem'));
  const code = `window.__T = (() => { ${items} ${helpers} return { CONTENT_ITEMS, latestAudioFromHtml, resolveContentAudio }; })(); window.__T.CONTENT_ITEMS.map(i => i.id)`;
  const site = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    preload: path.join(process.cwd(), 'electron/preload.js') } });
  site.webContents.setAudioMuted(true);
  await site.loadURL('https://shay-radio-il.netlify.app/');
  const ids = await site.webContents.executeJavaScript(code);
  console.log('START ' + ids.length + ' items');
  for (const id of ids) {
    const t0 = Date.now();
    const r = await withTimeout(site.webContents.executeJavaScript(`(async () => {
      const item = __T.CONTENT_ITEMS.find(i => i.id === ${JSON.stringify(id)});
      const viaHtml = item.latestFromHtml ? await __T.latestAudioFromHtml(item.pageUrl) : null;
      const res = await __T.resolveContentAudio(item);
      return { name: item.name, viaHtml, res };
    })()`).catch((e) => ({ err: e.message })), 90000);
    const ok = r.res && r.res.url && !r.res.live;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${id} | ${r.name} | ${Date.now() - t0} ms | html=${r.viaHtml ? 'yes' : '-'} | ${JSON.stringify(r.res || r.err).slice(0, 200)}`);
  }
  app.exit(0);
});
