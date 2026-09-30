// Temporary: test every CONTENT_ITEMS pageUrl of site/radio-israel.html with the app's real scrapePageAudio.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
require(path.join(process.cwd(), 'electron/electron-nowplaying-main.js'));
app.whenReady().then(async () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'site/radio-israel.html'), 'utf8');
  const block = html.slice(html.indexOf('const CONTENT_ITEMS'), html.indexOf('let lastContentItem'));
  const items = [...block.matchAll(/id: '([^']+)',\s*name: '((?:[^'\\]|\\.)*)',[\s\S]*?pageUrl: '([^']+)'/g)].map((m) => ({ id: m[1], name: m[2], url: m[3] }));
  const site = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    preload: path.join(process.cwd(), 'electron/preload.js') } });
  await site.loadURL('https://shay-radio-il.netlify.app/');
  for (const it of items) {
    const t0 = Date.now();
    const r = await site.webContents.executeJavaScript('window.electronAPI.scrapePageAudio(' + JSON.stringify(it.url) + ')').catch((e) => 'ERR ' + e.message);
    console.log(`${r && !String(r).startsWith('ERR') ? 'OK  ' : 'FAIL'} ${it.id} | ${it.name} | ${Date.now() - t0} ms | ${String(r).slice(0, 150)}`);
  }
  app.exit(0);
});
