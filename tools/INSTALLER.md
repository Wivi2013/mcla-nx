# Publishing the installer page

The page in `installer/` is published to GitHub Pages at https://wivi2013.github.io/mcla-nx/ by
`.github/workflows/pages.yml`. A release needs nothing special: the workflow takes the newest release that has a
`.zip` attached (pre-releases count, drafts do not) and builds the page's files from it with `tools/build_payload.py`.

One time: Settings > Pages > Build and deployment > Source: **GitHub Actions**.

For each version, attach the usual release `.zip` with the Switch folder as it goes on the SD card:

    switch/MCLA-NX/mcla-nx.nro
    switch/MCLA-NX/shaders-c064/...    (shader-cache, deko-host with fsr_easu_ps.bdk3 and fsr_rcas2_ps.bdk3, ...)
    switch/MCLA-NX/mcla.toml           (optional: tools/mcla.default.toml is used without it)

Only the `.nro`, `shaders-c064` and `mcla.toml` are taken from it; nothing else in the `.zip` reaches the page. Other
files attached to the release (a `.rar`, notes) are ignored. Publishing the release runs the workflow (Actions >
Publish the installer); if the `.zip` of a published release is replaced, run that workflow by hand (Run workflow).

`tools/disc.json` holds the disc the NRO accepts (title ID and the SHA-256 of `default.xex`). It changes only if the
game code is ever regenerated from another executable.

To test the page on a PC first: copy `installer/` to a folder, run
`python tools/build_payload.py <release .zip> --out <that folder> --version test`, then
`python tools/serve_local.py <that folder> 8000` and open http://localhost:8000/.
