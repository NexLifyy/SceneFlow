'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const IMAGE_EXT = /\.(png|jpg|jpeg|gif|bmp|webp|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm|m4v)$/i;

/**
 * Find the End of Central Directory (EOCD) offset in a ZIP buffer.
 * @param {Buffer} buf
 * @returns {number}
 */
function findEocdOffset(buf) {
  const minOffset = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Decode entry filename from ZIP central/local header using UTF-8 or latin1 fallback.
 * @param {Buffer} nameBuf
 * @param {number} flags
 * @returns {string}
 */
function decodeZipFilename(nameBuf, flags) {
  if ((flags & 0x0800) !== 0) {
    return nameBuf.toString('utf8');
  }
  const utf8Attempt = nameBuf.toString('utf8');
  if (!utf8Attempt.includes('\uFFFD')) {
    return utf8Attempt;
  }
  return nameBuf.toString('latin1');
}

/**
 * Extract supported image and video files from a .zip archive into destDir.
 * Skips directories, hidden macOS resource forks, and unsupported file types.
 *
 * @param {string} zipPath
 * @param {string} destDir
 * @returns {Array<{ name: string, path: string, type: 'image'|'video', size: number }>}
 */
function extractViaPython(zipPath, destDir) {
  const { findPython } = require('./transcriber');
  const py = findPython();
  if (!py) throw new Error('ZIP64 / unsupported compression requires Python zipfile support');
  const pyScript = [
    'import sys, os, re, json, zipfile',
    'zip_path, dest_dir = sys.argv[1], sys.argv[2]',
    'img_re = re.compile(r"\\.(png|jpe?g|gif|bmp|webp|tiff?)$", re.I)',
    'vid_re = re.compile(r"\\.(mp4|mov|avi|mkv|webm|m4v)$", re.I)',
    'seen = set()',
    'out = []',
    'with zipfile.ZipFile(zip_path, "r") as zf:',
    '  for info in zf.infolist():',
    '    norm = info.filename.replace("\\\\", "/")',
    '    if norm.endswith("/") or norm.startswith("__MACOSX/") or "/__MACOSX/" in norm: continue',
    '    base = os.path.basename(norm).strip()',
    '    if not base or base.startswith("._"): continue',
    '    is_vid, is_img = bool(vid_re.search(base)), bool(img_re.search(base))',
    '    if not (is_vid or is_img): continue',
    '    target = base',
    '    if target.lower() in seen:',
    '      stem, ext = os.path.splitext(base)',
    '      idx = 2',
    '      while f"{stem}_{idx}{ext}".lower() in seen: idx += 1',
    '      target = f"{stem}_{idx}{ext}"',
    '    seen.add(target.lower())',
    '    out_path = os.path.join(os.path.abspath(dest_dir), target)',
    '    with zf.open(info) as src, open(out_path, "wb") as dst:',
    '      dst.write(src.read())',
    '    out.append({"name": target, "path": out_path, "type": "video" if is_vid else "image", "size": info.file_size})',
    'print(json.dumps(out))'
  ].join('\n');
  const stdout = execFileSync(py, ['-c', pyScript, zipPath, destDir], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(stdout.trim() || '[]');
}

function extractZipMedia(zipPath, destDir) {
  if (!zipPath || !fs.existsSync(zipPath)) {
    throw new Error('Zip file not found');
  }
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const stat = fs.statSync(zipPath);
  if (stat.size > 512 * 1024 * 1024) {
    return extractViaPython(zipPath, destDir);
  }

  const buf = fs.readFileSync(zipPath);
  const eocdOffset = findEocdOffset(buf);
  if (eocdOffset < 0) {
    return extractViaPython(zipPath, destDir);
  }

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);

  if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    return extractViaPython(zipPath, destDir);
  }

  if (cdOffset + cdSize > buf.length) {
    throw new Error('ZIP central directory exceeds buffer bounds');
  }

  const extracted = [];
  const seenNames = new Set();
  let cursor = cdOffset;

  for (let i = 0; i < entryCount && cursor + 46 <= cdOffset + cdSize; i++) {
    const sig = buf.readUInt32LE(cursor);
    if (sig !== 0x02014b50) break;

    const flags = buf.readUInt16LE(cursor + 8);
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);

    const rawName = decodeZipFilename(
      buf.slice(cursor + 46, cursor + 46 + nameLen),
      flags
    );
    cursor += 46 + nameLen + extraLen + commentLen;

    // Skip directories and __MACOSX metadata
    const normalizedName = rawName.replace(/\\/g, '/');
    if (
      normalizedName.endsWith('/') ||
      normalizedName.startsWith('__MACOSX/') ||
      normalizedName.includes('/__MACOSX/')
    ) {
      continue;
    }

    const baseName = path.basename(normalizedName).trim();
    if (!baseName || baseName.startsWith('._')) continue;

    const isVideo = VIDEO_EXT.test(baseName);
    const isImage = IMAGE_EXT.test(baseName);
    if (!isVideo && !isImage) continue;

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      continue;
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) continue;

    const compressedData = buf.slice(dataStart, dataEnd);
    let content;
    if (method === 0) {
      content = compressedData;
    } else if (method === 8) {
      content = zlib.inflateRawSync(compressedData);
    } else {
      return extractViaPython(zipPath, destDir);
    }

    // Deduplicate colliding names within the archive
    let targetName = baseName;
    if (seenNames.has(targetName.toLowerCase())) {
      const ext = path.extname(baseName);
      const stem = path.basename(baseName, ext);
      let idx = 2;
      while (seenNames.has(`${stem}_${idx}${ext}`.toLowerCase())) idx++;
      targetName = `${stem}_${idx}${ext}`;
    }
    seenNames.add(targetName.toLowerCase());

    const resolvedDest = path.resolve(destDir);
    const outPath = path.resolve(resolvedDest, targetName);
    if (!outPath.startsWith(resolvedDest + path.sep) && outPath !== resolvedDest) {
      continue;
    }

    fs.writeFileSync(outPath, content);
    extracted.push({
      name: targetName,
      path: outPath,
      type: isVideo ? 'video' : 'image',
      size: uncompressedSize || content.length
    });
  }

  return extracted;
}

module.exports = {
  extractZipMedia
};
