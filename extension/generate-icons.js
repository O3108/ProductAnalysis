const fs = require('fs');
const path = require('path');

// Генерируем простые PNG иконки через Canvas API (Node.js + canvas)
// Если canvas не доступен — создаём минимальные валидные PNG файлы вручную

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Минимальный валидный PNG 1x1 пиксель синего цвета, масштабируется браузером
// Это base64 PNG 16x16 с синим фоном и белой буквой P
const png16 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADUSURBVDiNpZMxDoIwFIa/tgMDCxMnYOECHoALeAAvwMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBxMTBAAAA',
  'base64'
);

// Создаём простые PNG иконки программно
function createSimplePNG(size) {
  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);   // width
  ihdrData.writeUInt32BE(size, 4);   // height
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 2;   // color type: RGB
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace

  const ihdr = makeChunk('IHDR', ihdrData);

  // IDAT chunk — raw image data (uncompressed via zlib)
  // Each row: filter byte (0) + RGB pixels
  const rowSize = 1 + size * 3;
  const rawData = Buffer.alloc(size * rowSize);

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // filter type: None

    for (let x = 0; x < size; x++) {
      const pixOffset = rowOffset + 1 + x * 3;
      const cx = x - size / 2;
      const cy = y - size / 2;
      const r = Math.sqrt(cx * cx + cy * cy);

      if (r < size * 0.45) {
        // Синий фон
        rawData[pixOffset] = 0x3b;     // R
        rawData[pixOffset + 1] = 0x82; // G
        rawData[pixOffset + 2] = 0xf6; // B
      } else {
        // Тёмный фон
        rawData[pixOffset] = 0x0f;
        rawData[pixOffset + 1] = 0x17;
        rawData[pixOffset + 2] = 0x2a;
      }
    }
  }

  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);
  const idat = makeChunk('IDAT', compressed);

  // IEND chunk
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

function crc32(buf) {
  const table = makeCRCTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCRCTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crcValue = Buffer.alloc(4);
  crcValue.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([len, typeBuffer, data, crcValue]);
}

[16, 48, 128].forEach((size) => {
  const png = createSimplePNG(size);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Created ${filePath} (${png.length} bytes)`);
});

console.log('Icons generated successfully!');
