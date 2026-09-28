// Temporary end-to-end check: real Electron + our preload + our handlers, on the live site.
const { app, BrowserWindow } = require('electron');
const path = require('path');
require(path.join(process.cwd(), 'electron/electron-nowplaying-main.js'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    preload: path.join(process.cwd(), 'electron/preload.js') } });
  await win.loadURL('https://shay-radio-il.netlify.app/');
  const run = (js) => win.webContents.executeJavaScript(js).catch((e) => 'ERR ' + e.message);
  console.log('electronAPI present:', await run('typeof window.electronAPI + " " + Object.keys(window.electronAPI||{}).join(",")'));
  console.log('icy 103FM:', JSON.stringify(await run('window.electronAPI.icyTitle("https://cdn.cybercdn.live/103FM/Live/icecast.audio")')));
  console.log('fetchRaw triton:', JSON.stringify(await run('window.electronAPI.fetchRaw("https://np.tritondigital.com/public/nowplaying?mountName=KAN_88&numberToFetch=1&eventType=track")')).slice(0, 300));
  console.log('scrapeGlz:', JSON.stringify(await run('window.electronAPI.scrapeGlz("https://glz.co.il/גלגלצ/")')));
  // Rendered glz DOM: every data-live-fallback with its surroundings
  const g = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  g.webContents.setAudioMuted(true);
  await g.loadURL('https://glz.co.il/גלגלצ/');
  await new Promise((r) => setTimeout(r, 4000));
  console.log('glz candidates:', JSON.stringify(await g.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('[data-live-fallback]')).map(el => ({
      value: el.getAttribute('data-live-fallback'), tag: el.tagName, cls: el.className,
      attrs: Array.from(el.attributes).map(a => a.name + '=' + a.value.slice(0, 80)).join(' | '),
      parent: el.parentElement && (el.parentElement.tagName + '.' + el.parentElement.className),
      text: (el.textContent || '').trim().slice(0, 80),
      label: (el.closest('[class]') && el.closest('section,div,li') ? (el.closest('section,div,li').textContent||'').replace(/\\s+/g,' ').trim().slice(0, 160) : '')
    }))`), null, 1));
  app.exit(0);
});
