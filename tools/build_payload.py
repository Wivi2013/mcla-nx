import argparse
import hashlib
import json
import posixpath
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('zips', nargs='+', type=Path, help="the release's .zip file(s); the one holding the .nro is used")
ap.add_argument('--out', required=True, type=Path)
ap.add_argument('--version', required=True)
ap.add_argument('--disc', type=Path, default=HERE / 'disc.json')
ap.add_argument('--default-toml', type=Path, default=HERE / 'mcla.default.toml')
a = ap.parse_args()


def fail(msg):
    print(f'::error::{msg}')
    sys.exit(1)


def warn(msg):
    print(f'::warning::{msg}')


def members(z):
    for info in z.infolist():
        name = info.filename.replace('\\', '/')
        if info.is_dir() or name.startswith('__MACOSX/') or '/._' in name:
            continue
        clean = posixpath.normpath(name)
        if clean.startswith(('../', '/')) or clean == '..':
            continue  # never outside the folder
        yield clean, info


# the .zip with exactly one .nro in it
chosen = None
for path in a.zips:
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        warn(f'{path.name} is not a readable .zip: skipped')
        continue
    nros = [n for n, _ in members(z) if n.lower().endswith('.nro')]
    if len(nros) == 1:
        chosen = (path, z, nros[0])
        break
    if len(nros) > 1:
        fail(f'{path.name} has {len(nros)} .nro files ({", ".join(nros[:4])}); the installer needs exactly one')
if not chosen:
    fail('None of the release\'s .zip files has a .nro in it. Attach the .zip with the switch/MCLA-NX folder.')
path, z, nro = chosen
base = posixpath.dirname(nro)  # e.g. switch/MCLA-NX
sd_folder = base if base.lower().startswith('switch/') else 'switch/MCLA-NX'
print(f'{path.name}: {nro}  ->  {sd_folder}/')

files = {}  # path in the SD folder -> (bytes, keep_existing)
for name, info in members(z):
    if base and not name.startswith(base + '/'):
        continue
    rel = name[len(base) + 1:] if base else name
    low = rel.lower()
    if name == nro:
        files[posixpath.basename(nro)] = (z.read(info), False)
    elif low.startswith('shaders-c064/'):
        files[rel] = (z.read(info), False)
    elif low == 'mcla.toml':
        files['mcla.toml'] = (z.read(info), True)
nro_name = posixpath.basename(nro)
if not any(k.lower().startswith('shaders-c064/shader-cache/') for k in files):
    fail(f'{path.name} has no {base}/shaders-c064/shader-cache: the game cannot start without its shaders')
for fsr in ('fsr_easu_ps.bdk3', 'fsr_rcas2_ps.bdk3'):
    if f'shaders-c064/deko-host/{fsr}' not in files:
        warn(f'{path.name} has no shaders-c064/deko-host/{fsr}: FSR 1 will fall back to plain scaling')
if 'mcla.toml' not in files:
    files['mcla.toml'] = (a.default_toml.read_bytes(), True)
    print('no mcla.toml in the .zip: tools/mcla.default.toml used')
nro_bytes = files[nro_name][0]
if nro_bytes[16:20] != b'NRO0':
    fail(f'{nro} is not an NRO')
for k, (data, _) in files.items():
    if len(data) >= 100 * 2**20:
        fail(f'{k} is {len(data) / 2**20:.0f} MB: GitHub Pages serves files under 100 MB')

disc = json.loads(a.disc.read_text(encoding='utf-8'))
manifest = dict(
    version=a.version,
    nro=nro_name,
    sd_folder=sd_folder,
    game_folder='game',
    xex=dict(title_id=disc['title_id'], sha256=disc['sha256']),
    files=[dict(path=k, size=len(v[0]), sha256=hashlib.sha256(v[0]).hexdigest(), keep_existing=v[1])
           for k, v in sorted(files.items())],
)
out = a.out
for k, (data, _) in files.items():
    target = out / 'payload' / k
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
(out / 'payload.json').write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf-8')
total = sum(len(v[0]) for v in files.values())
print(f'payload {a.version}: {len(files)} files, {total / 2**20:.1f} MiB, NRO {nro_name}, folder {sd_folder}')
