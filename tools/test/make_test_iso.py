import os, struct, sys, random
from pathlib import Path

SECTOR = 0x800
out = Path(sys.argv[1]); expect = Path(sys.argv[2])
base = int(sys.argv[4], 0) if len(sys.argv) > 4 and sys.argv[3] == '--base' else 0
rng = random.Random(7)

def xex(title):
    h = bytearray(0x200)
    h[0:4] = b'XEX2'
    struct.pack_into('>I', h, 0x14, 2)
    struct.pack_into('>II', h, 0x18, 0x00010001, 0)
    struct.pack_into('>II', h, 0x20, 0x00040006, 0x100)
    struct.pack_into('>I', h, 0x100 + 12, title)
    return bytes(h) + bytes(rng.getrandbits(8) for _ in range(5000))

files = {
    'default.xex': xex(0x545407F8),
    'xarchive_cache.rpf': bytes(rng.getrandbits(8) for _ in range(3 * 2**20 + 123)),
    'intro720.bik': bytes(rng.getrandbits(8) for _ in range(700000)),
    'sub/inner.dat': b'inner file\n' * 1000,
    '$SystemUpdate/su20076000_00000000': b'update' * 100,
}

# layout: sector 32 volume descriptor, directories from sector 40, file data after
sectors = {}
next_sector = 40
def alloc(n):
    global next_sector
    s = next_sector
    next_sector += (n + SECTOR - 1) // SECTOR or 1
    return s

tree = {}
for path, data in files.items():
    parts = path.split('/')
    d = tree
    for p in parts[:-1]:
        d = d.setdefault(p, {})
    d[parts[-1]] = data

def dir_bytes(d, placements):
    # entries linked through the right pointer
    names = sorted(d)
    raw = bytearray()
    offs = []
    for n in names:
        offs.append(len(raw))
        size = 14 + len(n)
        raw += bytes(size + (-size % 4))
    for i, n in enumerate(names):
        sec, size, attr = placements[n]
        right = offs[i + 1] // 4 if i + 1 < len(names) else 0
        struct.pack_into('<HHIIBB', raw, offs[i], 0, right, sec, size, attr, len(n))
        raw[offs[i] + 14:offs[i] + 14 + len(n)] = n.encode('latin-1')
    raw += b'\xff' * (-len(raw) % SECTOR)
    return bytes(raw)

blobs = []  # (sector, bytes)
def place_dir(d):
    placements = {}
    for n in sorted(d):
        v = d[n]
        if isinstance(v, dict):
            sec, size = place_dir(v)
            placements[n] = (sec, size, 0x10)
        else:
            sec = alloc(len(v))
            blobs.append((sec, v))
            placements[n] = (sec, len(v), 0x80)
    raw = dir_bytes(d, placements)
    sec = alloc(len(raw))
    blobs.append((sec, raw))
    return sec, len(raw)

root_sec, root_size = place_dir(tree)
total = base + next_sector * SECTOR
with open(out, 'wb') as f:
    f.truncate(total)
    f.seek(base + 32 * SECTOR)
    f.write(b'MICROSOFT*XBOX*MEDIA' + struct.pack('<II', root_sec, root_size))
    for sec, data in blobs:
        f.seek(base + sec * SECTOR)
        f.write(data)
for path, data in files.items():
    if path.startswith('$SystemUpdate'):
        continue
    p = expect / 'game' / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
print(out, total, 'bytes; root', root_sec, root_size)
