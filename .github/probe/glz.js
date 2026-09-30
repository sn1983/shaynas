// Temporary: why does the Hadar Marks (glz) episode not play? Scrape it and try playing the result.
const { app, BrowserWindow } = require('electron');
const path = require('path');
require(path.join(process.cwd(), 'electron/electron-nowplaying-main.js'));
const PAGES = [
  'https://glz.co.il/גלגלצ/תכניות/מדינה-בדרך-עם-הדר-מרקס',
  'https://glz.co.il/גלגלצ/תכניות/קולות-החיילים',
  'https://glz.co.il/גלצ/תוכניות/חמש-בערב',
];
app.whenReady().then(async () => {
  const site = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    preload: path.join(process.cwd(), 'electron/preload.js') } });
  await site.loadURL('https://shay-radio-il.netlify.app/');
  const probe = new BrowserWindow({ show: false, webPreferences: { sandbox: true, autoplayPolicy: 'no-user-gesture-required' } });
  await probe.loadURL('https://shay-radio-il.netlify.app/');
  for (const p of PAGES) {
    for (let k = 0; k < 2; k++) {
      const url = await site.webContents.executeJavaScript('window.electronAPI.scrapePageAudio(' + JSON.stringify(p) + ')').catch((e) => 'ERR ' + e.message);
      console.log('RES scrape', decodeURI(p).split('/').pop(), '->', url);
      if (!url || String(url).startsWith('ERR')) continue;
      try {
        const r = await fetch(url, { redirect: 'follow', headers: { Range: 'bytes=0-15' } });
        const b = Buffer.from(await r.arrayBuffer());
        console.log('RES   fetch', r.status, r.url.slice(0, 160), r.headers.get('content-type'), r.headers.get('content-range'), JSON.stringify(b.toString('latin1').slice(0, 16)));
      } catch (e) { console.log('RES   fetch error', e.message); }
      const play = await probe.webContents.executeJavaScript(`new Promise((res) => {
        const a = new Audio(); a.muted = true; let done = false;
        const fin = (x) => { if (!done) { done = true; res(x); } };
        a.onloadedmetadata = () => fin('metadata ok duration=' + Math.round(a.duration) + 's');
        a.onerror = () => fin('error code=' + (a.error && a.error.code) + ' ' + (a.error && a.error.message));
        setTimeout(() => fin('timeout readyState=' + a.readyState + ' networkState=' + a.networkState), 20000);
        a.src = ${JSON.stringify(url)}; a.play().catch((e) => {});
      })`);
      console.log('RES   audio', play);
    }
  }
  app.exit(0);
});
