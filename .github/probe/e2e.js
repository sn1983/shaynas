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
  for (const u of ['https://cdn.cybercdn.live/Radios_100FM/Audio/icecast.audio', 'https://live.ecast.co.il/stream/sahar/stream', 'https://stream.jewishmusicstream.com:8000/'])
    console.log('icy', u, JSON.stringify(await run('window.electronAPI.icyTitle(' + JSON.stringify(u) + ')')));
  console.log('scrapeGlz galatz:', JSON.stringify(await run('window.electronAPI.scrapeGlz("https://glz.co.il/גלצ/")')));
  app.exit(0);
});
