#!/usr/bin/env node
// Drives the repro: loads the page, edits the library source, rebuilds it with
// tsc, bumps the package.json mtime so shadow-cljs's reload-npm poller notices,
// then reports whether the hot reload applied or threw.
//
// usage: NODE_PATH=<dir with playwright> node probe.js <new-label>

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NEW = process.argv[2] || 'v2';
const URL = process.env.PROBE_URL || 'http://localhost:9411/';
const LIB = path.resolve(__dirname, '..', 'min-component-library');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message)));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app');
  console.log('  before :', JSON.stringify(await page.textContent('#app')));

  const src = path.join(LIB, 'src', 'index.ts');
  fs.writeFileSync(src, fs.readFileSync(src, 'utf8').replace(/label = "[^"]*"/, `label = "${NEW}"`));
  execSync('npx tsc', { cwd: LIB, stdio: 'pipe' });
  const now = new Date();
  fs.utimesSync(path.join(LIB, 'package.json'), now, now);
  console.log(`  edited library -> "${NEW}", rebuilt, bumped package.json mtime`);

  let applied = true;
  try {
    await page.waitForFunction(
      (v) => document.querySelector('#app')?.textContent === v, NEW, { timeout: 30000 });
  } catch { applied = false; }

  console.log('  after  :', JSON.stringify(await page.textContent('#app')));
  if (errors.length) {
    console.log('  errors :');
    for (const e of errors.slice(0, 3)) console.log('    ' + e.split('\n')[0]);
  } else {
    console.log('  errors : none');
  }
  console.log('');
  console.log('RESULT:', applied ? 'HOT RELOAD OK' : 'HOT RELOAD FAILED');
  await browser.close();
})().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
