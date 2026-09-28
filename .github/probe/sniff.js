// Temporary: visit each station's website and log API responses that look like "now playing" data.
const { chromium } = require('playwright');
const SITES = {
  'eco99-live': ['https://eco99fm.maariv.co.il/live-radio'],
  '103fm-live': ['https://103fm.maariv.co.il/live'],
  '100fm':      ['https://www.100fm.co.il/'],
  'darom':      ['https://www.radiodarom.co.il/'],
  'haifa':      ['https://1075.fm/'],
  'tzafon':     ['https://www.1045.co.il/', 'https://www.radio1045.co.il/'],
  'levhamedina':['https://www.91fm.co.il/'],
  'jerusalem':  ['https://www.101fm.co.il/'],
  'hatahana':   ['https://www.hatahana.co.il/live/'],
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
  // Kan: find the channelId of every station
  for (let id = 1; id <= 40; id++) {
    try {
      const r = await fetch('https://www.kan.org.il/api/arc-cloud/get-live-track-data?channelId=' + id, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const t = await r.text();
      console.log('kan channel', id, r.status, t.slice(0, 260).replace(/\s+/g, ' '));
    } catch (e) { console.log('kan channel', id, 'ERR', e.message); }
  }
  // Kan page: map of channel ids to station names
  try {
    const html = await (await fetch('https://www.kan.org.il/radio/', { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const ids = html.match(/.{0,200}data-channel-id=["']?\d+.{0,200}/g) || [];
    ids.slice(0, 40).forEach((m) => console.log('kan html:', m.replace(/\s+/g, ' ')));
  } catch (e) { console.log('kan html ERR', e.message); }
  // 91fm player script: how it gets the track name
  try {
    const js = await (await fetch('https://www.91fm.co.il/wp-content/themes/91fm/js/beetle-radio.js?ver=4')).text();
    (js.match(/.{0,200}(https?:\/\/|ajax|getJSON|\.get\(|fetch\(|trackname|\.json|\.xml|stats|currentsong|7\.html).{0,200}/gi) || []).slice(0, 25).forEach((m) => console.log('91fm js:', m.replace(/\s+/g, ' ')));
  } catch (e) { console.log('91fm js ERR', e.message); }
  await browser.close();
})();
