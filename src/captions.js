/**
 * captions.js — Generate .ASS subtitle file from timed words + style config.
 *
 * Supports styles: none, simple, bold, highlight, karaoke, box, neon, tiktok,
 * outline, cinema, pop, bar, typewriter, bounce, underline, glow
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ASS timestamp: H:MM:SS.cs (centiseconds)
function toASSTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec % 1) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

/**
 * Parse timestamped caption text into an array of lines.
 * Input format: "(0:03) Some words here\n(0:07) More words"
 * Returns: [{ startSec, endSec, duration, timeSec, text }]
 */
function parseCaptionText(raw) {
  const lines = [];
  const lineRe = /\((\d+):(\d+)(?::(\d+))?\)\s*(.+)/g;
  let m;
  while ((m = lineRe.exec(raw)) !== null) {
    const [, a, b, c, text] = m;
    const timeSec = c !== undefined
      ? parseInt(a) * 3600 + parseInt(b) * 60 + parseInt(c)
      : parseInt(a) * 60 + parseInt(b);
    lines.push({ startSec: timeSec, timeSec, text: text.trim() });
  }

  // Calculate clean non-overlapping endSec for each line
  for (let i = 0; i < lines.length; i++) {
    const nextStart = (i + 1 < lines.length) ? lines[i + 1].startSec : lines[i].startSec + 3.5;
    lines[i].endSec = nextStart;
    lines[i].duration = Math.max(0.1, nextStart - lines[i].startSec);
  }

  return lines;
}

/**
 * Spread words evenly across each line's exact time range.
 * Returns [{ word, startSec, endSec, lineIndex, lineStart, lineEnd, lineText }]
 */
function spreadWords(lines) {
  const words = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const duration = line.duration || Math.max(0.1, line.endSec - line.startSec);
    const ws = line.text.split(/\s+/).filter(Boolean);
    const wordDur = duration / ws.length;
    ws.forEach((word, j) => {
      words.push({
        word,
        startSec: line.startSec + j * wordDur,
        endSec: line.startSec + (j + 1) * wordDur,
        lineIndex: i,
        lineStart: line.startSec,
        lineEnd: line.endSec,
        lineText: line.text,
      });
    });
  }
  return words;
}

/**
 * Build ASS style block based on chosen style name and options.
 */
/**
 * Build ASS style block based on chosen style name and options.
 */
function hexToAss(hex, fallback = '&H00FFFFFF') {
  const clean = String(hex || '').trim().replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `&H00${clean.substring(4, 6)}${clean.substring(2, 4)}${clean.substring(0, 2)}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    const r = clean[0] + clean[0];
    const g = clean[1] + clean[1];
    const b = clean[2] + clean[2];
    return `&H00${b}${g}${r}`.toUpperCase();
  }
  return fallback;
}

function buildASSStyle(style, color, size, position, videoWidth = 1920, videoHeight = 1080, font = null) {
  const assWhite = '&H00FFFFFF';
  const assColor = hexToAss(color, assWhite);
  const assBlack = '&H00000000';
  const assYellow = '&H0000FFFF';

  // Calculate proportional font size to match web preview visual scale
  // At videoHeight=1080, slider size 48px maps to ~86px (matching Remotion's 82px base)
  const fontScale = (videoHeight || 1080) / 600;
  const scaledSize = Math.max(28, Math.round((size || 48) * fontScale));

  // Calculate vertical margin from bottom: position.y is % from top (default 80 = 20% from bottom)
  const bottomPct = Math.max(0.04, Math.min(0.92, (100 - (position?.y ?? 80)) / 100));
  const marginV = Math.round(bottomPct * (videoHeight || 1080));

  const styleMap = {
    none: null,
    simple: {
      Fontsize: scaledSize, PrimaryColour: assColor, OutlineColour: assBlack,
      Outline: 2, Shadow: 1.5, Bold: 0, Italic: 0, Alignment: 2,
      MarginV: marginV,
    },
    bold: {
      Fontname: 'Poppins', Fontsize: scaledSize,
      PrimaryColour: assColor, SecondaryColour: assColor,
      OutlineColour: assBlack, Outline: 4, Shadow: 2.5, Bold: -1, Italic: 0, Alignment: 2,
      MarginV: marginV,
    },
    'bold-highlight': {
      Fontname: 'Poppins', Fontsize: scaledSize,
      PrimaryColour: assColor, SecondaryColour: assYellow,
      OutlineColour: assBlack, Outline: 4, Shadow: 2.5, Bold: -1, Italic: 0, Alignment: 2,
      MarginV: marginV,
    },
    'poppin-clean': {
      Fontname: 'Poppins', Fontsize: scaledSize,
      PrimaryColour: assColor, SecondaryColour: assColor,
      OutlineColour: assBlack, Outline: 4, Shadow: 2.5, Bold: -1, Italic: 0, Alignment: 2,
      MarginV: marginV,
    },
    poppin: {
      Fontname: 'Poppins', Fontsize: scaledSize,
      PrimaryColour: assColor, SecondaryColour: assYellow,
      OutlineColour: assBlack, Outline: 4, Shadow: 2.5, Bold: -1, Italic: 0, Alignment: 2,
      MarginV: marginV,
    },
    beast: {
      Fontname: 'Montserrat', Fontsize: Math.round(scaledSize * 1.1),
      PrimaryColour: assColor, SecondaryColour: assYellow,
      OutlineColour: assBlack, Outline: 4.5, Shadow: 3.5, Bold: -1, Italic: -1, Alignment: 2,
      MarginV: marginV,
    },
    mrbeast: {
      Fontname: 'Montserrat', Fontsize: Math.round(scaledSize * 1.1),
      PrimaryColour: assColor, SecondaryColour: assYellow,
      OutlineColour: assBlack, Outline: 4.5, Shadow: 3.5, Bold: -1, Italic: -1, Alignment: 2,
      MarginV: marginV,
    },
    hustle: {
      Fontname: 'Montserrat', Fontsize: Math.round(scaledSize * 1.05),
      PrimaryColour: assColor, SecondaryColour: '&H0066FF00',
      OutlineColour: assBlack, Outline: 4, Shadow: 2.5, Bold: -1, Italic: -1, Alignment: 2,
      MarginV: marginV,
    },
    pupcaps: {
      Fontname: 'Inter', Fontsize: scaledSize,
      PrimaryColour: assColor, SecondaryColour: assYellow,
      OutlineColour: assBlack, Outline: 4, Shadow: 2.5, Bold: -1, Italic: 0, Alignment: 2,
      MarginV: marginV,
    },
    podcast: {
      Fontname: 'Inter', Fontsize: Math.round(scaledSize * 0.95),
      PrimaryColour: assColor, SecondaryColour: '&H0076E600',
      OutlineColour: assBlack, Outline: 3.5, Shadow: 2, Bold: -1, Italic: 0, Alignment: 2,
      MarginV: marginV,
    },
    aarit: {
      Fontname: 'Poppins', Fontsize: scaledSize,
      PrimaryColour: assColor, SecondaryColour: '&H001673F9',
      OutlineColour: assBlack, Outline: 4, Shadow: 2.5, Bold: -1, Italic: 0, Alignment: 2,
      MarginV: marginV,
    },
    'simple-one-word': {
      Fontname: 'Outfit', Fontsize: Math.round(scaledSize * 1.25),
      PrimaryColour: assColor, SecondaryColour: assYellow,
      OutlineColour: assBlack, Outline: 5, Shadow: 3.5, Bold: -1, Italic: 0, Alignment: 2,
      MarginV: marginV,
    },
    'gaming-stream': {
      Fontname: 'Montserrat', Fontsize: scaledSize,
      PrimaryColour: color ? assColor : '&H00FF00FF', SecondaryColour: '&H00FFFF00',
      OutlineColour: assBlack, Outline: 4, Shadow: 2.5, Bold: -1, Italic: 0, Alignment: 2,
      MarginV: marginV,
    },
    bar: {
      Fontsize: scaledSize, PrimaryColour: assWhite, BackColour: assColor,
      OutlineColour: assColor, BorderStyle: 4, Outline: 0, Shadow: 0,
      Bold: 0, Alignment: 2, MarginV: 0,
    },
    typewriter: {
      Fontsize: scaledSize, PrimaryColour: assColor, OutlineColour: assBlack,
      Outline: 2, Shadow: 1, Bold: 0, Alignment: 2,
      MarginV: marginV,
    },
    bounce: {
      Fontsize: scaledSize, PrimaryColour: assColor, OutlineColour: assBlack,
      Outline: 3, Shadow: 1.5, Bold: -1, Alignment: 2,
      MarginV: marginV,
    },
    underline: {
      Fontsize: scaledSize, PrimaryColour: assColor, OutlineColour: assBlack,
      Outline: 2, Shadow: 1, Underline: -1, Bold: 0, Alignment: 2,
      MarginV: marginV,
    },
    glow: {
      Fontsize: scaledSize, PrimaryColour: assColor, OutlineColour: assColor,
      Outline: 6, Shadow: 0, Bold: 0, Alignment: 2,
      MarginV: marginV,
    },
  };

  if (style === 'none') return null;
  const selectedStyle = { ...(styleMap[style] || styleMap.simple) };
  if (font && String(font).trim()) {
    selectedStyle.Fontname = String(font).trim();
  }
  return selectedStyle;
}

function chunkWords(words, option = 'all') {
  if (!words || !words.length) return [];
  if (option === 'all') return [words];

  if (option === '3-4') {
    const n = words.length;
    if (n <= 4) return [words];
    const numChunks = Math.ceil(n / 4);
    const baseSize = Math.floor(n / numChunks);
    const remainder = n % numChunks;
    const chunks = [];
    let start = 0;
    for (let c = 0; c < numChunks; c++) {
      const size = baseSize + (c < remainder ? 1 : 0);
      chunks.push(words.slice(start, start + size));
      start += size;
    }
    return chunks;
  }

  const chunkSize = parseInt(option, 10);
  if (!chunkSize || isNaN(chunkSize) || chunkSize <= 0) return [words];

  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Generate full .ASS file content from timed words.
 * Honors each script line's exact timestamp range, showing words chunked per line!
 */
function generateASS(words, options = {}) {
  const {
    style = 'bold',
    color = '#FFFFFF',
    highlightColor = null,
    font = null,
    size = 48,
    position = { x: 50, y: 80 },
    videoWidth = 1920,
    videoHeight = 1080,
    wordsPerLine = 'all',
  } = options;

  if (style === 'none' || !words.length) return null;

  const s = buildASSStyle(style, color, size, position, videoWidth, videoHeight, font);
  if (!s) return null;

  const fontname = s.Fontname || 'Poppins';
  const marginV = s.MarginV ?? 216;
  const bold = s.Bold ?? -1;
  const italic = s.Italic ?? 0;
  const underline = s.Underline ?? 0;
  const outline = s.Outline ?? 4;
  const shadow = s.Shadow ?? 2.5;
  const borderStyle = s.BorderStyle ?? 1;
  const alignment = s.Alignment ?? 2;
  const primaryColour = s.PrimaryColour ?? '&H00FFFFFF';
  const secondaryColour = s.SecondaryColour ?? '&H0000FFFF';
  const outlineColour = s.OutlineColour ?? '&H00000000';
  const backColour = s.BackColour ?? '&H00000000';
  const fontsize = s.Fontsize ?? size;

  // Group words strictly by user script line (using lineIndex / lineStart)
  const scriptLines = [];
  for (const w of words) {
    const lIdx = (w.lineIndex !== undefined) ? w.lineIndex : 0;
    if (!scriptLines[lIdx]) {
      scriptLines[lIdx] = {
        startSec: w.lineStart !== undefined ? w.lineStart : w.startSec,
        endSec: w.lineEnd !== undefined ? w.lineEnd : w.endSec,
        text: w.lineText || '',
        words: []
      };
    }
    scriptLines[lIdx].words.push(w);
    scriptLines[lIdx].endSec = Math.max(scriptLines[lIdx].endSec, w.endSec);
  }

  const validLines = scriptLines.filter(Boolean);

  let dialogues = '';

  const STYLE_HIGHLIGHTS = {
    'bold-highlight': { color: '&H0000FFFF', scale: 100 },
    'poppin': { color: '&H0000FFFF', scale: 100 },
    'beast': { color: '&H0000FFFF', scale: 108 },
    'mrbeast': { color: '&H0000FFFF', scale: 108 },
    'hustle': { color: '&H0066FF00', scale: 105 },
    'pupcaps': { color: '&H0000FFFF', scale: 100 },
    'podcast': { color: '&H0076E600', scale: 100 },
    'aarit': { color: '&H00F97316', scale: 105 },
    'gaming-stream': { color: '&H00FF00FF', scale: 100 },
    'karaoke': { color: '&H0000FFFF', scale: 100 },
    'highlight': { color: '&H0000FFFF', scale: 100 },
  };

  const uppercaseStyles = [
    'bold', 'bold-highlight', 'poppin', 'poppin-clean',
    'beast', 'mrbeast', 'hustle', 'simple-one-word',
    'aarit', 'gaming-stream', 'tiktok', 'hormozi'
  ];

  if (style === 'simple-one-word') {
    for (const line of validLines) {
      for (const w of line.words) {
        dialogues += `Dialogue: 0,${toASSTime(w.startSec)},${toASSTime(w.endSec)},Default,,0,0,0,,${w.word.toUpperCase()}\n`;
      }
    }
  } else if (style === 'bold' || style === 'poppin-clean') {
    for (const line of validLines) {
      const chunks = chunkWords(line.words, wordsPerLine);
      for (const chunk of chunks) {
        if (!chunk.length) continue;
        const chunkStart = chunk[0].startSec;
        const chunkEnd = chunk[chunk.length - 1].endSec;
        const chunkText = chunk.map(w => w.word.toUpperCase()).join(' ');
        dialogues += `Dialogue: 0,${toASSTime(chunkStart)},${toASSTime(chunkEnd)},Default,,0,0,0,,${chunkText}\n`;
      }
    }
  } else if (STYLE_HIGHLIGHTS[style]) {
    // Discrete active-word highlight matching modern Shorts/Reels Remotion themes!
    const activeCfg = STYLE_HIGHLIGHTS[style];
    const userHighlightAss = highlightColor ? hexToAss(highlightColor, null) : null;
    const activeColor = userHighlightAss || activeCfg.color;
    const isUppercase = uppercaseStyles.includes(style);
    const scale = activeCfg.scale || 100;
    const scaleTag = (scale !== 100) ? `\\fscx${scale}\\fscy${scale}` : '';
    const resetScaleTag = (scale !== 100) ? '\\fscx100\\fscy100' : '';

    for (const line of validLines) {
      const chunks = chunkWords(line.words, wordsPerLine);
      for (const chunk of chunks) {
        if (!chunk.length) continue;
        const chunkStart = chunk[0].startSec;
        const chunkEnd = chunk[chunk.length - 1].endSec;

        for (let i = 0; i < chunk.length; i++) {
          const wActive = chunk[i];
          const wStart = (i === 0) ? chunkStart : wActive.startSec;
          const wEnd = (i === chunk.length - 1) ? chunkEnd : wActive.endSec;
          if (wEnd <= wStart) continue;

          const textParts = chunk.map((w, j) => {
            const wordText = isUppercase ? w.word.toUpperCase() : w.word;
            if (j === i) {
              return `{\\c${activeColor}&${scaleTag}}${wordText}{\\c${primaryColour}&${resetScaleTag}}`;
            }
            return wordText;
          });

          dialogues += `Dialogue: 0,${toASSTime(wStart)},${toASSTime(wEnd)},Default,,0,0,0,,${textParts.join(' ')}\n`;
        }
      }
    }
  } else {
    // Plain styles fallback
    for (const line of validLines) {
      const chunks = chunkWords(line.words, wordsPerLine);
      for (const chunk of chunks) {
        if (!chunk.length) continue;
        const chunkStart = chunk[0].startSec;
        const chunkEnd = chunk[chunk.length - 1].endSec;
        const chunkText = chunk.map(w => uppercaseStyles.includes(style) ? w.word.toUpperCase() : w.word).join(' ');
        dialogues += `Dialogue: 0,${toASSTime(chunkStart)},${toASSTime(chunkEnd)},Default,,0,0,0,,${chunkText}\n`;
      }
    }
  }

  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontname},${fontsize},${primaryColour},${secondaryColour},${outlineColour},${backColour},${bold},${italic},${underline},0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogues}`;

  return ass;
}

/**
 * Write ASS file to disk and return path.
 */
function writeASSFile(words, options, outputDir) {
  const content = generateASS(words, options);
  if (!content) return null;
  const filePath = path.join(outputDir, `captions_${Date.now()}.ass`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

module.exports = { parseCaptionText, spreadWords, chunkWords, generateASS, writeASSFile, toASSTime };
