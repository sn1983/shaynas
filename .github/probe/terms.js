// Temporary: read each station's terms-of-use page and print the clauses about using its content/broadcasts.
const { app, BrowserWindow } = require('electron');
const SITES = [
  ['כאן', 'https://www.kan.org.il/content-pages/terms/'],
  ['גלי צה"ל / גלגלצ', 'https://glz.co.il/גלצ/'],
  ['103FM', 'https://103fm.maariv.co.il/'],
  ['רדיוס 100FM', 'https://www.100fm.co.il/תנאי-שימוש/'],
  ['102FM', 'https://www.102fm.co.il/'],
  ['eco99', 'https://eco99fm.maariv.co.il/'],
  ['רדיו דרום', 'https://www.radiodarom.co.il/'],
  ['רדיו ירושלים 101', 'https://www.101fm.co.il/'],
  ['גלי ישראל', 'https://www.galeyisrael.net/'],
  ['קול רגע', 'https://www.kolrega.co.il/'],
  ['קול חי', 'https://www.93fm.co.il/'],
  ['קול ברמה', 'https://www.kolbarama.co.il/'],
  ['רדיו חיפה', 'https://www.1075.fm/'],
  ['לב המדינה', 'https://www.91fm.co.il/'],
  ['רדיו צפון 104.5', 'https://www.1045fm.co.il/'],
  ['רדיו 89.1', 'https://www.891fm.co.il/'],
  ['א-שמס', 'https://www.ashams.com/'],
  ['נושמים מזרחית', 'https://www.mizrahit.fm/'],
  ['רדיו סהר', 'https://www.radiosahar.co.il/'],
  ['Jewish Music Stream', 'https://www.jewishmusicstream.com/'],
  ['רדיו נהריה', 'https://www.radionahariya.com/'],
];
const KEY = /שידור|העתק|הפצ|קישור|קישורים|מסגור|מסחרי|אישי|זכויות יוצרים|קניין רוחני|אפליקצי|תוכנ|רובוט|אוטומט|סריקה|framing|embed|stream|link|copy|reproduc|redistribut|commercial|personal|scrap|robot|automat/i;
const TERMS_LINK = /תנאי\s*(ה)?שימוש|תקנון|terms|legal|disclaimer/i;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, wait(ms).then(() => null)]);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const load = async (u) => { await withTimeout(w.loadURL(u).catch(() => {}), 25000); await wait(3000); };
  const js = (code) => withTimeout(w.webContents.executeJavaScript(code).catch(() => null), 10000);
  for (const [name, home] of SITES) {
    console.log(`RES ===== ${name} (${home})`);
    await load(home);
    let termsUrl = null;
    if (!/terms|תנאי/.test(decodeURI(home))) {
      const links = await js(`[...document.querySelectorAll('a[href]')].map(a => [a.href, (a.textContent || '').trim().slice(0, 40)])`) || [];
      const hit = links.find(([h, t]) => TERMS_LINK.test(t)) || links.find(([h]) => TERMS_LINK.test(decodeURI(h)));
      if (!hit) { console.log('RES   no terms-of-use link found on the home page (' + links.length + ' links)'); continue; }
      termsUrl = hit[0];
      console.log('RES   terms page: ' + decodeURI(termsUrl) + ' ("' + hit[1] + '")');
      await load(termsUrl);
    }
    const text = await js(`document.body ? document.body.innerText : ''`) || '';
    const paras = text.split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 40 && KEY.test(s));
    console.log('RES   page text ' + text.length + ' chars, ' + paras.length + ' relevant paragraphs');
    for (const p of paras.slice(0, 14)) console.log('RES   > ' + p.replace(/\s+/g, ' ').slice(0, 480));
  }
  app.exit(0);
});
