// Temporary: visit each station's website and log API responses that look like "now playing" data.
const { chromium } = require('playwright');
const SITES = {
  'kan':        ['https://www.kan.org.il/radio/', 'https://www.kan.org.il/content/kan/kan-88/'],
  '103fm':      ['https://103fm.maariv.co.il/'],
  '100fm':      ['https://100fm.co.il/'],
  '102fm':      ['https://102fm.co.il/'],
  'eco99':      ['https://eco99fm.maariv.co.il/'],
  '101fm':      ['https://101fm.co.il/'],
  'darom97':    ['https://www.darom97.co.il/', 'https://97fm.co.il/'],
  'darom1015':  ['https://1015.co.il/'],
  'galeyisrael':['https://www.gly.co.il/'],
  'kolrega':    ['https://www.kolrega.co.il/'],
  'kolchai':    ['https://93fm.co.il/'],
  'kolbarama':  ['https://www.kol-barama.co.il/'],
  'haifa':      ['https://www.radiohaifa.co.il/'],
  'levhamedina':['https://91fm.co.il/'],
  'tzafon':     ['https://1045fm.co.il/'],
  '891':        ['https://891fm.co.il/'],
  'hatahana':   ['https://www.hatahana.co.il/'],
  'ashams':     ['https://www.ashams.com/'],
  'nahariya':   ['https://radionahariya.com/'],
};
const INTERESTING = /(artist|song|track|title|now.?playing|current|onair|playlist|singer|performer)/i;
(async () => {
  const browser = await chromium.launch();
  for (const [name, urls] of Object.entries(SITES)) {
    for (const url of urls) {
      const ctx = await browser.newContext({ locale: 'he-IL', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36' });
      const page = await ctx.newPage();
      const hits = [];
      page.on('response', async (res) => {
        try {
          const req = res.request();
          const type = req.resourceType();
          if (!['xhr', 'fetch', 'script', 'document', 'other'].includes(type)) return;
          const ct = res.headers()['content-type'] || '';
          if (!/json|xml|text\/plain|javascript/i.test(ct) && type !== 'xhr' && type !== 'fetch') return;
          if (/google|facebook|doubleclick|analytics|gtag|hotjar|clarity|cdnjs|jquery|recaptcha|fonts|taboola|outbrain|onesignal/i.test(res.url())) return;
          const body = await res.text();
          if (body.length > 400000) return;
          if (type === 'script' && !/nowplaying|now_playing|current(song|track)|onair|songtitle|streamtitle/i.test(body)) return;
          const m = body.match(INTERESTING);
          if (!m) return;
          const i = Math.max(0, m.index - 150);
          hits.push(`${type} ${res.status()} ${res.url().slice(0, 200)}\n      ${body.slice(i, i + 400).replace(/\s+/g, ' ')}`);
        } catch {}
      });
      let status = '';
      try {
        const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        status = r ? r.status() : '?';
        await page.waitForTimeout(6000);
        // try pressing a play button to trigger now-playing requests
        const btn = await page.$('[class*="play" i]:not([class*="playlist" i]), button[aria-label*="play" i], button[title*="נגן"], [class*="live" i] button');
        if (btn) { await btn.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(8000); }
        // visible text near "עכשיו" / "משודר" / "now playing"
        const txt = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('*').forEach((el) => {
            if (el.children.length) return;
            const t = (el.textContent || '').trim();
            if (t && t.length < 120 && /(עכשיו|מתנגן|משודר|now playing|on air|השיר)/i.test(t)) out.push(t + ' || ' + ((el.parentElement && el.parentElement.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 160));
          });
          return out.slice(0, 6);
        });
        if (txt.length) hits.push('TEXT: ' + txt.join('\n      TEXT: '));
      } catch (e) { status = 'ERR ' + e.message.split('\n')[0]; }
      console.log(`\n##### ${name} ${url} -> ${status}  (${hits.length} hits)`);
      hits.slice(0, 12).forEach((h) => console.log('  - ' + h));
      await ctx.close();
    }
  }
  // Triton: try other mount names / no event filter for Kan
  for (const mount of ['KAN_88', 'KAN_88AAC', 'KAN_GIMMEL', 'KAN_GIMMELAAC', 'KAN_BET', 'KAN_TARBUT']) {
    for (const q of ['&numberToFetch=3', '&numberToFetch=3&eventType=track']) {
      const u = `https://np.tritondigital.com/public/nowplaying?mountName=${mount}${q}`;
      const t = await (await fetch(u)).text().catch(() => 'ERR');
      console.log('triton', mount, q, t.slice(0, 250).replace(/\s+/g, ' '));
    }
  }
  await browser.close();
})();
