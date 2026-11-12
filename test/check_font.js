const fs = require('fs');
const path = require('path');

// Simple OpenType 'name' table parser to read font family and full name
function getFontNames(filePath) {
  const buf = fs.readFileSync(filePath);
  const numTables = buf.readUInt16BE(4);
  let nameTableOffset = 0;
  for (let i = 0; i < numTables; i++) {
    const tag = buf.toString('utf8', 12 + i * 16, 16 + i * 16);
    if (tag === 'name') {
      nameTableOffset = buf.readUInt32BE(12 + i * 16 + 8);
      break;
    }
  }
  if (!nameTableOffset) return null;
  const count = buf.readUInt16BE(nameTableOffset + 2);
  const stringOffset = nameTableOffset + buf.readUInt16BE(nameTableOffset + 4);
  const records = {};
  for (let i = 0; i < count; i++) {
    const recOffset = nameTableOffset + 6 + i * 12;
    const platformID = buf.readUInt16BE(recOffset);
    const nameID = buf.readUInt16BE(recOffset + 6);
    const length = buf.readUInt16BE(recOffset + 8);
    const offset = buf.readUInt16BE(recOffset + 10);
    let str = '';
    if (platformID === 3 || platformID === 0) {
      str = buf.toString('utf16be', stringOffset + offset, stringOffset + offset + length);
    } else {
      str = buf.toString('utf8', stringOffset + offset, stringOffset + offset + length);
    }
    if (!records[nameID]) records[nameID] = str;
  }
  return { family: records[1], subFamily: records[2], fullName: records[4], postscriptName: records[6] };
}

const fontDir = path.join(__dirname, '..', 'fonts');
const files = fs.readdirSync(fontDir);
for (const f of files) {
  if (f.endsWith('.ttf') || f.endsWith('.otf')) {
    try {
      const info = getFontNames(path.join(fontDir, f));
      console.log(f, '=>', info);
    } catch (e) {}
  }
}
