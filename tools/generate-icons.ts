/**
 * PWA home-screen icons, generated at build-time-adjacent (run once,
 * commit the output) rather than pulling in a design tool or an image
 * library -- this is a handful of flat shapes in the app's own palette,
 * and Node's built-in zlib is enough to hand-roll a PNG encoder for that.
 * No new dependency for five small, static files.
 *
 * Run: npx tsx tools/generate-icons.ts
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// ---------- tiny RGBA raster ----------

class Raster {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array; // RGBA, row-major

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    // Simple straight alpha-over-opaque-background compositing -- every
    // shape here is drawn over an already-opaque background, so this is
    // exact, not an approximation.
    const srcA = a / 255;
    this.data[i] = Math.round(r * srcA + this.data[i]! * (1 - srcA));
    this.data[i + 1] = Math.round(g * srcA + this.data[i + 1]! * (1 - srcA));
    this.data[i + 2] = Math.round(b * srcA + this.data[i + 2]! * (1 - srcA));
    this.data[i + 3] = 255;
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, color: [number, number, number]) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, Math.ceil(x1)); x++) {
        this.setPixel(x, y, ...color, 255);
      }
    }
  }

  /** Rounded rect via a per-pixel corner-distance test -- simplest correct approach for a one-off generator, no perf constraint. */
  fillRoundedRect(x0: number, y0: number, x1: number, y1: number, radius: number, color: [number, number, number]) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        if (px < x0 || px > x1 || py < y0 || py > y1) continue;
        const inCornerBox =
          (px < x0 + radius && py < y0 + radius) ||
          (px > x1 - radius && py < y0 + radius) ||
          (px < x0 + radius && py > y1 - radius) ||
          (px > x1 - radius && py > y1 - radius);
        if (inCornerBox) {
          const cx = px < x0 + radius ? x0 + radius : x1 - radius;
          const cy = py < y0 + radius ? y0 + radius : y1 - radius;
          if (Math.hypot(px - cx, py - cy) > radius) continue;
        }
        this.setPixel(x, y, ...color, 255);
      }
    }
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, color: [number, number, number]) {
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(this.h, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(this.w, Math.ceil(cx + rx)); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.setPixel(x, y, ...color, 255);
      }
    }
  }

  /** Right-pointing flag triangle: tip at (x,yTop), base spanning yTop..yTop+h at x. */
  fillFlagTriangle(x: number, yTop: number, w: number, h: number, color: [number, number, number]) {
    for (let y = Math.floor(yTop); y < Math.ceil(yTop + h); y++) {
      const t = (y + 0.5 - yTop) / h; // 0 at top edge, 1 at bottom edge
      const widthHere = w * (1 - Math.abs(t - 0.5) * 2);
      for (let px = Math.floor(x); px < Math.ceil(x + widthHere); px++) {
        this.setPixel(px, y, ...color, 255);
      }
    }
  }
}

// ---------- minimal PNG encoder (8-bit RGBA, filter-none scanlines) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(raster: Raster): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(raster.w, 0);
  ihdr.writeUInt32BE(raster.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline prefixed with filter-type 0 (None) -- simplest correct
  // encoding; these are small flat-shape icons, not photos, so there's no
  // real compression ratio being left on the table by skipping filtering.
  const stride = raster.w * 4;
  const raw = Buffer.alloc(raster.h * (stride + 1));
  for (let y = 0; y < raster.h; y++) {
    raw[y * (stride + 1)] = 0;
    raster.data.subarray(y * stride, (y + 1) * stride).forEach((byte, i) => {
      raw[y * (stride + 1) + 1 + i] = byte;
    });
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idatData), chunk("IEND", new Uint8Array(0))]);
}

// ---------- the icon itself ----------

const DEEP = [13, 59, 37] as [number, number, number]; // --deep
const FLAG = [244, 241, 232] as [number, number, number]; // pin flag cream
const POLE = [28, 39, 33] as [number, number, number]; // pin pole
const GREEN = [30, 107, 68] as [number, number, number]; // fairway green

function drawIcon(size: number, maskable: boolean): Raster {
  const r = new Raster(size, size);
  if (maskable) {
    r.fillRect(0, 0, size, size, DEEP);
  } else {
    r.fillRoundedRect(0, 0, size, size, size * 0.22, DEEP);
  }

  const cx = size / 2;
  const groundY = size * (maskable ? 0.72 : 0.78);
  const poleTopY = size * (maskable ? 0.24 : 0.18);
  const poleW = Math.max(2, size * 0.018);

  r.fillEllipse(cx, groundY, size * 0.22, size * 0.05, GREEN);
  r.fillRect(cx - poleW / 2, poleTopY, cx + poleW / 2, groundY, POLE);
  r.fillFlagTriangle(cx, poleTopY, size * 0.19, size * 0.13, FLAG);
  r.fillEllipse(cx, groundY, size * 0.045, size * 0.018, DEEP);

  return r;
}

function main() {
  const outDir = resolve(process.cwd(), "apps/web/public/icons");
  mkdirSync(outDir, { recursive: true });

  const targets: Array<[string, number, boolean]> = [
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["icon-maskable-192.png", 192, true],
    ["icon-maskable-512.png", 512, true],
    ["apple-touch-icon-180.png", 180, false],
  ];

  for (const [name, size, maskable] of targets) {
    const png = encodePng(drawIcon(size, maskable));
    writeFileSync(resolve(outDir, name), png);
    console.log(`wrote ${name} (${size}x${size}${maskable ? ", maskable" : ""}) -- ${png.length} bytes`);
  }
}

main();
