import { createRequire } from 'module'; const require = createRequire(import.meta.url); const { chromium } = require('playwright');
import fs from 'fs';
const W = new URL('./work', import.meta.url).pathname;
const url = 'http://localhost:8765/';
const browser = await chromium.launch();
const results = {};

async function page(stub) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 1400 } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  if (stub === 'nofs') await p.addInitScript(() => { delete window.showDirectoryPicker; delete window.showSaveFilePicker; });
  if (stub === 'opfs') await p.addInitScript(() => {
    window.showDirectoryPicker = async () => { const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle('SD', { create: true }); };
  });
  await p.goto(url);
  await p.waitForFunction(() => document.getElementById('version').textContent.includes('c298'));
  return { ctx, p };
}

// 1. wrong disc / other xex
{
  const { ctx, p } = await page();
  await p.setInputFiles('#iso', `${W}/wrong.iso`);
  await p.waitForSelector('#disc-status.bad');
  results.wrong = await p.textContent('#disc-status');
  await p.setInputFiles('#iso', `${W}/other.iso`);
  await p.waitForFunction(() => document.getElementById('disc-status').textContent.includes('different'));
  results.other = await p.textContent('#disc-status');
  await p.screenshot({ path: `${W}/shot-bad.png`, fullPage: true });
  await ctx.close();
}

// 2. ZIP through the service-worker download
{
  const { ctx, p } = await page('nofs');
  await p.setInputFiles('#iso', `${W}/test-xgd2.iso`);
  await p.waitForSelector('#disc-status.ok');
  await p.screenshot({ path: `${W}/shot-ready.png`, fullPage: true });
  const dl = p.waitForEvent('download');
  await p.click('#to-zip');
  const d = await dl;
  await d.saveAs(`${W}/out.zip`);
  await p.waitForSelector('#step-play.active', { timeout: 60000 });
  results.zipStatus = await p.textContent('#copy-status');
  await p.screenshot({ path: `${W}/shot-zip-done.png`, fullPage: true });
  await ctx.close();
}

// 3. folder (OPFS standing in for the SD card), then again (resume), then update only
{
  const { ctx, p } = await page('opfs');
  await p.setInputFiles('#iso', `${W}/test.iso`);
  await p.waitForSelector('#disc-status.ok');
  await p.click('#to-folder');
  await p.waitForSelector('#step-play.active', { timeout: 60000 });
  results.folderStatus = await p.textContent('#copy-status');
  const dump = await p.evaluate(async () => {
    const out = {};
    async function walk(d, path) {
      for await (const [name, h] of d.entries()) {
        if (h.kind === 'directory') await walk(h, path + name + '/');
        else { const f = await h.getFile(); const b = new Uint8Array(await f.arrayBuffer());
               const dig = await crypto.subtle.digest('SHA-256', b);
               out[path + name] = [...new Uint8Array(dig)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
      }
    }
    await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('SD'), '');
    return out;
  });
  results.folder = dump;
  await p.screenshot({ path: `${W}/shot-folder-done.png`, fullPage: true });
  await ctx.close();
}
fs.writeFileSync(`${W}/results.json`, JSON.stringify(results, null, 1));
await browser.close();
console.log('done');
