// A streaming ZIP writer: stored entries (no compression), ZIP64 everywhere, so files and archives over 4 GB work.
// write(Uint8Array) is called in order with every byte of the archive.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256 * 8);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  for (let n = 0; n < 256; n++) {
    let c = t[n];
    for (let s = 1; s < 8; s++) {
      c = t[c & 0xFF] ^ (c >>> 8);
      t[s * 256 + n] = c >>> 0;
    }
  }
  return t;
})();

export function crc32Update(crc, bytes) {
  let c = ~crc >>> 0;
  let i = 0;
  const n = bytes.length;
  const t = CRC_TABLE;
  // slicing-by-8
  for (; i + 8 <= n; i += 8) {
    c ^= bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
    const hi = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24);
    c = t[7 * 256 + (c & 0xFF)] ^ t[6 * 256 + ((c >>> 8) & 0xFF)] ^ t[5 * 256 + ((c >>> 16) & 0xFF)] ^
        t[4 * 256 + (c >>> 24)] ^ t[3 * 256 + (hi & 0xFF)] ^ t[2 * 256 + ((hi >>> 8) & 0xFF)] ^
        t[256 + ((hi >>> 16) & 0xFF)] ^ t[hi >>> 24];
  }
  for (; i < n; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return ~c >>> 0;
}

const enc = new TextEncoder();

function header(size) {
  const buf = new Uint8Array(size);
  return { buf, view: new DataView(buf.buffer) };
}

function u64(view, at, value) {
  view.setUint32(at, value % 0x100000000, true);
  view.setUint32(at + 4, Math.floor(value / 0x100000000), true);
}

// 2026-01-01 00:00 in DOS form
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export class ZipWriter {
  constructor(write) {
    this.write = write;
    this.offset = 0;
    this.entries = [];
  }

  async emit(bytes) {
    await this.write(bytes);
    this.offset += bytes.length;
  }

  // source: an async iterable of Uint8Array, exactly `size` bytes in all.
  async addFile(name, size, source, onBytes) {
    const nameBytes = enc.encode(name);
    const start = this.offset;
    const local = header(30 + nameBytes.length + 20);
    const v = local.view;
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 45, true);           // version needed: ZIP64
    v.setUint16(6, 0x0808, true);       // data descriptor follows; UTF-8 names
    v.setUint16(8, 0, true);            // stored
    v.setUint16(10, DOS_TIME, true);
    v.setUint16(12, DOS_DATE, true);
    v.setUint32(14, 0, true);           // CRC in the descriptor
    v.setUint32(18, 0xFFFFFFFF, true);
    v.setUint32(22, 0xFFFFFFFF, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 20, true);
    local.buf.set(nameBytes, 30);
    const x = 30 + nameBytes.length;
    v.setUint16(x, 0x0001, true);       // ZIP64 extra: sizes in the descriptor
    v.setUint16(x + 2, 16, true);
    await this.emit(local.buf);

    let crc = 0;
    let written = 0;
    for await (const chunk of source) {
      crc = crc32Update(crc, chunk);
      await this.emit(chunk);
      written += chunk.length;
      if (onBytes) onBytes(chunk.length);
    }
    if (written !== size) throw new Error(`${name}: ${written} bytes read, ${size} expected.`);

    const desc = header(24);
    desc.view.setUint32(0, 0x08074b50, true);
    desc.view.setUint32(4, crc, true);
    u64(desc.view, 8, size);
    u64(desc.view, 16, size);
    await this.emit(desc.buf);
    this.entries.push({ nameBytes, crc, size, start });
  }

  async finish() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const c = header(46 + e.nameBytes.length + 28);
      const v = c.view;
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, (3 << 8) | 45, true);  // made by: Unix, 4.5
      v.setUint16(6, 45, true);
      v.setUint16(8, 0x0808, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, DOS_TIME, true);
      v.setUint16(14, DOS_DATE, true);
      v.setUint32(16, e.crc, true);
      v.setUint32(20, 0xFFFFFFFF, true);
      v.setUint32(24, 0xFFFFFFFF, true);
      v.setUint16(28, e.nameBytes.length, true);
      v.setUint16(30, 28, true);
      v.setUint16(32, 0, true);
      v.setUint16(34, 0, true);
      v.setUint16(36, 0, true);
      v.setUint32(38, (0o100644 << 16) >>> 0, true);
      v.setUint32(42, 0xFFFFFFFF, true);
      c.buf.set(e.nameBytes, 46);
      const x = 46 + e.nameBytes.length;
      v.setUint16(x, 0x0001, true);
      v.setUint16(x + 2, 24, true);
      u64(v, x + 4, e.size);
      u64(v, x + 12, e.size);
      u64(v, x + 20, e.start);
      await this.emit(c.buf);
    }
    const cdSize = this.offset - cdStart;
    const eocd64Start = this.offset;
    const z = header(56 + 20 + 22);
    const v = z.view;
    v.setUint32(0, 0x06064b50, true);
    u64(v, 4, 44);
    v.setUint16(12, (3 << 8) | 45, true);
    v.setUint16(14, 45, true);
    v.setUint32(16, 0, true);
    v.setUint32(20, 0, true);
    u64(v, 24, this.entries.length);
    u64(v, 32, this.entries.length);
    u64(v, 40, cdSize);
    u64(v, 48, cdStart);
    v.setUint32(56, 0x07064b50, true);
    v.setUint32(60, 0, true);
    u64(v, 64, eocd64Start);
    v.setUint32(72, 1, true);
    v.setUint32(76, 0x06054b50, true);
    v.setUint16(80, 0, true);
    v.setUint16(82, 0, true);
    v.setUint16(84, 0xFFFF, true);
    v.setUint16(86, 0xFFFF, true);
    v.setUint32(88, 0xFFFFFFFF, true);
    v.setUint32(92, 0xFFFFFFFF, true);
    v.setUint16(96, 0, true);
    await this.emit(z.buf);
  }
}
