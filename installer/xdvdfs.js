// Reads an Xbox 360 disc image (XDVDFS / XGD2) straight from a File, in place: only the directory sectors and the
// files asked for are read; nothing is uploaded or copied into memory whole.

const SECTOR = 0x800;
const MAGIC = 'MICROSOFT*XBOX*MEDIA';
// Game partition offsets: raw XDVDFS, XGD2, XGD1, XGD3 and redump layouts (as scripts/extract_game.py).
const PARTITION_OFFSETS = [0x0, 0xFD90000, 0x2080000, 0x18300000, 0x89D80000];
const SKIP_DIRS = ['/$SystemUpdate'];

async function readBytes(file, offset, length) {
  return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}

export async function findPartition(file) {
  for (const base of PARTITION_OFFSETS) {
    const at = base + 32 * SECTOR;
    if (at + 28 > file.size) continue;
    const head = await readBytes(file, at, 28);
    if (String.fromCharCode(...head.subarray(0, 20)) === MAGIC) {
      const view = new DataView(head.buffer);
      return { base, rootSector: view.getUint32(20, true), rootSize: view.getUint32(24, true) };
    }
  }
  return null;
}

async function walk(file, base, sector, dirSize, path, out, depth) {
  if (depth > 32) throw new Error('The disc image has a directory loop.');
  const data = await readBytes(file, base + sector * SECTOR, dirSize);
  const view = new DataView(data.buffer);
  const stack = [0];
  const seen = new Set();
  while (stack.length) {
    const entry = stack.pop();
    if (seen.has(entry)) continue;
    seen.add(entry);
    const off = entry * 4;
    if (off + 14 > data.length) continue;
    const left = view.getUint16(off, true);
    if (left === 0xFFFF) continue;
    const right = view.getUint16(off + 2, true);
    const sec = view.getUint32(off + 4, true);
    const size = view.getUint32(off + 8, true);
    const attr = data[off + 12];
    const nameLen = data[off + 13];
    const name = String.fromCharCode(...data.subarray(off + 14, off + 14 + nameLen));
    const full = `${path}/${name}`;
    if (attr & 0x10) {
      if (size) await walk(file, base, sec, size, full, out, depth + 1);
    } else {
      out.push({ path: full, offset: base + sec * SECTOR, size });
    }
    if (left) stack.push(left);
    if (right) stack.push(right);
  }
}

// The files of the game partition, sorted, without the system update folder.
export async function listFiles(file) {
  const part = await findPartition(file);
  if (!part) return null;
  const out = [];
  await walk(file, part.base, part.rootSector, part.rootSize, '', out, 0);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out.filter((f) => !SKIP_DIRS.some((d) => f.path.startsWith(d)) && f.offset + f.size <= file.size);
}

export async function readFile(file, entry) {
  return readBytes(file, entry.offset, entry.size);
}

// The title ID in an XEX2 header (execution info, key 0x00040006), or null.
export function xexTitleId(bytes) {
  if (bytes.length < 0x18 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'XEX2') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0x14, false);
  for (let i = 0; i < count && 0x18 + i * 8 + 8 <= bytes.length; i++) {
    const key = view.getUint32(0x18 + i * 8, false);
    const value = view.getUint32(0x18 + i * 8 + 4, false);
    if (key === 0x00040006 && value + 16 <= bytes.length) return view.getUint32(value + 12, false);
  }
  return null;
}

// Yields the file's bytes in chunks, read in place.
export async function* chunks(file, offset, size, chunkSize = 8 << 20) {
  let done = 0;
  while (done < size) {
    const n = Math.min(chunkSize, size - done);
    const part = await readBytes(file, offset + done, n);
    if (part.length !== n) throw new Error('The disc image ended early: it may be incomplete.');
    yield part;
    done += n;
  }
}
