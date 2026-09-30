// Temporary: find active programs on stations other than גלגלצ, test each with the app's real scrapePageAudio.
const { app, BrowserWindow } = require('electron');
const path = require('path');
require(path.join(process.cwd(), 'electron/electron-nowplaying-main.js'));

const INDEXES = {
  kan: ['https://www.kan.org.il/content/kan/kan-88/', 'https://www.kan.org.il/content/kan/kan-gimel/', 'https://www.kan.org.il/content/kan/kan-bet/',
        'https://www.kan.org.il/content/kan/kan-tarbut/', 'https://www.kan.org.il/content/kan/kan-music/', 'https://www.kan.org.il/content/kan/kan-actual/',
        'https://www.kan.org.il/radio/', 'https://www.kan.org.il/content/kan/podcasts/'],
  glz: ['https://glz.co.il/גלצ/תכניות/', 'https://glz.co.il/גלצ/', 'https://glz.co.il/תכניות/'],
  fm103: ['https://103fm.maariv.co.il/', 'https://103fm.maariv.co.il/programs/'],
  fm102: ['https://www.102fm.co.il/', 'https://102fm.co.il/programs/'],
  eco: ['https://eco99fm.maariv.co.il/'],
  darom: ['https://www.radiodarom.co.il/'],
};
const KEEP = {
  kan: (h) => /kan\.org\.il\/content\/kan\/(kan-88|kan-gimel|kan-bet|kan-tarbut|kan-music|kan-actual|podcasts)\/p-\d+\/?$/.test(h),
  glz: (h) => /glz\.co\.il\/גלצ\/(תכניות|תוכניות)\/[^/?#]+\/?$/.test(h),
  fm103: (h) => /103fm\.maariv\.co\.il\/(program|programs|p)\/[^?#]+$/i.test(h),
  fm102: (h) => /102fm\.co\.il\/.+/.test(h),
  eco: (h) => /eco99fm\.maariv\.co\.il\/.+/.test(h),
  darom: (h) => /radiodarom\.co\.il\/.+/.test(h),
};
const LIMIT = { kan: 45, glz: 12, fm103: 8, fm102: 8, eco: 6, darom: 8 };
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))]);

app.whenReady().then(async () => {
  const site = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    preload: path.join(process.cwd(), 'electron/preload.js') } });
  await site.loadURL('https://shay-radio-il.netlify.app/');
  const scrape = (u) => site.webContents.executeJavaScript('window.electronAPI.scrapePageAudio(' + JSON.stringify(u) + ')').catch((e) => 'ERR ' + e.message);
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  w.webContents.setAudioMuted(true);
  const load = (u) => withTimeout(w.loadURL(u).catch(() => {}), 25000);

  for (const [st, pages] of Object.entries(INDEXES)) {
    const links = new Map();
    const sample = new Set();
    for (const p of pages) {
      await load(p);
      await new Promise((r) => setTimeout(r, 3500));
      const found = await withTimeout(w.webContents.executeJavaScript(`[...document.querySelectorAll('a[href]')].map(a => { let h = a.href.split('#')[0]; try { h = decodeURI(h); } catch (e) {} return [h, (a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,50)]; })`).catch(() => []), 10000);
      for (const [href, text] of (Array.isArray(found) ? found : [])) {
        if (sample.size < 25 && !/facebook|twitter|instagram|whatsapp|youtube|apple|google/.test(href)) sample.add(href);
        if (KEEP[st](href) && !links.has(href)) links.set(href, text);
      }
    }
    console.log(`\nRES ##### ${st}: ${links.size} links`);
    if (links.size === 0 || st !== 'kan' && st !== 'glz') console.log('RES sample: ' + [...sample].join('  '));
    let n = 0;
    for (const [href, text] of links) {
      if (n++ >= LIMIT[st]) break;
      let meta = {};
      await load(href);
      await new Promise((r) => setTimeout(r, 2500));
      meta = await withTimeout(w.webContents.executeJavaScript(`(() => {
        const t = (document.querySelector('h1')||{}).textContent || document.title || '';
        const dates = (document.body.innerText.match(/\\b(\\d{1,2})[./](\\d{1,2})[./](20)?(2[4-6])\\b/g) || []).slice(0, 4);
        return { title: t.replace(/\\s+/g,' ').trim().slice(0,60), dates };
      })()`).catch(() => ({})), 8000);
      const t0 = Date.now();
      const audio = await withTimeout(scrape(href), 40000);
      console.log(`RES - ${text} | ${href} | title=${meta.title} | dates=${JSON.stringify(meta.dates)} | ${Date.now() - t0}ms | audio=${String(audio).slice(0, 170)}`);
    }
  }
  app.exit(0);
});
