// Visual regression rig for the mascot. Run with the Electron binary while `npm run preview:ui` is serving:
//   npx electron scripts/visual-shots.cjs capture tests/visual-baseline
//   npx electron scripts/visual-shots.cjs capture tests/visual-after
//   npx electron scripts/visual-shots.cjs compare tests/visual-baseline tests/visual-after
const { app, BrowserWindow, nativeImage, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('force-device-scale-factor', '2'); // Retina-like

const ACTIONS = ['smile', 'hop', 'look', 'wave', 'spin', 'wiggle', 'stretch', 'twinkle', 'hum', 'peek', 'cheer', 'wake'];
const scenarios = [];
const app_ = (name, query, o = {}) => scenarios.push({ name, query, w: 420, h: 330, settle: 3000, ...o });
app_('idle', '');
app_('idle-later', '', { settle: 3000 + 1300 });
app_('hover', '', { hover: true });
app_('sleeping', '?sleep=1', { settle: 4000 });
app_('alert-reminder', '?reminder=1', { wait: 2600 });
app_('cursor-near', '?mouse=60,150');
app_('cursor-far', '?mouse=400,20');
for (const a of ACTIONS) app_(`action-${a}`, `?action=${a}`, { snaps: [300, 900] });
for (const r of ['giggle', 'shy', 'purr', 'bite']) app_(`reaction-${r}`, `?reaction=${r}&mouse=380,40`, { snaps: [200, 450] });
// dancing: three poses through one beat of a 120 BPM track (beatClock origin is the fake time at simulate)
app_('dance', '?music=1', { snaps: [0, 130, 260, 390, 520] });
for (const v of ['month', 'day']) app_(`view-${v}`, `?view=${v}`, { w: 360, h: 470 });
for (const m of ['idle', 'happy', 'alert', 'thinking', 'sleepy']) app_(`gallery-${m}`, `?gallery=1&mood=${m}`, { w: 760, h: 640, settle: 2000 });
app_('gallery-sunset', '?gallery=1&skin=sunset', { w: 760, h: 640, settle: 2000 });
app_('expanded', '?signedIn=0', { w: 400, h: 640 });

async function capture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  session.defaultSession.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'visual-clock.cjs') });
  for (const sc of scenarios) {
    const win = new BrowserWindow({ width: sc.w, height: sc.h, show: true, frame: false, transparent: false, backgroundColor: '#000000', webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.on('did-fail-load', (e, c, d, u, main) => console.log('fail', c, d, u, main));
    win.webContents.on('console-message', (e, ...a) => { const m = JSON.stringify(a); if (/rror/.test(m)) console.log('console', m.slice(0, 300)); });
    for (let attempt = 0; ; attempt++) { try { await win.loadURL(BASE + sc.query); break; } catch (e) { if (attempt >= 3) throw e; await sleep(800); } }
    await sleep(sc.wait ?? 1400);
    const run = (js) => win.webContents.executeJavaScript(js);
    if (sc.hover) { win.webContents.sendInputEvent({ type: 'mouseMove', x: 210, y: 150 }); await sleep(100); }
    await run(`window.__advance(${sc.settle})`);
    await sleep(900); // real time, for CSS transitions
    const snaps = sc.snaps ?? [0];
    let at = 0;
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i] > at) { await run(`window.__advance(${snaps[i] - at})`); at = snaps[i]; await sleep(120); }
      await run('window.__freezeCss(1000)');
      await sleep(80);
      let img;
      for (let attempt = 0; ; attempt++) {
        try { img = await withTimeout(win.webContents.capturePage(), 5000); break; } catch (e) { if (attempt >= 3) throw e; console.log('retry capture', sc.name, i); win.webContents.invalidate(); await sleep(300); }
      }
      fs.writeFileSync(path.join(dir, `${sc.name}${snaps.length > 1 ? `-${i}` : ''}.png`), img.toPNG());
    }
    win.destroy();
    await sleep(500);
  }
}

function compare(a, b) {
  let bad = 0;
  for (const f of fs.readdirSync(a).filter((x) => x.endsWith('.png')).sort()) {
    const pb = path.join(b, f);
    if (!fs.existsSync(pb)) { console.log(`MISSING  ${f}`); bad++; continue; }
    const ia = nativeImage.createFromPath(path.join(a, f)), ib = nativeImage.createFromPath(pb);
    const sa = ia.getSize(), sb = ib.getSize();
    if (sa.width !== sb.width || sa.height !== sb.height) { console.log(`SIZE     ${f}`); bad++; continue; }
    const A = ia.toBitmap(), B = ib.toBitmap();
    let diff = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < A.length; i += 4) {
      const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
      if (d > 2) {
        diff++; if (d > max) max = d;
        const p = i / 4, x = p % sa.width, y = Math.floor(p / sa.width);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const pct = ((100 * diff) / (A.length / 4)).toFixed(3);
    console.log(`${diff ? 'DIFF    ' : 'same    '} ${f}  pixels>2: ${diff} (${pct}%)  max channel delta: ${max}${diff ? `  box: (${x0},${y0})-(${x1},${y1})` : ''}`);
    if (diff) bad++;
  }
  console.log(bad ? `\n${bad} image(s) differ` : '\nall images match');
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === 'capture') await capture(path.resolve(a));
  else if (mode === 'compare') compare(path.resolve(a), path.resolve(b));
  else console.log('usage: capture <dir> | compare <dirA> <dirB>');
  app.quit();
});
