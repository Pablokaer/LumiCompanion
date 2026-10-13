// Measures the CPU use of the mascot widget in real time (no fake clock), the way LUMI_PERF=1 reports it.
// Needs `npm run preview:ui` serving on :5173. Run with the Electron binary:
//   npx electron scripts/perf-measure.cjs                 (all cases, prints a table)
//   npx electron scripts/perf-measure.cjs idle dance      (only these cases)
// Env: SAMPLES (default 6) x EVERY_MS (default 2500) after WARMUP_MS (default 6000).
// MAC_LIKE=1 turns on Chromium's occlusion tracking and background throttling for the widget, which is how it
// behaves on macOS after Phase 3 (on Windows the app turns both off so the dance keeps running behind windows).
const { app, BrowserWindow } = require('electron');

const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:5173/';
const SAMPLES = Number(process.env.SAMPLES || 6);
const EVERY_MS = Number(process.env.EVERY_MS || 2500);
const WARMUP_MS = Number(process.env.WARMUP_MS || 6000);
const MAC_LIKE = !!process.env.MAC_LIKE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!MAC_LIKE) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const cases = {
  idle: { label: '(a) idle, visible', query: '' },
  covered: { label: '(b) covered by another window', query: '', cover: true },
  asleep: { label: '(c) asleep', query: '?sleep=1' },
  dance: { label: '(d) dancing', query: '?music=1' },
  panel: { label: '(e) expanded panel open', query: '?signedIn=0', w: 400, h: 640 },
};

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sum = (ms, types) => ms.filter((m) => types.includes(m.type)).reduce((n, m) => n + m.cpu.percentCPUUsage, 0);

async function measure(name, c) {
  const win = new BrowserWindow({
    width: c.w || 240, height: c.h || 300, x: 60, y: 60, show: true, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    webPreferences: { backgroundThrottling: MAC_LIKE ? true : false },
  });
  await win.loadURL(BASE + c.query);
  let cover;
  if (c.cover) {
    cover = new BrowserWindow({ width: 600, height: 600, x: 20, y: 20, show: true, frame: false, backgroundColor: '#202020', focusable: true });
    await cover.loadURL('data:text/html,<body style="background:%23202020"></body>');
    cover.focus();
  }
  await sleep(WARMUP_MS);
  app.getAppMetrics(); // the first reading only starts the clock
  const r = [], g = [], m = [];
  for (let i = 0; i < SAMPLES; i++) {
    await sleep(EVERY_MS);
    const ms = app.getAppMetrics();
    r.push(sum(ms, ['Tab'])); g.push(sum(ms, ['GPU'])); m.push(sum(ms, ['Browser']));
  }
  cover?.destroy();
  win.destroy();
  await sleep(500);
  return { name, label: c.label, renderer: median(r), gpu: median(g), main: median(m) };
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const wanted = process.argv.slice(2).filter((a) => cases[a]);
  const names = wanted.length ? wanted : Object.keys(cases);
  console.log(`${MAC_LIKE ? 'mac-like policy' : 'windows policy'}; median of ${SAMPLES} samples`);
  console.log('| case | renderer % | GPU % | main % |\n|---|---|---|---|');
  for (const n of names) {
    const x = await measure(n, cases[n]);
    console.log(`| ${x.label} | ${x.renderer.toFixed(1)} | ${x.gpu.toFixed(1)} | ${x.main.toFixed(1)} |`);
  }
  app.quit();
});
