// Streams a ZIP made on the page to the browser's own download, for browsers that cannot save to a chosen file.
// The page sends the bytes through a MessageChannel; nothing leaves the device.
const pending = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'stream' || !event.ports[0]) return;
  const port = event.ports[0];
  let waiting = null;
  const queue = [];  // an end or error that came while nothing was waiting
  const serve = (w, m) => {
    if (m.type === 'chunk') w.controller.enqueue(new Uint8Array(m.buffer));
    else if (m.type === 'end') w.controller.close();
    else if (m.type === 'error') w.controller.error(new Error(m.message));
    w.resolve();
  };
  const stream = new ReadableStream({
    pull(controller) {
      return new Promise((resolve) => {
        if (queue.length) { serve({ controller, resolve }, queue.shift()); return; }
        waiting = { controller, resolve };
        port.postMessage({ type: 'pull' });
      });
    },
    cancel() {
      port.postMessage({ type: 'cancel' });
    },
  }, { highWaterMark: 1 });
  port.onmessage = (msg) => {
    const m = msg.data;
    if (!waiting) { queue.push(m); return; }
    const w = waiting;
    waiting = null;
    serve(w, m);
  };
  pending.set(data.id, { stream, name: data.name, size: data.size });
  port.postMessage({ type: 'ready' });
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const at = url.pathname.lastIndexOf('/__download/');
  if (at < 0) return;
  const id = url.pathname.slice(at + '/__download/'.length);
  const item = pending.get(id);
  if (!item) {
    event.respondWith(new Response('This download has ended. Start it again from the page.', { status: 404 }));
    return;
  }
  pending.delete(id);
  const headers = {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${item.name}"`,
  };
  if (item.size) headers['Content-Length'] = String(item.size);
  event.respondWith(new Response(item.stream, { headers }));
});
