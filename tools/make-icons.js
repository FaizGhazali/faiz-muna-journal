// Draws the app icon, a white weighing-scale dial on blue, with no image libraries.
const fs = require("fs"), path = require("path"), zlib = require("zlib");

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) { c = (crc ^ b) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), t = Buffer.from(type);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function coverage(x, y) {
  const dx = x - 0.5, dy = y - 0.5, r = Math.hypot(dx, dy);
  if (r > 0.25 && r < 0.3) return 1; // dial ring
  const a = Math.atan2(dy, dx);
  for (const t of [-150, -120, -90, -60, -30]) { // tick marks
    if (r > 0.19 && r < 0.25 && Math.abs(a - (t * Math.PI) / 180) < 0.05) return 1;
  }
  const nx = 0.5 + 0.13, ny = 0.5 - 0.1, vx = nx - 0.5, vy = ny - 0.5; // needle
  const u = Math.max(0, Math.min(1, (dx * vx + dy * vy) / (vx * vx + vy * vy)));
  if (Math.hypot(dx - u * vx, dy - u * vy) < 0.016) return 1;
  return r < 0.035 ? 1 : 0;
}
function icon(size) {
  const bg = [0x2f, 0x4b, 0xd6], SS = 3, rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      let n = 0;
      for (let i = 0; i < SS; i++) for (let j = 0; j < SS; j++) n += coverage((x + (i + 0.5) / SS) / size, (y + (j + 0.5) / SS) / size);
      const c = n / (SS * SS);
      for (let k = 0; k < 3; k++) row[1 + x * 3 + k] = Math.round(bg[k] + (255 - bg[k]) * c);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
for (const s of [192, 512]) fs.writeFileSync(path.join(__dirname, "..", "public", `icon-${s}.png`), icon(s));
