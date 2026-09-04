// One-off: samples assets/Screenagers-logo.svg onto the voxel grid used by the LOGO constant in public/index.html.
// Needs Playwright, which is not a dependency of Bullpen. Run it from any project that has it installed:
//   NODE_PATH=/path/to/that/project/node_modules node assets/rasterise-logo.cjs
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(__dirname + '/Screenagers-logo.svg', 'utf8');
  const W = 66, H = 49;                                  // voxel grid for the wall piece
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  const px = await page.evaluate(async ({ W, H }) => {
    const el = document.querySelector('svg');
    const s = new XMLSerializer().serializeToString(el);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(s))); });
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data; const out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] > 120) out.push([x, y, d[i], d[i + 1], d[i + 2]]);
    }
    return out;
  }, { W, H });
  await browser.close();

  // snap every pixel to the logo's own gradient stops so the brand colours survive
  const BRAND = ['#1EB4B2','#48BF98','#6CC981','#8CD26C','#A8D95B','#BEDF4D','#CFE342','#DAE73A','#E1E836','#E3E935','#231F20'];
  const cents = BRAND.map(h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]);
  const hex = BRAND.map(h => '0x' + h.slice(1).toLowerCase());
  const grid = Array.from({ length: H }, () => new Array(W).fill('.'));
  const CH = 'abcdefghijk';
  const used = new Set();
  for (const [x, y, r, g, b] of px) {
    let bi = 0, bd = 1e9;
    cents.forEach((c, i) => { const d = (c[0]-r)**2 + (c[1]-g)**2 + (c[2]-b)**2; if (d < bd) { bd = d; bi = i; } });
    grid[y][x] = CH[bi]; used.add(CH[bi]);
  }
  const rows = grid.map(r => r.join('').replace(/\.+$/, ''));
  fs.writeFileSync(__dirname + '/logo-map.json', JSON.stringify({ W, H, palette: hex, rows }, null, 0));
  console.log('pixels:', px.length, 'of', W * H, '| palette used:', [...used].sort().join(''), '| colors:', hex.join(' '));
  console.log('sample rows:'); rows.slice(10, 16).forEach(r => console.log(' ', r));
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
