import { listFiles, readFile, xexTitleId, chunks } from './xdvdfs.js?v=5';
import { ZipWriter } from './zip64.js?v=5';

const $ = (id) => document.getElementById(id);
const GB = (n) => (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + ' GB';
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const state = {
  payload: null,     // payload.json: the program files that come with the page
  iso: null,         // the chosen disc image (a File)
  gameFiles: [],     // its files: { path, offset, size }
  updateOnly: false, // program files only, for an earlier install
  cancelled: false,
};

function setStatus(id, kind, html) {
  const el = $(id);
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.innerHTML = html;
}

function stepState(id, s) {
  const el = $(id);
  el.classList.remove('active', 'done', 'locked');
  el.classList.add(s);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function loadPayload() {
  try {
    const r = await fetch('payload.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`payload.json: HTTP ${r.status}`);
    state.payload = await r.json();
  } catch (e) {
    setStatus('disc-status', 'bad', 'The program files for this page are missing, so nothing can be made yet. ' +
      'If you run this site, publish a release (see the README).');
    $('iso').disabled = true;
    $('update-only').disabled = true;
    return;
  }
  const p = state.payload;
  $('version').textContent = `MCLA-NX ${p.version}`;
  $('nro-name').textContent = p.nro;
  $('toml-path').textContent = `${p.sd_folder}/mcla.toml`;
}

// ---- step 1: the disc image ----------------------------------------------------------------------------------------
$('iso').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file || !state.payload) return;
  state.updateOnly = false;
  state.iso = null;
  stepState('step-target', 'locked');
  enableTargets(false);
  setStatus('disc-status', '', `Reading ${escapeHtml(file.name)} …`);
  try {
    const files = await listFiles(file);
    if (!files) {
      setStatus('disc-status', 'bad', 'This file is not an Xbox 360 disc image (no XDVDFS volume was found). ' +
        'Choose the <code>.iso</code> of the game disc.');
      return;
    }
    const xex = files.find((f) => f.path.toLowerCase() === '/default.xex');
    if (!xex) {
      setStatus('disc-status', 'bad', 'This disc image has no <code>default.xex</code>: it is not a game disc.');
      return;
    }
    const xexBytes = await readFile(file, xex);
    const title = xexTitleId(xexBytes);
    const sha = hex(await crypto.subtle.digest('SHA-256', xexBytes));
    const total = files.reduce((n, f) => n + f.size, 0);
    const want = state.payload.xex;
    const titleHex = title == null ? 'unknown' : title.toString(16).toUpperCase().padStart(8, '0');
    const facts = `<dl class="facts"><dt>Title ID</dt><dd>${titleHex}</dd><dt>Files</dt><dd>${files.length}, ${GB(total)}</dd>` +
      `<dt>default.xex</dt><dd>${sha.slice(0, 16)}…</dd></dl>`;
    if (titleHex !== want.title_id) {
      setStatus('disc-status', 'bad', `This is not Midnight Club: Los Angeles Complete Edition (USA/Europe), title ID ` +
        `${want.title_id}. MCLA-NX only runs that disc.${facts}`);
      return;
    }
    if (sha !== want.sha256) {
      setStatus('disc-status', 'bad', `This disc has the right title but a different <code>default.xex</code> than ` +
        `MCLA-NX was built from, so the program would not match it. It needs the USA/Europe Complete Edition disc.${facts}`);
      return;
    }
    state.iso = file;
    state.gameFiles = files;
    setStatus('disc-status', 'ok', `Midnight Club: Los Angeles Complete Edition, the disc MCLA-NX was built from.${facts}`);
    stepState('step-disc', 'done');
    openTargets();
  } catch (e) {
    setStatus('disc-status', 'bad', `The disc image could not be read: ${escapeHtml(e.message)}`);
  }
});

$('update-only').addEventListener('click', () => {
  if (!state.payload) return;
  state.updateOnly = true;
  state.iso = null;
  state.gameFiles = [];
  setStatus('disc-status', 'ok', `Only the program files of ${escapeHtml(state.payload.version)} will be written ` +
    `(the program and its shaders). Your game files, saves and <code>mcla.toml</code> stay as they are.`);
  stepState('step-disc', 'done');
  openTargets();
});

// ---- step 2: where the files go ------------------------------------------------------------------------------------
const canPickFolder = 'showDirectoryPicker' in window;
const canSaveFile = 'showSaveFilePicker' in window;

function enableTargets(on) {
  $('to-folder').disabled = !on || !canPickFolder;
  $('to-zip').disabled = !on;
}

function openTargets() {
  stepState('step-target', 'active');
  enableTargets(true);
  if (!canPickFolder) {
    $('to-folder').classList.add('hidden');
    $('to-zip').classList.remove('quiet');
    $('target-hint').textContent = 'This browser cannot write to the SD card directly: the files are saved as one ZIP ' +
      'to unpack at the root of the SD card.';
  }
  const size = plannedBytes();
  setStatus('target-status', '', `${GB(size)} to write. Make sure the SD card (or the place you save the ZIP) has room.`);
  $('step-target').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function plannedBytes() {
  const game = state.updateOnly ? 0 : state.gameFiles.reduce((n, f) => n + f.size, 0);
  return game + programFiles().reduce((n, f) => n + f.size, 0);
}

function programFiles() {
  return state.payload.files.filter((f) => !(state.updateOnly && f.keep_existing));
}

// Every file to write: { path (under the SD folder), size, source: () => async iterable, keepExisting, sha256 }
function plan() {
  const p = state.payload;
  const out = [];
  for (const f of programFiles()) {
    out.push({ path: f.path, size: f.size, keepExisting: !!f.keep_existing, kind: 'program',
               source: () => fetchChunks(f) });
  }
  if (!state.updateOnly) {
    for (const g of state.gameFiles) {
      out.push({ path: `${p.game_folder}${g.path}`, size: g.size, kind: 'game', resumable: true,
                 source: () => chunks(state.iso, g.offset, g.size) });
    }
  }
  return out;
}

async function* fetchChunks(f) {
  const r = await fetch(`payload/${f.path.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${f.path}: HTTP ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length !== f.size || hex(await crypto.subtle.digest('SHA-256', bytes)) !== f.sha256)
    throw new Error(`${f.path} did not arrive whole. Reload the page and try again.`);
  for (let i = 0; i < bytes.length; i += 8 << 20) yield bytes.subarray(i, Math.min(bytes.length, i + (8 << 20)));
}

// ---- step 3: copying -----------------------------------------------------------------------------------------------
let wakeLock = null;
// What the copy is doing right now, and when bytes last moved: a stall is reported instead of a silent stop.
const activity = { what: '', file: '', moved: 0, timer: 0, reported: false };
function doing(what, file) { activity.what = what; if (file !== undefined) activity.file = file; }
function moved() {
  activity.moved = performance.now();
  if (activity.reported) { activity.reported = false; setStatus('copy-status', '', ''); }
}
function watch() {
  activity.moved = performance.now();
  activity.reported = false;
  clearInterval(activity.timer);
  activity.timer = setInterval(() => {
    const idle = (performance.now() - activity.moved) / 1000;
    if (idle > 30 && !activity.reported) {
      activity.reported = true;
      setStatus('copy-status', 'bad', `Nothing has moved for ${Math.round(idle)} s: the page is waiting for ` +
        `${escapeHtml(activity.what)}${activity.file ? ` (${escapeHtml(activity.file)})` : ''}. ` +
        (activity.what.includes('download') ? 'The browser may have stopped the download: check its downloads list. '
          : 'If the SD card was removed or is full, that stops it. ') +
        'Stop copying and start again if it does not carry on.');
    }
  }, 5000);
}
async function begin(kindLabel) {
  state.cancelled = false;
  enableTargets(false);
  $('update-only').disabled = true;
  $('iso').disabled = true;
  stepState('step-target', 'done');
  stepState('step-copy', 'active');
  $('cancel').classList.remove('hidden');
  $('copy-hint').textContent = `${kindLabel} Keep this page open until it finishes.`;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
  window.addEventListener('beforeunload', guard);
  document.addEventListener('visibilitychange', relock);
  watch();
}
// The screen lock is dropped when the page is hidden; asked for again when it is back.
async function relock() {
  if (document.visibilityState === 'visible' && wakeLock?.released !== false) {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not given */ }
  }
}
function guard(e) { e.preventDefault(); e.returnValue = ''; }
async function end() {
  clearInterval(activity.timer);
  document.removeEventListener('visibilitychange', relock);
  window.removeEventListener('beforeunload', guard);
  $('cancel').classList.add('hidden');
  try { await wakeLock?.release(); } catch { /* already released */ }
}

function progress(total) {
  let done = 0;
  const started = performance.now();
  let last = 0;
  const update = (force) => {
    const now = performance.now();
    if (!force && now - last < 250) return;
    last = now;
    $('meter').style.width = `${total ? (100 * done / total).toFixed(1) : 100}%`;
    $('done-bytes').innerHTML = `<strong>${GB(done)}</strong> of ${GB(total)}`;
    const secs = (now - started) / 1000;
    if (secs > 2 && done > 0) {
      const rate = done / secs;
      const left = Math.max(0, (total - done) / rate);
      $('speed').textContent = `${(rate / 1e6).toFixed(0)} MB/s, about ${left > 90 ? Math.round(left / 60) + ' min' : Math.round(left) + ' s'} left`;
    }
  };
  return {
    add(n) { done += n; moved(); update(false); },
    skip(n) { done += n; moved(); update(true); },
    finish() { done = total; update(true); $('speed').textContent = ''; },
  };
}

$('cancel').addEventListener('click', () => { state.cancelled = true; });

function checkCancel() {
  if (state.cancelled) throw new Error('Copying was stopped. Start it again to carry on.');
}

function finished(zip, done) {
  setStatus('copy-status', 'ok', zip
    ? (done || 'The ZIP is saved. Unpack it at the root of the SD card.')
    : `Everything is on the SD card, in <code>${escapeHtml(state.payload.sd_folder)}</code>.`);
  $('current').textContent = '';
  stepState('step-copy', 'done');
  stepState('step-play', 'active');
  $('play-unzip').classList.toggle('hidden', !zip);
  const again = document.getElementById('save-again');
  if (again && opfsSink.save) again.addEventListener('click', opfsSink.save);
}

function failed(e) {
  setStatus('copy-status', 'bad', `${escapeHtml(e.message || e)} ` +
    (state.cancelled ? '' : 'Nothing written so far is lost: writing to the SD card again skips the game files already there.'));
  $('iso').disabled = false;
  $('update-only').disabled = false;
  enableTargets(true);
}

// Write straight into a folder (the SD card).
$('to-folder').addEventListener('click', async () => {
  let root;
  try {
    root = await window.showDirectoryPicker({ id: 'mcla-nx-sd', mode: 'readwrite' });
  } catch {
    return; // closed without choosing
  }
  // The SD card's root, its "switch" folder, or the game's own folder: all land in the same place.
  const parts = state.payload.sd_folder.split('/');
  let dir = root;
  let start = parts.indexOf(root.name) >= 0 ? parts.indexOf(root.name) + 1 : 0;
  try {
    for (const part of parts.slice(start)) dir = await dir.getDirectoryHandle(part, { create: true });
  } catch (e) {
    setStatus('target-status', 'bad', `That folder cannot be written to: ${escapeHtml(e.message)}`);
    return;
  }
  const files = plan();
  const total = files.reduce((n, f) => n + f.size, 0);
  await begin('Writing to the SD card.');
  const meter = progress(total);
  try {
    for (const f of files) {
      checkCancel();
      const segs = f.path.split('/');
      let d = dir;
      for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true });
      const name = segs[segs.length - 1];
      let existing = null;
      try { existing = await (await d.getFileHandle(name)).getFile(); } catch { existing = null; }
      if (existing && (f.keepExisting || (f.resumable && existing.size === f.size))) {
        meter.skip(f.size);
        continue;
      }
      $('current').textContent = f.path;
      doing('the SD card to open the file', f.path);
      const handle = await d.getFileHandle(name, { create: true });
      const out = await handle.createWritable({ keepExistingData: false });
      try {
        const it = f.source()[Symbol.asyncIterator]();
        for (;;) {
          doing(f.kind === 'game' ? 'the disc image to be read' : 'the program files to download');
          const next = await it.next();
          if (next.done) break;
          checkCancel();
          doing('the SD card to take the data');
          await out.write(next.value);
          meter.add(next.value.length);
        }
        doing('the SD card to finish the file');
        await out.close();
      } catch (e) {
        try { await out.abort(); } catch { /* nothing to undo */ }
        throw e;
      }
    }
    meter.finish();
    finished(false);
  } catch (e) {
    failed(e);
  } finally {
    await end();
  }
});

// Save one ZIP: to a chosen file where the browser allows it, otherwise through the browser's download.
function zipSize(files, prefix) {
  const enc = new TextEncoder();
  let n = 98;
  for (const f of files) {
    const name = enc.encode(prefix + f.path).length;
    n += 30 + name + 20 + f.size + 24 + 46 + name + 28;
  }
  return n;
}

$('to-zip').addEventListener('click', async () => {
  const files = plan();
  const prefix = state.payload.sd_folder + '/';
  const name = state.updateOnly ? `mcla-nx-update-${state.payload.version}.zip` : `mcla-nx-${state.payload.version}.zip`;
  const size = zipSize(files, prefix);
  let sink;
  try {
    sink = canSaveFile ? await fileSink(name) : (await opfsSink(name, size)) || await downloadSink(name, size);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    setStatus('target-status', 'bad', `The ZIP could not be started: ${escapeHtml(e.message || e)}`);
    return;
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  await begin(sink.label);
  const meter = progress(total);
  try {
    const zip = new ZipWriter(sink.write);
    for (const f of files) {
      checkCancel();
      $('current').textContent = f.path;
      doing(sink.waiting, f.path);
      await zip.addFile(prefix + f.path, f.size, f.source(), (n) => { checkCancel(); meter.add(n); });
    }
    await zip.finish();
    doing('the ZIP to be finished');
    await sink.close();
    meter.finish();
    finished(true, sink.done);
  } catch (e) {
    await sink.abort(e);
    failed(e);
  } finally {
    await end();
  }
});

async function fileSink(name) {
  const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }] });
  const out = await handle.createWritable({ keepExistingData: false });
  return {
    label: 'Saving the ZIP.',
    waiting: 'the ZIP file to take the data',
    write: (b) => out.write(b),
    close: () => out.close(),
    abort: async () => { try { await out.abort(); } catch { /* nothing */ } },
  };
}

// Browsers without a save dialog (Firefox, Brave, phones): the ZIP is written to the browser's own storage on the
// device first, then saved as an ordinary download of that file. Nothing has to stay running while it downloads.
// null when the browser has no such storage or not enough room; the streamed download is used then.
async function opfsSink(name, size) {
  if (!navigator.storage?.getDirectory || !window.FileSystemFileHandle?.prototype.createWritable) return null;
  let dir, handle, out;
  try {
    try { await navigator.storage.persist(); } catch { /* not granted: still usable */ }
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('mcla-nx-zip', { recursive: true }).catch(() => {});  // an earlier ZIP
    const est = await navigator.storage.estimate();
    if (est.quota && est.quota - (est.usage || 0) < size * 1.05 + (64 << 20)) return null;
    dir = await root.getDirectoryHandle('mcla-nx-zip', { create: true });
    handle = await dir.getFileHandle(name, { create: true });
    out = await handle.createWritable({ keepExistingData: false });
  } catch {
    return null;
  }
  let pending = [];
  let pendingBytes = 0;
  const flush = async () => {
    if (!pendingBytes) return;
    const all = new Uint8Array(pendingBytes);
    let at = 0;
    for (const b of pending) { all.set(b, at); at += b.length; }
    pending = [];
    pendingBytes = 0;
    await out.write(all);
  };
  return {
    label: 'Making the ZIP in this browser\'s storage; it is saved as a download at the end.',
    waiting: 'this browser\'s storage to take the data',
    write: async (b) => {
      if (b.length >= 1 << 20) { await flush(); await out.write(b); return; }
      pending.push(b.slice());
      pendingBytes += b.length;
      if (pendingBytes >= 1 << 20) await flush();
    },
    close: async () => {
      await flush();
      await out.close();
      const file = await handle.getFile();
      const url = URL.createObjectURL(file);
      const save = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      save();
      opfsSink.save = save;
    },
    abort: async () => {
      try { await out.abort(); } catch { /* nothing */ }
      try { await dir.removeEntry(name); } catch { /* nothing */ }
    },
    get done() {
      return 'The ZIP is ready and your browser is saving it: check its downloads. If no download started, ' +
        '<button type="button" class="quiet" id="save-again">Save the ZIP again</button>. Then unpack it at the root ' +
        'of the SD card.';
    },
  };
}

// The service worker (sw.js) turns the bytes into a download; they go through a MessageChannel, one buffer at a time.
async function downloadSink(name, size) {
  if (!('serviceWorker' in navigator)) throw new Error('this browser cannot save large files from a page. Use Chrome, Edge or Firefox.');
  const reg = await navigator.serviceWorker.register('sw.js?v=5');
  await navigator.serviceWorker.ready;
  const worker = reg.active || navigator.serviceWorker.controller;
  if (!worker) throw new Error('the download helper did not start. Reload the page and try again.');
  const channel = new MessageChannel();
  const id = Math.random().toString(36).slice(2);
  let wantMore = null;
  let ended = false;
  const pulls = [];
  channel.port1.onmessage = (m) => {
    if (m.data.type === 'pull') {
      if (wantMore) { const w = wantMore; wantMore = null; w(); } else pulls.push(1);
    } else if (m.data.type === 'cancel') {
      state.cancelled = true;
      if (wantMore) { const w = wantMore; wantMore = null; w(); }
    } else if (m.data.type === 'ready' && readyResolve) {
      readyResolve();
    }
  };
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  worker.postMessage({ type: 'stream', id, name, size }, [channel.port2]);
  await ready;
  // Chrome stops an idle service worker after about 30 s, mid-download; a message to it every 10 s keeps it running.
  const keepAlive = setInterval(() => worker.postMessage({ type: 'ping' }), 10000);
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = `__download/${id}`;
  document.body.appendChild(frame);
  // Coalesce small pieces (headers) with the data so each pull carries a useful amount.
  let buffer = [];
  let buffered = 0;
  const waitPull = () => (pulls.length ? (pulls.shift(), Promise.resolve()) : new Promise((r) => { wantMore = r; }));
  const flush = async () => {
    if (!buffered) return;
    const out = new Uint8Array(buffered);
    let at = 0;
    for (const b of buffer) { out.set(b, at); at += b.length; }
    buffer = [];
    buffered = 0;
    await waitPull();
    if (state.cancelled) throw new Error('The download was stopped.');
    channel.port1.postMessage({ type: 'chunk', buffer: out.buffer }, [out.buffer]);
  };
  return {
    label: 'Saving the ZIP through the browser\'s download.',
    waiting: 'the browser\'s download to take the data',
    write: async (b) => {
      buffer.push(b.slice());
      buffered += b.length;
      if (buffered >= 4 << 20) await flush();
    },
    close: async () => {
      await flush();
      clearInterval(keepAlive);
      ended = true;
      channel.port1.postMessage({ type: 'end' });
    },
    abort: async (e) => {
      clearInterval(keepAlive);
      if (ended) return;
      ended = true;
      channel.port1.postMessage({ type: 'error', message: String(e && e.message || e) });
    },
  };
}

window.__mclaReady = true;
loadPayload();
