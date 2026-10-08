#!/usr/bin/env node
// Drives the repro and distinguishes a hot reload from a full page refresh.
//
// Signals:
//   label      the value exported by the library
//   clicks     held in a defonce atom, survives hot reload, resets on refresh
//   loaded-at  set once per page load, unchanged by hot reload
//   sentinel   set on window by this script, destroyed by any navigation
//
// usage: NODE_PATH=<dir with playwright> node probe.js <new-label>
//   PROBE_HEADED=1   open a real window with pauses, and demo a refresh after

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NEW = process.argv[2] || 'v2';
const URL = process.env.PROBE_URL || 'http://localhost:9411/';
const LIB = path.resolve(__dirname, '..', 'min-component-library');
const HEADED = !!process.env.PROBE_HEADED;
const dwell = (page, ms) => (HEADED ? page.waitForTimeout(ms) : Promise.resolve());

const snapshot = (page) =>
  page.evaluate(() => ({
    label: document.querySelector('#label')?.textContent,
    clicks: document.querySelector('#clicks')?.textContent,
    loadedAt: document.querySelector('#loaded')?.textContent,
    sentinel: window.__probeSentinel || 'gone',
  }));

const show = (tag, s) =>
  console.log(`  ${tag.padEnd(8)} label=${s.label} clicks=${s.clicks} loaded-at=${s.loadedAt} sentinel=${s.sentinel}`);

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message)));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#label');

  for (let i = 0; i < 3; i++) await page.click('#bump');
  await page.evaluate(() => { window.__probeSentinel = 'alive'; });

  const before = await snapshot(page);
  show('before', before);
  await dwell(page, 3000);

  const src = path.join(LIB, 'src', 'index.ts');
  fs.writeFileSync(src, fs.readFileSync(src, 'utf8').replace(/label = "[^"]*"/, `label = "${NEW}"`));
  execSync('npx tsc', { cwd: LIB, stdio: 'pipe' });
  const now = new Date();
  fs.utimesSync(path.join(LIB, 'package.json'), now, now);
  console.log(`  edited library -> "${NEW}", rebuilt, bumped package.json mtime`);

  let applied = true;
  try {
    await page.waitForFunction(
      (v) => document.querySelector('#label')?.textContent === v, NEW,
      { timeout: HEADED ? 12000 : 30000 });
  } catch { applied = false; }

  const after = await snapshot(page);
  show('after', after);
  if (errors.length) {
    console.log('  errors :');
    for (const e of errors.slice(0, 3)) console.log('    ' + e.split('\n')[0]);
  } else {
    console.log('  errors : none');
  }

  let verdict;
  if (!applied) verdict = 'NO UPDATE (label unchanged)';
  else if (after.sentinel === 'alive' && after.clicks === before.clicks && after.loadedAt === before.loadedAt)
    verdict = 'HOT RELOAD (clicks and load time preserved)';
  else verdict = 'FULL REFRESH (state lost)';

  console.log('');
  console.log('VERDICT:', verdict);

  if (HEADED) {
    await dwell(page, 4000);
    console.log('');
    console.log('  --- now forcing a real page refresh, for contrast ---');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#label');
    const refreshed = await snapshot(page);
    show('refresh', refreshed);
    console.log(`  clicks ${before.clicks} -> ${refreshed.clicks}, sentinel ${refreshed.sentinel}, load time changed: ${refreshed.loadedAt !== before.loadedAt}`);
    await dwell(page, 5000);
  }

  await browser.close();
})().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
