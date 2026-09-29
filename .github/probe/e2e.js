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
  // glz episode page: what does pressing play load?
  const ep = 'https://glz.co.il/גלגלצ/תכניות/המצעד-השבועי/המצעד-השבועי-עם-דלית-רצשטר-030926/';
  const g = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  g.webContents.setAudioMuted(true);
  const reqs = [];
  g.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (d, cb) => {
    if (/mp3|m4a|aac|m3u8|bynetcdn|podcast|umbraco\/api|omny|audio/i.test(d.url) && !/youtube|google|\.(png|jpg|svg|css|woff)/i.test(d.url)) reqs.push(d.resourceType + ' ' + d.url.slice(0, 220));
    cb({});
  });
  await g.loadURL(ep).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  const info = await g.webContents.executeJavaScript(`JSON.stringify({
    mp3InHtml: (document.documentElement.outerHTML.match(/[^"'\\s<>]{0,120}\\.(mp3|m4a|aac|m3u8)[^"'\\s<>]{0,60}/gi) || []).slice(0, 10),
    playButtons: [...document.querySelectorAll('button,a,[role=button],[x-on\\:click],[\\@click]')].filter(e => /play|האזנה|נגן|listen/i.test((e.className||'') + ' ' + (e.getAttribute('aria-label')||'') + ' ' + (e.textContent||'').slice(0,30) + ' ' + [...e.attributes].map(a=>a.name+'='+a.value).join(' '))).slice(0, 12)
      .map(e => e.tagName + ' ' + [...e.attributes].map(a => a.name + '=' + a.value.slice(0, 100)).join(' | ') + ' :: ' + (e.textContent||'').trim().slice(0, 40))
  })`).catch((e) => 'ERR ' + e.message);
  console.log('glz episode info:', info);
  console.log('glz requests before click:', JSON.stringify(reqs));
  reqs.length = 0;
  await g.webContents.executeJavaScript(`[...document.querySelectorAll('button,a,[role=button]')].filter(e => /play|האזנה|נגן|listen/i.test((e.className||'') + ' ' + (e.getAttribute('aria-label')||'') + ' ' + (e.textContent||'').slice(0,30))).slice(0, 6).forEach(e => { try { e.click(); } catch (x) {} }); 1`).catch(() => {});
  await new Promise((r) => setTimeout(r, 6000));
  console.log('glz requests after clicking play:', JSON.stringify(reqs));
  console.log('glz audio after click:', await g.webContents.executeJavaScript(`JSON.stringify([...document.querySelectorAll('audio,video')].map(a => a.currentSrc || a.src))`).catch(() => 'ERR'));
  app.exit(0);
});
