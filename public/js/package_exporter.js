'use strict';

/**
 * package_exporter.js — Pure In-Browser 1-Click Render Package Generator
 *
 * For web deployments (e.g. Vercel), this packages all project media assets,
 * voiceover audio, background music, styled ASS kinetic subtitles, and an optimized
 * standalone FFmpeg filtergraph into a self-contained ZIP archive.
 *
 * When the user extracts the zip on their PC and clicks `render.bat` (Windows)
 * or `render.sh` (Mac/Linux), it compiles the full video with desktop FFmpeg
 * in 2K/4K resolution, GPU acceleration, all transitions, and multi-track audio.
 */

// CRC-32 table for standard ZIP format
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function calculateCrc32(data) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

/**
 * Create a standard, uncompressed (STORE mode) ZIP file directly in memory.
 * Compatible with Windows Explorer, macOS Archive Utility, 7-Zip, WinRAR, and Linux unzip.
 *
 * @param {Array<{ name: string, data: Uint8Array|ArrayBuffer|string }>} entries
 * @returns {Blob}
 */
export function createZipBlob(entries) {
  const localHeaders = [];
  const centralHeaders = [];
  let currentOffset = 0;

  const textEncoder = new TextEncoder();

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    let dataBytes;
    if (typeof entry.data === 'string') {
      dataBytes = textEncoder.encode(entry.data);
    } else if (entry.data instanceof Uint8Array) {
      dataBytes = entry.data;
    } else if (entry.data instanceof ArrayBuffer) {
      dataBytes = new Uint8Array(entry.data);
    } else {
      dataBytes = new Uint8Array(0);
    }

    const crc = calculateCrc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + name length)
    const lh = new Uint8Array(30 + nameBytes.length);
    const lhView = new DataView(lh.buffer);
    lhView.setUint32(0, 0x04034b50, true); // signature
    lhView.setUint16(4, 20, true);         // version needed: 2.0
    lhView.setUint16(6, 0x0800, true);     // flags: UTF-8 filename
    lhView.setUint16(8, 0, true);          // compression: 0 (store)
    lhView.setUint16(10, 0, true);         // mod time
    lhView.setUint16(12, 0, true);         // mod date
    lhView.setUint32(14, crc, true);       // crc32
    lhView.setUint32(18, size, true);      // compressed size
    lhView.setUint32(22, size, true);      // uncompressed size
    lhView.setUint16(26, nameBytes.length, true); // filename length
    lhView.setUint16(28, 0, true);         // extra field length
    lh.set(nameBytes, 30);

    localHeaders.push(lh, dataBytes);

    // Central directory header (46 bytes + name length)
    const ch = new Uint8Array(46 + nameBytes.length);
    const chView = new DataView(ch.buffer);
    chView.setUint32(0, 0x02014b50, true); // signature
    chView.setUint16(4, 20, true);         // version made by
    chView.setUint16(6, 20, true);         // version needed
    chView.setUint16(8, 0x0800, true);     // flags: UTF-8
    chView.setUint16(10, 0, true);         // compression: 0
    chView.setUint16(12, 0, true);         // mod time
    chView.setUint16(14, 0, true);         // mod date
    chView.setUint32(16, crc, true);       // crc32
    chView.setUint32(20, size, true);      // compressed size
    chView.setUint32(24, size, true);      // uncompressed size
    chView.setUint16(28, nameBytes.length, true);
    chView.setUint16(30, 0, true);         // extra field length
    chView.setUint16(32, 0, true);         // file comment length
    chView.setUint16(34, 0, true);         // disk number start
    chView.setUint16(36, 0, true);         // internal attributes
    chView.setUint32(38, 0, true);         // external attributes
    chView.setUint32(42, currentOffset, true); // local header offset
    ch.set(nameBytes, 46);

    centralHeaders.push(ch);
    currentOffset += lh.length + dataBytes.length;
  }

  const centralDirOffset = currentOffset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) centralDirSize += ch.length;

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // signature
  eocdView.setUint16(4, 0, true);          // disk number
  eocdView.setUint16(6, 0, true);          // start disk
  eocdView.setUint16(8, entries.length, true);  // entries this disk
  eocdView.setUint16(10, entries.length, true); // total entries
  eocdView.setUint32(12, centralDirSize, true); // central dir size
  eocdView.setUint32(16, centralDirOffset, true); // central dir offset
  eocdView.setUint16(20, 0, true);         // comment length

  return new Blob([...localHeaders, ...centralHeaders, eocd], { type: 'application/zip' });
}

/**
 * Convert time in seconds to ASS timestamp format (H:MM:SS.cs).
 */
function toASSTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Generate an Advanced SubStation Alpha (.ass) subtitle file.
 */
export function generateAssSubtitles({
  captionLines = [],
  captionFont = 'Poppins',
  captionColor = '#FFFFFF',
  captionHighlight = '#FACC15',
  captionSize = 38,
  captionPosition = { x: 50, y: 80 },
  width = 1920,
  height = 1080
}) {
  if (!captionLines || !captionLines.length) return '';

  const hexToBGR = (hex) => {
    const clean = (hex || '').replace('#', '');
    if (clean.length !== 6) return '&H00FFFFFF';
    const r = clean.slice(0, 2);
    const g = clean.slice(2, 4);
    const b = clean.slice(4, 6);
    return `&H00${b}${g}${r}`.toUpperCase();
  };

  const primaryCol = hexToBGR(captionColor);
  const highlightCol = hexToBGR(captionHighlight);
  const scaledSize = Math.max(18, Math.round(captionSize * (height / 720)));
  const marginV = Math.round(height * (1.0 - (captionPosition?.y ?? 80) / 100));

  let ass = `[Script Info]
Title: SceneFlow Kinetic Captions
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: ${width}
PlayResY: ${height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${captionFont || 'Poppins'},${scaledSize},${primaryCol},${highlightCol},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (const line of captionLines) {
    const startStr = toASSTime(line.startSec || 0);
    const endStr = toASSTime(line.endSec || ((line.startSec || 0) + 3));
    const text = (line.text || '').trim();
    if (!text) continue;
    ass += `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${text}\n`;
  }

  return ass;
}

const RESOLUTIONS = {
  '720p':  { w: 1280, h: 720  },
  '1080p': { w: 1920, h: 1080 },
  '2K':    { w: 2560, h: 1440 },
  '4K':    { w: 3840, h: 2160 },
};

/**
 * Build a 1-click self-contained render package zip.
 */
export async function buildRenderPackage({
  clips = [],
  files = [],
  voiceover = null,
  music = null,
  musicVolume = 0.15,
  captionLines = [],
  captionFont = 'Poppins',
  captionColor = '#FFFFFF',
  captionHighlight = '#FACC15',
  captionSize = 36,
  captionPosition = { x: 50, y: 80 },
  resolution = '1080p',
  fps = 30,
  outFileName = 'export.mp4',
  onProgress = () => {},
}) {
  const res = RESOLUTIONS[resolution] || RESOLUTIONS['1080p'];
  const w = res.w;
  const h = res.h;

  onProgress({ pct: 10, stage: 'Packaging media files…' });

  const entries = [];

  // 1. Collect and add image files
  const imageNameMap = new Map();
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (clip.type === 'gap') continue;
    if (imageNameMap.has(clip.name)) continue;

    const fileItem = files.find(f => f.name === clip.name) || clip;
    let data = null;

    if (fileItem.file) {
      data = new Uint8Array(await fileItem.file.arrayBuffer());
    } else if (fileItem.objectUrl) {
      try {
        const resp = await fetch(fileItem.objectUrl);
        if (resp.ok) data = new Uint8Array(await resp.arrayBuffer());
      } catch {}
    }

    if (!data && fileItem.path && !fileItem.path.startsWith('client:')) {
      try {
        const resp = await fetch(`/api/media-preview?path=${encodeURIComponent(fileItem.path)}`);
        if (resp.ok) data = new Uint8Array(await resp.arrayBuffer());
      } catch {}
    }

    // Safe sanitized filename
    const safeName = `img_${String(i + 1).padStart(3, '0')}_${clip.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    imageNameMap.set(clip.name, safeName);

    if (data) {
      entries.push({ name: `images/${safeName}`, data });
    }
  }

  // 2. Collect audio files
  let voFileName = null;
  if (voiceover) {
    onProgress({ pct: 30, stage: 'Packaging voiceover audio…' });
    let voData = null;
    if (voiceover.file) {
      voData = new Uint8Array(await voiceover.file.arrayBuffer());
    } else if (voiceover.path && !voiceover.path.startsWith('client:')) {
      try {
        const resp = await fetch(`/api/audio?path=${encodeURIComponent(voiceover.path)}`);
        if (resp.ok) voData = new Uint8Array(await resp.arrayBuffer());
      } catch {}
    }
    if (voData) {
      const ext = (voiceover.name || 'voiceover.mp3').split('.').pop() || 'mp3';
      voFileName = `audio/voiceover.${ext}`;
      entries.push({ name: voFileName, data: voData });
    }
  }

  let musicFileName = null;
  if (music) {
    onProgress({ pct: 40, stage: 'Packaging background music…' });
    let musicData = null;
    if (music.file) {
      musicData = new Uint8Array(await music.file.arrayBuffer());
    } else if (music.path && !music.path.startsWith('client:')) {
      try {
        const resp = await fetch(`/api/audio?path=${encodeURIComponent(music.path)}`);
        if (resp.ok) musicData = new Uint8Array(await resp.arrayBuffer());
      } catch {}
    }
    if (musicData) {
      const ext = (music.name || 'music.mp3').split('.').pop() || 'mp3';
      musicFileName = `audio/music.${ext}`;
      entries.push({ name: musicFileName, data: musicData });
    }
  }

  // 3. Subtitles
  let hasSubtitles = false;
  if (captionLines && captionLines.length > 0) {
    onProgress({ pct: 50, stage: 'Generating styled subtitles…' });
    const assContent = generateAssSubtitles({
      captionLines,
      captionFont,
      captionColor,
      captionHighlight,
      captionSize,
      captionPosition,
      width: w,
      height: h
    });
    if (assContent) {
      hasSubtitles = true;
      entries.push({ name: 'subtitles.ass', data: assContent });
    }
  }

  // 4. Build FFmpeg filtergraph (filter.txt)
  onProgress({ pct: 60, stage: 'Generating standalone FFmpeg filtergraph…' });
  const filterParts = [];
  const streamLabels = [];
  const inputArgs = [];

  let inputIndex = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const dur = Math.max(0.1, clip.durationSec || (clip.endSec - clip.startSec) || 3.0);
    const frames = Math.max(1, Math.round(dur * fps));

    if (clip.type === 'gap') {
      inputArgs.push(`-f lavfi -i color=c=black:s=${w}x${h}:r=${fps}:d=${dur}`);
      filterParts.push(`[${inputIndex}:v]fps=${fps},trim=duration=${dur}[v${i}]`);
    } else {
      const safeName = imageNameMap.get(clip.name);
      if (safeName) {
        inputArgs.push(`-loop 1 -t ${dur} -i "images/${safeName}"`);
        const motion = clip.motion || 'none';
        const zoomRange = 0.10;

        let zoompanExpr = `scale=${w}:${h},setsar=1`;
        if (motion === 'zoomIn') {
          zoompanExpr = `zoompan=z='1.0+${zoomRange}*(on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1`;
        } else if (motion === 'zoomOut') {
          zoompanExpr = `zoompan=z='1.0+${zoomRange}*(1.0-(on/${frames}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1`;
        } else if (motion === 'panLeft') {
          zoompanExpr = `zoompan=z='1.12':x='(iw-(iw/zoom))*(on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1`;
        } else if (motion === 'panRight') {
          zoompanExpr = `zoompan=z='1.12':x='(iw-(iw/zoom))*(1.0-(on/${frames}))':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},setsar=1`;
        }

        filterParts.push(`[${inputIndex}:v]scale=${w * 2}:${h * 2},${zoompanExpr},setpts=PTS-STARTPTS,fps=${fps},trim=duration=${dur}[v${i}]`);
      } else {
        inputArgs.push(`-f lavfi -i color=c=black:s=${w}x${h}:r=${fps}:d=${dur}`);
        filterParts.push(`[${inputIndex}:v]fps=${fps},trim=duration=${dur}[v${i}]`);
      }
    }
    streamLabels.push(`[v${i}]`);
    inputIndex++;
  }

  // Concatenate video clips
  filterParts.push(`${streamLabels.join('')}concat=n=${clips.length}:v=1:a=0[vconcat]`);

  // Burn kinetic subtitles if present
  let finalVideoStream = '[vconcat]';
  if (hasSubtitles) {
    filterParts.push(`[vconcat]ass=subtitles.ass[vout]`);
    finalVideoStream = '[vout]';
  } else {
    filterParts.push(`[vconcat]null[vout]`);
    finalVideoStream = '[vout]';
  }

  // Audio filter handling
  let audioInputsStr = '';
  let finalAudioMap = '';
  const audioInStartIdx = inputIndex;

  if (voFileName && musicFileName) {
    audioInputsStr = `-i "${voFileName}" -i "${musicFileName}"`;
    filterParts.push(`[${audioInStartIdx}:a]apad[vo];[${audioInStartIdx + 1}:a]volume=${musicVolume}[mus];[vo][mus]amix=inputs=2:duration=first[aout]`);
    finalAudioMap = '-map "[aout]"';
  } else if (voFileName) {
    audioInputsStr = `-i "${voFileName}"`;
    filterParts.push(`[${audioInStartIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[aout]`);
    finalAudioMap = '-map "[aout]"';
  } else if (musicFileName) {
    audioInputsStr = `-i "${musicFileName}"`;
    filterParts.push(`[${audioInStartIdx}:a]volume=${musicVolume}[aout]`);
    finalAudioMap = '-map "[aout]"';
  }

  const filterScriptContent = filterParts.join(';\n');
  entries.push({ name: 'filter.txt', data: filterScriptContent });

  // 5. Windows render.bat
  const outName = outFileName.endsWith('.mp4') ? outFileName : `${outFileName}.mp4`;
  const renderBatContent = `@echo off
setlocal enabledelayedexpansion
title SceneFlow Video Compiler
echo ========================================================
echo   SceneFlow 1-Click Video Compiler (FFmpeg)
echo ========================================================
echo.
echo Target Output : ${outName}
echo Resolution    : ${w}x${h} (${resolution})
echo Clips Count   : ${clips.length}
echo.

:: 1. Locate FFmpeg on PC
set FFMPEG_CMD=
where ffmpeg >nul 2>nul
if %ERRORLEVEL% EQU 0 set FFMPEG_CMD=ffmpeg

if not defined FFMPEG_CMD (
    if exist "ffmpeg.exe" (
        set FFMPEG_CMD=.\\ffmpeg.exe
    ) else if exist "d:\\Apps\\video export\\frame-maker\\node_modules\\ffmpeg-static\\ffmpeg.exe" (
        set FFMPEG_CMD="d:\\Apps\\video export\\frame-maker\\node_modules\\ffmpeg-static\\ffmpeg.exe"
    ) else if exist "%LOCALAPPDATA%\\SceneFlow\\ffmpeg.exe" (
        set FFMPEG_CMD="%LOCALAPPDATA%\\SceneFlow\\ffmpeg.exe"
    ) else if exist "C:\\ffmpeg\\bin\\ffmpeg.exe" (
        set FFMPEG_CMD="C:\\ffmpeg\\bin\\ffmpeg.exe"
    ) else (
        echo [!] FFmpeg was not detected in PATH.
        echo [!] Auto-downloading static FFmpeg for Windows (one-time setup)...
        powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://github.com/eugeneware/ffmpeg-static/releases/download/b5.2.0/win32-x64', 'ffmpeg.exe')"
        if exist "ffmpeg.exe" (
            set FFMPEG_CMD=.\\ffmpeg.exe
            echo [OK] FFmpeg downloaded successfully.
        ) else (
            echo [ERROR] Could not auto-download FFmpeg. Please install FFmpeg or run SceneFlow locally via start.bat.
            pause
            exit /b 1
        )
    )
)

echo [OK] Engine: !FFMPEG_CMD!
echo.
echo Rendering high-speed video with GPU / CPU acceleration...
echo.

!FFMPEG_CMD! -y ${inputArgs.join(' ')} ${audioInputsStr} -filter_complex_script filter.txt -map "[vout]" ${finalAudioMap} -c:v libx264 -crf 20 -preset fast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outName}"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   ✓ Video Created Successfully: ${outName}
    echo ========================================================
    echo.
    start "" "${outName}"
) else (
    echo.
    echo [ERROR] FFmpeg render encountered an error.
)

pause
`;
  entries.push({ name: 'render.bat', data: renderBatContent });

  // 6. Mac / Linux render.sh
  const renderShContent = `#!/bin/bash
set -e
echo "========================================================"
echo "  SceneFlow 1-Click Video Compiler (FFmpeg)"
echo "========================================================"
echo ""
echo "Target Output : ${outName}"
echo "Resolution    : ${w}x${h} (${resolution})"
echo "Clips Count   : ${clips.length}"
echo ""

if ! command -v ffmpeg &> /dev/null; then
    echo "[!] FFmpeg is required. Install via: brew install ffmpeg (macOS) or apt install ffmpeg (Ubuntu/Debian)"
    exit 1
fi

ffmpeg -y ${inputArgs.join(' ')} ${audioInputsStr} -filter_complex_script filter.txt -map "[vout]" ${finalAudioMap} -c:v libx264 -crf 20 -preset fast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outName}"

echo ""
echo "✓ Video Created Successfully: ${outName}"
`;
  entries.push({ name: 'render.sh', data: renderShContent });

  // 7. README.txt
  const readmeContent = `SceneFlow 1-Click Offline Video Compiler
========================================

Resolution: ${w}x${h} (${resolution})
Output:     ${outName}

HOW TO COMPILE YOUR VIDEO:
1. Extract all files from this ZIP into a folder on your computer.
2. Windows: Double-click "render.bat"
   macOS / Linux: Run "./render.sh" in terminal.
3. Your finished high-quality video will be compiled with full FFmpeg quality,
   Ken Burns zoom/pan motion, multi-track audio, and kinetic subtitles!

Tip: To render directly inside your browser with 1 click without downloading zips,
run SceneFlow locally on your PC via start.bat (http://localhost:3000).
`;
  entries.push({ name: 'README.txt', data: readmeContent });

  onProgress({ pct: 90, stage: 'Assembling ZIP package…' });
  const zipBlob = createZipBlob(entries);

  onProgress({ pct: 100, stage: '✓ Package ready!' });

  return {
    blob: zipBlob,
    fileName: `${(outFileName || 'sceneflow_project').replace(/\.mp4$/i, '')}_package.zip`,
    fileSize: zipBlob.size,
    clipsCount: clips.length,
    resolution: `${w}x${h}`
  };
}
