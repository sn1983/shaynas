// Temporary: run the site's own content-tab code (local site/radio-israel.html served at the
// real site address) against every CONTENT_ITEMS entry, with the app's real handlers.
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
require(path.join(process.cwd(), 'electron/electron-nowplaying-main.js'));
const SITE = 'https://shay-radio-il.netlify.app';
app.whenReady().then(async () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'site/radio-israel.html'));
  protocol.handle('https', (req) => req.url.startsWith(SITE + '/')
    ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    : net.fetch(req, { bypassCustomProtocolHandlers: true }));
  const site = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    preload: path.join(process.cwd(), 'electron/preload.js') } });
  site.webContents.setAudioMuted(true);
  await site.loadURL(SITE + '/');
  const ids = await site.webContents.executeJavaScript('CONTENT_ITEMS.map(i => i.id)');
  for (const id of ids) {
    const t0 = Date.now();
    const r = await site.webContents.executeJavaScript(`(async () => {
      const item = CONTENT_ITEMS.find(i => i.id === ${JSON.stringify(id)});
      const viaHtml = item.latestFromHtml ? await latestAudioFromHtml(item.pageUrl) : null;
      const res = await resolveContentAudio(item);
      return { name: item.name, viaHtml, res };
    })()`).catch((e) => ({ err: e.message }));
    const ok = r.res && r.res.url && !r.res.live;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${id} | ${r.name} | ${Date.now() - t0} ms | html=${r.viaHtml ? 'yes' : '-'} | ${JSON.stringify(r.res || r.err).slice(0, 200)}`);
  }
  app.exit(0);
});
