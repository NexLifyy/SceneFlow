/**
 * timing_client.js — SceneFlow Timing client-side splitting & formatting logic
 */

export function formatTimeFilename(sec) {
  const sTotal = Math.max(0, Math.floor(sec));
  const h = Math.floor(sTotal / 3600);
  const m = Math.floor((sTotal % 3600) / 60);
  const s = sTotal % 60;
  if (h > 0) {
    return `${h}_${String(m).padStart(2, '0')}_${String(s).padStart(2, '0')}`;
  }
  return `${m}_${String(s).padStart(2, '0')}`;
}

export function formatCaptionTime(sec) {
  const sTotal = Math.max(0, Math.floor(sec));
  const h = Math.floor(sTotal / 3600);
  const m = Math.floor((sTotal % 3600) / 60);
  const s = sTotal % 60;
  if (h > 0) {
    return `(${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')})`;
  }
  return `(${m}:${String(s).padStart(2, '0')})`;
}

export function parseTimeString(val) {
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

export function getBlockFilename(startSec, endSec) {
  return `${formatTimeFilename(startSec)}—${formatTimeFilename(endSec)}.png`;
}

export function validateRules(rules, audioDuration) {
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

export function splitTranscript(words = [], audioDuration = 0, options = {}) {
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

  const cleanCuts = normalizeCuts(cuts, totalSec);
  const blocks = [];

  for (let i = 0; i < cleanCuts.length - 1; i++) {
    const startSec = cleanCuts[i];
    const endSec = cleanCuts[i + 1];
    if (startSec >= endSec) continue;

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

function generateFixedCuts(interval, totalSec, words, avoidCut, pauseThreshold) {
  const cuts = [0];
  let cur = interval;
  while (cur < totalSec) {
    let cutPoint = cur;
    if (avoidCut && words && words.length) {
      const nearby = words.filter(w => Math.abs(w.end - cur) <= 1.0 || Math.abs(w.start - cur) <= 1.0);
      let bestNudge = null;
      for (const w of nearby) {
        if (/[.!?]$/.test(w.word.trim())) {
          bestNudge = Math.round(w.end);
          break;
        }
      }
      if (bestNudge === null) {
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
    cur += interval;
  }
  cuts.push(totalSec);
  return cuts;
}

function generateSentenceCuts(words, totalSec, pauseThreshold, minSec, maxSec) {
  if (!words || !words.length) {
    return generateFixedCuts(5, totalSec, [], false, pauseThreshold);
  }

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

  const rawBoundaries = [0];
  let fragIndex = 0;

  while (fragIndex < fragments.length) {
    let currentStart = rawBoundaries[rawBoundaries.length - 1];
    let frag = fragments[fragIndex];
    let currentEnd = Math.round(frag.end);
    let dur = currentEnd - currentStart;

    while (dur < minSec && fragIndex < fragments.length - 1) {
      fragIndex++;
      frag = fragments[fragIndex];
      currentEnd = Math.round(frag.end);
      dur = currentEnd - currentStart;
    }

    if (dur > maxSec) {
      const mid = (currentStart + currentEnd) / 2;
      const inRange = words.filter(w => w.start >= currentStart + 1 && w.end <= currentEnd - 1);
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
      if (!bestWord) {
        for (const w of inRange) {
          const diff = Math.abs(w.end - mid);
          if (diff < minDiff) {
            minDiff = diff;
            bestWord = w;
          }
        }
      }
      const splitPoint = bestWord ? Math.round(bestWord.end) : Math.round(mid);
      rawBoundaries.push(splitPoint);
      continue;
    }

    rawBoundaries.push(currentEnd);
    fragIndex++;
  }

  rawBoundaries.push(totalSec);
  return rawBoundaries;
}

function generateCustomCuts(words, totalSec, rules, defaultRestMode, pauseThreshold, minSec, maxSec) {
  const validation = validateRules(rules, totalSec);
  const activeRules = validation.parsed || [];

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
      const match = String(seg.mode).match(/^(\d+)s?$/);
      const interval = match ? Math.max(1, Math.min(15, parseInt(match[1]))) : 3;
      internalCuts = generateFixedCuts(interval, segDur, [], false, pauseThreshold);
    }

    for (const c of internalCuts) {
      allCuts.push(seg.from + c);
    }
    allCuts.push(seg.to);
  }

  allCuts.push(totalSec);
  return allCuts;
}

function normalizeCuts(cuts, totalSec) {
  const set = new Set(cuts.map(c => Math.max(0, Math.min(totalSec, Math.round(c)))));
  set.add(0);
  set.add(totalSec);
  return Array.from(set).sort((a, b) => a - b);
}

export function exportCaptionsTxt(blocks) {
  const lines = [];
  for (const b of blocks) {
    if (b.silent || !b.caption || !b.caption.trim()) continue;
    const cleanText = b.caption.replace(/[\r\n]+/g, ' ').trim();
    lines.push(`${formatCaptionTime(b.start)} ${cleanText}`);
  }
  return lines.join('\n');
}

export function exportSRT(blocks) {
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

export function exportFilenamesListTxt(blocks) {
  const lines = [];
  for (const b of blocks) {
    const text = b.silent ? '[Silent]' : b.caption.replace(/[\r\n]+/g, ' ').trim();
    lines.push(`${b.filename}\t${text}`);
  }
  return lines.join('\n');
}

export function exportCSV(blocks) {
  const escapeCsv = (str) => {
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  const rows = ['filename,start,end,caption'];
  for (const b of blocks) {
    const text = b.caption ? b.caption.replace(/[\r\n]+/g, ' ').trim() : '';
    rows.push(`${escapeCsv(b.filename)},${b.start},${b.end},${escapeCsv(text)}`);
  }
  return rows.join('\n');
}

export function exportWordLevelJSON(words) {
  return JSON.stringify(words, null, 2);
}

export function exportBlocksJSON(blocks) {
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
