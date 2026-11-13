'use strict';

/**
 * timing.js — SceneFlow Transcription & Timed Splitting Engine
 * 
 * Splits word-level timed transcripts into timed blocks for video generation.
 * Supports:
 *   - 3s fixed grid
 *   - 5s fixed grid
 *   - Full sentences (punctuation + pauses, min/max length constraints, smart splitting/merging)
 *   - Custom ranges with rule lists and fallback modes
 *   - Em-dash filename generation (0_00—0_03.png, 1_02_30—1_02_33.png)
 *   - Caption text formatting ((0:03) caption text)
 *   - Multiple export generators (captions.txt, srt, filenames.txt, csv, words json, blocks json)
 */

/**
 * Format seconds into filename time token:
 * 0 -> "0_00"
 * 3 -> "0_03"
 * 62 -> "1_02"
 * 3750 -> "1_02_30"
 */
function formatTimeFilename(sec) {
  const sTotal = Math.max(0, Math.floor(sec));
  const h = Math.floor(sTotal / 3600);
  const m = Math.floor((sTotal % 3600) / 60);
  const s = sTotal % 60;
  if (h > 0) {
    return `${h}_${String(m).padStart(2, '0')}_${String(s).padStart(2, '0')}`;
  }
  return `${m}_${String(s).padStart(2, '0')}`;
}

/**
 * Format seconds into caption timestamp:
 * 0 -> "(0:00)"
 * 3 -> "(0:03)"
 * 65 -> "(1:05)"
 * 750 -> "(12:30)"
 * 3750 -> "(1:02:30)"
 */
function formatCaptionTime(sec) {
  const sTotal = Math.max(0, Math.floor(sec));
  const h = Math.floor(sTotal / 3600);
  const m = Math.floor((sTotal % 3600) / 60);
  const s = sTotal % 60;
  if (h > 0) {
    return `(${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')})`;
  }
  return `(${m}:${String(s).padStart(2, '0')})`;
}

/**
 * Parse time string (m:ss, mm:ss, h:mm:ss, or integer seconds) to seconds
 */
function parseTimeString(val) {
  if (typeof val === 'number') return Math.max(0, val);
  if (!val || typeof val !== 'string') return 0;
  const s = val.trim().replace(/[()\[\]]/g, '');
  if (!s) return 0;
  if (s.toLowerCase() === 'end') return Infinity;
  const parts = s.split(':').map(p => parseFloat(p));
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  if (parts.length === 1) return Math.round(parts[0]);
  return 0;
}

/**
 * Generate standard image filename with em-dash
 */
function getBlockFilename(startSec, endSec) {
  return `${formatTimeFilename(startSec)}—${formatTimeFilename(endSec)}.png`;
}

/**
 * Parse SRT text into word objects
 */
function parseSRTToWords(srtText) {
  if (!srtText) return [];
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\s*\n/);
  const words = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    
    // Find timecode line (00:00:01,000 --> 00:00:04,500)
    let timeIndex = 0;
    if (/^\d+$/.test(lines[0].trim())) timeIndex = 1;
    if (!lines[timeIndex] || !lines[timeIndex].includes('-->')) continue;

    const [startStr, endStr] = lines[timeIndex].split('-->').map(s => s.trim());
    const parseTimecode = (t) => {
      const [hms, ms] = t.replace(',', '.').split('.');
      const [h, m, s] = hms.split(':').map(Number);
      return h * 3600 + m * 60 + s + (parseFloat('0.' + (ms || '0')) || 0);
    };

    const cueStart = parseTimecode(startStr);
    const cueEnd = parseTimecode(endStr);
    const textLines = lines.slice(timeIndex + 1).join(' ').trim();
    if (!textLines) continue;

    // Split cue into words and distribute timing evenly
    const rawTokens = textLines.split(/\s+/).filter(Boolean);
    if (!rawTokens.length) continue;
    const duration = Math.max(0.2, cueEnd - cueStart);
    const wordDuration = duration / rawTokens.length;

    rawTokens.forEach((token, idx) => {
      words.push({
        word: token,
        start: cueStart + idx * wordDuration,
        end: cueStart + (idx + 1) * wordDuration,
        probability: 1.0
      });
    });
  }

  return words;
}

/**
 * Parse timestamped script with (m:ss) timestamps into word objects
 */
function parseScriptWithTimestampsToWords(scriptText, fallbackDuration = 0) {
  if (!scriptText) return [];
  const lines = scriptText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const timeRegex = /\((\d+):(\d{2})(?::(\d{2}))?\)/;
  const sections = [];

  for (const line of lines) {
    const m = line.match(timeRegex);
    if (m) {
      let sec = 0;
      if (m[3] !== undefined) {
        sec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
      } else {
        sec = parseInt(m[1]) * 60 + parseInt(m[2]);
      }
      const text = line.replace(timeRegex, '').trim();
      sections.push({ time: sec, text });
    } else if (sections.length > 0) {
      // Append text to previous section
      sections[sections.length - 1].text += ' ' + line;
    }
  }

  if (!sections.length) return [];
  sections.sort((a, b) => a.time - b.time);

  const words = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const nextTime = (i < sections.length - 1) ? sections[i + 1].time : (fallbackDuration || (sec.time + 5));
    const duration = Math.max(0.5, nextTime - sec.time);
    const rawTokens = sec.text.split(/\s+/).filter(Boolean);
    if (!rawTokens.length) continue;
    const wordDur = duration / rawTokens.length;

    rawTokens.forEach((w, idx) => {
      words.push({
        word: w,
        start: sec.time + idx * wordDur,
        end: sec.time + (idx + 1) * wordDur,
        probability: 1.0
      });
    });
  }

  return words;
}

/**
 * Validate custom range rules.
 * Checks for overlaps, negative ranges, and invalid boundaries.
 */
function validateRules(rules, audioDuration) {
  if (!Array.isArray(rules) || !rules.length) return { valid: true, errors: [] };
  const errors = [];
  const parsed = [];

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const from = parseTimeString(r.from);
    let to = r.to === 'end' ? (audioDuration || Infinity) : parseTimeString(r.to);
    if (to === Infinity && audioDuration) to = audioDuration;

    if (isNaN(from) || isNaN(to)) {
      errors.push({ index: i, message: `Rule #${i + 1} has invalid time format.` });
      continue;
    }
    if (from >= to) {
      errors.push({ index: i, message: `Rule #${i + 1} "from" (${r.from}) must be less than "to" (${r.to}).` });
      continue;
    }
    parsed.push({ index: i, from, to, mode: r.mode || '3s' });
  }

  // Check overlaps
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i];
      const b = parsed[j];
      if (Math.max(a.from, b.from) < Math.min(a.to, b.to)) {
        errors.push({
          index: b.index,
          overlappingWith: a.index,
          message: `Rule #${b.index + 1} (${rules[b.index].from}-${rules[b.index].to}) overlaps with Rule #${a.index + 1} (${rules[a.index].from}-${rules[a.index].to}).`
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    parsed: parsed.sort((a, b) => a.from - b.from)
  };
}

/**
 * Core Splitting Function
 * 
 * @param {Array} words - Word objects [{ word, start, end }]
 * @param {number} audioDuration - True audio duration in seconds
 * @param {Object} options:
 *   - mode: '3s' | '5s' | 'sentences' | 'custom'
 *   - avoidMidSentenceCut: boolean (for fixed modes)
 *   - pauseThreshold: number (default 0.6)
 *   - minSentenceBlockSec: number (default 2)
 *   - maxSentenceBlockSec: number (default 8)
 *   - rules: Array (for 'custom' mode)
 *   - defaultRestMode: '3s' | '5s' | 'sentences' (default '3s')
 */
function splitTranscript(words = [], audioDuration = 0, options = {}) {
  const mode = options.mode || '3s';
  const totalSec = Math.max(1, Math.round(audioDuration || (words.length ? words[words.length - 1].end : 0)));
  const avoidCut = !!options.avoidMidSentenceCut;
  const pauseThreshold = options.pauseThreshold ?? 0.6;
  const minSentenceSec = options.minSentenceBlockSec ?? 2;
  const maxSentenceSec = options.maxSentenceBlockSec ?? 8;

  let cuts = [];

  if (mode === '3s') {
    cuts = generateFixedCuts(3, totalSec, words, avoidCut, pauseThreshold);
  } else if (mode === '5s') {
    cuts = generateFixedCuts(5, totalSec, words, avoidCut, pauseThreshold);
  } else if (mode === 'sentences') {
    cuts = generateSentenceCuts(words, totalSec, pauseThreshold, minSentenceSec, maxSentenceSec);
  } else if (mode === 'custom') {
    cuts = generateCustomCuts(words, totalSec, options.rules || [], options.defaultRestMode || '3s', pauseThreshold, minSentenceSec, maxSentenceSec);
  } else {
    cuts = generateFixedCuts(3, totalSec, words, avoidCut, pauseThreshold);
  }

  // Ensure cuts start with 0 and end with totalSec, strictly sorted and unique whole seconds
  const cleanCuts = normalizeCuts(cuts, totalSec);

  // Build blocks from cuts
  const blocks = [];
  for (let i = 0; i < cleanCuts.length - 1; i++) {
    const startSec = cleanCuts[i];
    const endSec = cleanCuts[i + 1];
    if (startSec >= endSec) continue;

    // A word belongs to the block where it STARTS
    const blockWords = words.filter(w => w.start >= startSec && w.start < endSec);
    const captionText = blockWords.map(w => w.word.trim()).filter(Boolean).join(' ').trim();
    const isSilent = captionText.length === 0;

    blocks.push({
      number: i + 1,
      filename: getBlockFilename(startSec, endSec),
      start: startSec,
      end: endSec,
      caption: captionText,
      silent: isSilent,
      words: blockWords
    });
  }

  return {
    blocks,
    totalBlocks: blocks.length,
    audioDuration: totalSec,
    mode
  };
}

/**
 * Generate fixed interval cuts (3s, 5s, etc.)
 */
function generateFixedCuts(interval, totalSec, words, avoidCut, pauseThreshold) {
  const cuts = [0];
  let cur = interval;
  while (cur < totalSec) {
    let cutPoint = cur;
    if (avoidCut && words && words.length) {
      // Find candidate words near cur (within +-1s)
      const nearby = words.filter(w => Math.abs(w.end - cur) <= 1.0 || Math.abs(w.start - cur) <= 1.0);
      let bestNudge = null;
      for (const w of nearby) {
        // Check sentence end
        const isPunct = /[.!?]$/.test(w.word.trim());
        if (isPunct) {
          bestNudge = Math.round(w.end);
          break;
        }
      }
      if (bestNudge === null) {
        // Check pause between words
        for (let i = 0; i < words.length - 1; i++) {
          const w1 = words[i];
          const w2 = words[i + 1];
          if (w2.start - w1.end >= pauseThreshold && Math.abs(w1.end - cur) <= 1.0) {
            bestNudge = Math.round(w1.end);
            break;
          }
        }
      }
      if (bestNudge !== null && bestNudge > cuts[cuts.length - 1] && bestNudge < totalSec) {
        cutPoint = bestNudge;
      }
    }
    cuts.push(cutPoint);
    if (avoidCut && cutPoint !== cur) {
      cur = cutPoint + interval;
    } else {
      cur += interval;
    }
  }
  cuts.push(totalSec);
  return cuts;
}

/**
 * Generate sentence-based cuts with min/max length constraints and pause detection
 */
function generateSentenceCuts(words, totalSec, pauseThreshold, minSec, maxSec) {
  if (!words || !words.length) {
    // If no words, split by default 5s
    return generateFixedCuts(5, totalSec, [], false, pauseThreshold);
  }

  // 1. Group words into natural sentence fragments
  const fragments = [];
  let curFragment = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    curFragment.push(w);
    const text = w.word.trim();
    const isSentencePunct = /[.!?]$/.test(text);
    const hasNext = i < words.length - 1;
    const isLongPause = hasNext && (words[i + 1].start - w.end >= pauseThreshold);

    if (isSentencePunct || isLongPause || !hasNext) {
      fragments.push({
        words: [...curFragment],
        start: curFragment[0].start,
        end: curFragment[curFragment.length - 1].end
      });
      curFragment = [];
    }
  }

  // 2. Build cuts adhering to minSec and maxSec
  const rawBoundaries = [0];
  let fragIndex = 0;

  while (fragIndex < fragments.length) {
    let currentStart = rawBoundaries[rawBoundaries.length - 1];
    let frag = fragments[fragIndex];
    let currentEnd = Math.round(frag.end);
    let dur = currentEnd - currentStart;

    // Check if this fragment is too short: merge with next
    while (dur < minSec && fragIndex < fragments.length - 1) {
      fragIndex++;
      frag = fragments[fragIndex];
      currentEnd = Math.round(frag.end);
      dur = currentEnd - currentStart;
    }

    // Check if this block is too long: split near middle (at comma or pause)
    if (dur > maxSec) {
      const splitPoint = findBestSplitPoint(words, currentStart, currentEnd);
      rawBoundaries.push(splitPoint);
      // Do not advance fragIndex yet, will process remainder in next loop
      continue;
    }

    rawBoundaries.push(currentEnd);
    fragIndex++;
  }

  rawBoundaries.push(totalSec);
  return rawBoundaries;
}

/**
 * Find the best comma, conjunction or pause near the middle of a too-long section
 */
function findBestSplitPoint(words, startSec, endSec) {
  const mid = (startSec + endSec) / 2;
  const inRange = words.filter(w => w.start >= startSec + 1 && w.end <= endSec - 1);
  if (!inRange.length) return Math.round(mid);

  // Look for comma or semicolon
  let bestWord = null;
  let minDiff = Infinity;

  for (const w of inRange) {
    const hasComma = /[,;]$/.test(w.word.trim());
    const diff = Math.abs(w.end - mid);
    if (hasComma && diff < minDiff) {
      minDiff = diff;
      bestWord = w;
    }
  }

  if (bestWord) return Math.round(bestWord.end);

  // Fallback to word boundary closest to middle
  for (const w of inRange) {
    const diff = Math.abs(w.end - mid);
    if (diff < minDiff) {
      minDiff = diff;
      bestWord = w;
    }
  }

  return bestWord ? Math.round(bestWord.end) : Math.round(mid);
}

/**
 * Generate custom range cuts with hard cuts at rule boundaries
 */
function generateCustomCuts(words, totalSec, rules, defaultRestMode, pauseThreshold, minSec, maxSec) {
  const validation = validateRules(rules, totalSec);
  const activeRules = validation.parsed || [];

  // Break entire duration into contiguous segments: either a rule segment or an unassigned rest segment
  const segments = [];
  let cur = 0;

  for (const r of activeRules) {
    const rFrom = Math.min(totalSec, Math.max(0, r.from));
    const rTo = Math.min(totalSec, Math.max(rFrom, r.to));
    if (rFrom > cur) {
      segments.push({ from: cur, to: rFrom, mode: defaultRestMode });
    }
    segments.push({ from: rFrom, to: rTo, mode: r.mode });
    cur = rTo;
  }
  if (cur < totalSec) {
    segments.push({ from: cur, to: totalSec, mode: defaultRestMode });
  }

  const allCuts = [0];

  for (const seg of segments) {
    const segDur = seg.to - seg.from;
    if (segDur <= 0) continue;

    const segWords = words.filter(w => w.start >= seg.from && w.start < seg.to);
    let internalCuts = [];

    if (seg.mode === '3s') {
      internalCuts = generateFixedCuts(3, segDur, segWords.map(w => ({ ...w, start: w.start - seg.from, end: w.end - seg.from })), false, pauseThreshold);
    } else if (seg.mode === '5s') {
      internalCuts = generateFixedCuts(5, segDur, segWords.map(w => ({ ...w, start: w.start - seg.from, end: w.end - seg.from })), false, pauseThreshold);
    } else if (seg.mode === 'sentences') {
      internalCuts = generateSentenceCuts(segWords.map(w => ({ ...w, start: w.start - seg.from, end: w.end - seg.from })), segDur, pauseThreshold, minSec, maxSec);
    } else {
      // Custom N seconds (e.g. '1s', '4s', '8s')
      const match = String(seg.mode).match(/^(\d+)s?$/);
      const interval = match ? Math.max(1, Math.min(15, parseInt(match[1]))) : 3;
      internalCuts = generateFixedCuts(interval, segDur, [], false, pauseThreshold);
    }

    // Offset internal cuts by seg.from
    for (const c of internalCuts) {
      allCuts.push(seg.from + c);
    }
    allCuts.push(seg.to);
  }

  allCuts.push(totalSec);
  return allCuts;
}

/**
 * Deduplicate, sort, and ensure boundaries stay on whole seconds
 */
function normalizeCuts(cuts, totalSec) {
  const set = new Set(cuts.map(c => Math.max(0, Math.min(totalSec, Math.round(c)))));
  set.add(0);
  set.add(totalSec);
  const sorted = Array.from(set).sort((a, b) => a - b);
  return sorted;
}

// ═══════════════════════════════════════════════════════════════════════════â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EXPORT FORMATTERS
// ═══════════════════════════════════════════════════════════════════════════â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Export 1: Captions .txt
 * Format: (m:ss) text
 * Skip silent blocks. No blank lines. UTF-8.
 */
function exportCaptionsTxt(blocks) {
  const lines = [];
  for (const b of blocks) {
    if (b.silent || !b.caption || !b.caption.trim()) continue;
    const cleanText = b.caption.replace(/[\r\n]+/g, ' ').trim();
    lines.push(`${formatCaptionTime(b.start)} ${cleanText}`);
  }
  return lines.join('\n');
}

/**
 * Export 2: SRT file
 */
function exportSRT(blocks) {
  const formatSrtTime = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };

  const entries = [];
  let srtIndex = 1;
  for (const b of blocks) {
    if (b.silent || !b.caption || !b.caption.trim()) continue;
    const cleanText = b.caption.replace(/[\r\n]+/g, ' ').trim();
    entries.push(`${srtIndex}\n${formatSrtTime(b.start)} --> ${formatSrtTime(b.end)}\n${cleanText}\n`);
    srtIndex++;
  }
  return entries.join('\n');
}

/**
 * Export 3: Filenames list .txt
 * Format: one expected image filename per line (e.g. 0_03—0_06.png) with caption beside it
 */
function exportFilenamesListTxt(blocks) {
  const lines = [];
  for (const b of blocks) {
    const text = b.silent ? '[Silent]' : b.caption.replace(/[\r\n]+/g, ' ').trim();
    lines.push(`${b.filename}\t${text}`);
  }
  return lines.join('\n');
}

/**
 * Export 4: CSV
 * Columns: filename,start,end,caption
 */
function exportCSV(blocks) {
  const escapeCsv = (str) => {
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = ['filename,start,end,caption'];
  for (const b of blocks) {
    const text = b.caption ? b.caption.replace(/[\r\n]+/g, ' ').trim() : '';
    rows.push(`${escapeCsv(b.filename)},${b.start},${b.end},${escapeCsv(text)}`);
  }
  return rows.join('\n');
}

/**
 * Export 5: Word-level JSON
 */
function exportWordLevelJSON(words) {
  return JSON.stringify(words, null, 2);
}

/**
 * Export 6: Blocks JSON
 * Number, filename, start, end, caption, silent flag
 */
function exportBlocksJSON(blocks) {
  const cleanBlocks = blocks.map(b => ({
    number: b.number,
    filename: b.filename,
    start: b.start,
    end: b.end,
    caption: b.caption || '',
    silent: !!b.silent
  }));
  return JSON.stringify(cleanBlocks, null, 2);
}

module.exports = {
  formatTimeFilename,
  formatCaptionTime,
  parseTimeString,
  getBlockFilename,
  parseSRTToWords,
  parseScriptWithTimestampsToWords,
  validateRules,
  splitTranscript,
  exportCaptionsTxt,
  exportSRT,
  exportFilenamesListTxt,
  exportCSV,
  exportWordLevelJSON,
  exportBlocksJSON
};
