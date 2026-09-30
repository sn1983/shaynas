// Temporary: discover on-demand program pages on the stations already in the site,
// and test each with the app's real scrapePageAudio (Electron + our preload/handlers).
const { app, BrowserWindow } = require('electron');
const path = require('path');
require(path.join(process.cwd(), 'electron/electron-nowplaying-main.js'));

const INDEXES = {
  'גלגלצ': ['https://glz.co.il/גלגלצ/תכניות/'],
  'גלי צה"ל': ['https://glz.co.il/גלצ/תכניות/'],
  'כאן': ['https://www.kan.org.il/content/kan/kan-88/', 'https://www.kan.org.il/content/kan/kan-gimel/', 'https://www.kan.org.il/content/kan/kan-bet/', 'https://www.kan.org.il/content/kan/kan-music/'],
  '100FM': ['https://www.100fm.co.il/'],
  '103FM': ['https://103fm.maariv.co.il/'],
  '102FM': ['https://www.102fm.co.il/'],
  'eco99': ['https://eco99fm.maariv.co.il/'],
  'רדיו דרום': ['https://www.radiodarom.co.il/'],
};
const LINK_RE = {
  'גלגלצ': /glz\.co\.il\/(%D7%92%D7%9C%D7%92%D7%9C%D7%A6|גלגלצ)\/(%D7%AA%D7%9B%D7%A0%D7%99%D7%95%D7%AA|תכניות)\/[^/?#]+\/?$/,
  'גלי צה"ל': /glz\.co\.il\/(%D7%92%D7%9C%D7%A6|גלצ)\/(%D7%AA%D7%9B%D7%A0%D7%99%D7%95%D7%AA|תכניות)\/[^/?#]+\/?$/,
  'כאן': /kan\.org\.il\/content\/kan\/[a-z0-9-]+\/p-\d+\/?$/,
  '100FM': /100fm\.co\.il\/program\/[^/?#]+\/?$/,
  '103FM': /103fm\.maariv\.co\.il\/(program|programs)\/[^?#]+$/,
  '102FM': /102fm\.co\.il\/(program|podcast|shows?)\/[^?#]+$/,
  'eco99': /eco99fm\.maariv\.co\.il\/(sets|playlist|music_channel|onair)\/[^?#]+$/,
  'רדיו דרום': /radiodarom\.co\.il\/(program|Program|programs)\/[^?#]+$/,
};
const PER_SITE = 10;

app.whenReady().then(async () => {
  // 1) the live site, saved for editing
  const site = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    preload: path.join(process.cwd(), 'electron/preload.js') } });
  await site.loadURL('https://shay-radio-il.netlify.app/');
  const html = await (await fetch('https://shay-radio-il.netlify.app/', { cache: 'no-store' })).text();
  require('fs').writeFileSync(path.join(process.cwd(), 'site/radio-israel.live.html'), html);
  console.log('live site saved:', html.length, 'bytes');

  const scrape = (u) => site.webContents.executeJavaScript('window.electronAPI.scrapePageAudio(' + JSON.stringify(u) + ')').catch((e) => 'ERR ' + e.message);

  // 2) collect program links from each station's pages
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  w.webContents.setAudioMuted(true);
  for (const [station, pages] of Object.entries(INDEXES)) {
    const links = new Map();
    for (const p of pages) {
      try {
        await w.loadURL(p);
        await new Promise((r) => setTimeout(r, 3500));
        const found = await w.webContents.executeJavaScript(`[...document.querySelectorAll('a[href]')].map(a => [a.href.split('#')[0], (a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60)])`);
        for (const [href, text] of found) if (LINK_RE[station].test(href) && !links.has(href)) links.set(href, text);
      } catch (e) { console.log(station, 'index error', p, e.message); }
    }
    console.log(`\n##### ${station}: ${links.size} program links`);
    let n = 0;
    for (const [href, text] of links) {
      if (n++ >= PER_SITE) break;
      // page title + newest date on the page (to judge if the program is active)
      let meta = {};
      try {
        await w.loadURL(href);
        await new Promise((r) => setTimeout(r, 2500));
        meta = await w.webContents.executeJavaScript(`(() => {
          const t = (document.querySelector('h1')||{}).textContent || document.title || '';
          const dates = (document.body.innerText.match(/\\b(\\d{1,2})[./](\\d{1,2})[./](20)?(2[4-6])\\b/g) || []).slice(0, 5);
          const desc = (document.querySelector('meta[name=description]')||{}).content || '';
          return { title: t.replace(/\\s+/g,' ').trim().slice(0,70), dates, desc: desc.slice(0,110) };
        })()`);
      } catch (e) { meta = { err: e.message }; }
      const audio = await scrape(href);
      console.log(`- ${text} | ${href}\n    title=${meta.title} | dates=${JSON.stringify(meta.dates)} | desc=${meta.desc}\n    audio=${JSON.stringify(audio)}`);
    }
  }
  app.exit(0);
});
