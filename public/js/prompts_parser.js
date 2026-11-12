/**
 * prompts_parser.js — Parser, Validator, Batcher & Output Builder for SceneFlow Prompts (Browser ES Module)
 */

/**
 * Parse time string into total seconds.
 * Supports:
 *   - "0:03" -> 3
 *   - "1:05" -> 65
 *   - "12:30" -> 750
 *   - "1:02:30" -> 3750
 * @param {string} str 
 * @returns {number|null}
 */
export function parseTimeString(str) {
  if (!str || typeof str !== 'string') return null;
  const clean = str.trim().replace(/^[\(\[\{]/, '').replace(/[\)\]\}]$/, '').trim();
  const parts = clean.split(':').map(p => parseInt(p, 10));
  if (parts.some(p => isNaN(p) || p < 0)) return null;

  if (parts.length === 2) {
    const [m, s] = parts;
    if (s >= 60) return null;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    if (m >= 60 || s >= 60) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

/**
 * Parse a single line containing a timestamp prefix and caption text.
 * Examples:
 *   "(0:03) You've been exhausted all day..."
 *   "(1:05) ordinary, washing a cup..."
 *   "(12:30) deep in the conversation..."
 *   "(1:02:30) looking back at history..."
 * @param {string} line
 * @param {number} lineIndex
 * @returns {object|null}
 */
export function parseTimestampLine(line, lineIndex = 0) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\(?\[?(\d{1,2}:\d{2}(?::\d{2})?)\)?\]?)\s*(.*)$/);
  if (!match) return null;

  const rawTimeToken = match[1];
  const cleanTime = match[2];
  const text = (match[3] || '').trim();

  const timeSec = parseTimeString(cleanTime);
  if (timeSec === null) return null;

  const rawTime = rawTimeToken.startsWith('(') && rawTimeToken.endsWith(')')
    ? rawTimeToken
    : (rawTimeToken.startsWith('[') && rawTimeToken.endsWith(']'))
      ? `(${cleanTime})`
      : `(${cleanTime})`;

  return {
    lineIndex,
    lineNum: lineIndex + 1,
    rawTime,
    cleanTime,
    timeSec,
    text,
    raw: line
  };
}

/**
 * Validate a full block of caption text lines.
 * Checks for:
 *   - Missing/invalid timestamp prefixes (bad lines)
 *   - Timestamps out of order (e.g. 0:05 before 0:03)
 *   - Duplicate timestamps (e.g. two lines starting with (0:03))
 * @param {string} text
 * @returns {object}
 */
export function validateCaptionLines(text) {
  if (!text || typeof text !== 'string') {
    return {
      valid: false,
      totalLines: 0,
      validCount: 0,
      lines: [],
      badLines: [],
      duplicateTimes: [],
      outOfOrderTimes: [],
      errorSummary: 'Input is empty'
    };
  }

  const rawLines = text.split(/\r?\n/);
  const lines = [];
  const badLines = [];
  const duplicateTimes = [];
  const outOfOrderTimes = [];

  const timeOccurrences = new Map();
  let prevTimeSec = -1;
  let prevRawTime = '';

  rawLines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    const parsed = parseTimestampLine(rawLine, idx);
    if (!parsed) {
      badLines.push({
        lineIndex: idx,
        lineNum: idx + 1,
        raw: rawLine,
        error: 'Missing or invalid timestamp format. Expected: (0:03) Caption text'
      });
      return;
    }

    // Check duplicate
    if (!timeOccurrences.has(parsed.cleanTime)) {
      timeOccurrences.set(parsed.cleanTime, [parsed.lineNum]);
    } else {
      timeOccurrences.get(parsed.cleanTime).push(parsed.lineNum);
    }

    // Check chronological order
    if (parsed.timeSec < prevTimeSec) {
      outOfOrderTimes.push({
        lineIndex: idx,
        lineNum: idx + 1,
        rawTime: parsed.rawTime,
        timeSec: parsed.timeSec,
        prevTime: prevRawTime,
        prevTimeSec
      });
    }

    prevTimeSec = parsed.timeSec;
    prevRawTime = parsed.rawTime;
    lines.push(parsed);
  });

  // Collect duplicates
  for (const [cleanTime, lineNums] of timeOccurrences.entries()) {
    if (lineNums.length > 1) {
      duplicateTimes.push({
        cleanTime,
        rawTime: `(${cleanTime})`,
        lineNums,
        count: lineNums.length
      });
    }
  }

  const valid = lines.length > 0 && badLines.length === 0 && outOfOrderTimes.length === 0 && duplicateTimes.length === 0;

  let errorSummary = '';
  if (lines.length === 0 && badLines.length === 0) {
    errorSummary = 'No caption lines found.';
  } else if (badLines.length > 0) {
    errorSummary = `${badLines.length} line${badLines.length > 1 ? 's have' : ' has'} invalid timestamp formatting.`;
  } else if (duplicateTimes.length > 0) {
    errorSummary = `Duplicate timestamps detected: ${duplicateTimes.map(d => `${d.rawTime} (lines ${d.lineNums.join(', ')})`).join('; ')}.`;
  } else if (outOfOrderTimes.length > 0) {
    errorSummary = `Timestamps out of chronological order at line ${outOfOrderTimes[0].lineNum} (${outOfOrderTimes[0].rawTime} came after ${outOfOrderTimes[0].prevTime}).`;
  }

  return {
    valid,
    totalLines: lines.length + badLines.length,
    validCount: lines.length,
    lines,
    badLines,
    duplicateTimes,
    outOfOrderTimes,
    errorSummary
  };
}

/**
 * Split caption lines into batches with scene context before and after.
 * @param {Array} lines - Array of parsed caption lines
 * @param {number} batchSize - Maximum lines per batch (default 10: e.g. 100 lines = 10 requests)
 * @param {number} contextWindow - Surrounding lines included for context (default 3)
 * @returns {Array}
 */
export function createBatches(lines, batchSize = 10, contextWindow = 3) {
  if (!lines || !lines.length) return [];
  const bSize = Math.max(1, batchSize);
  const totalBatches = Math.ceil(lines.length / bSize);
  const batches = [];

  for (let b = 0; b < totalBatches; b++) {
    const startIdx = b * bSize;
    const endIdx = Math.min(lines.length, startIdx + bSize);
    const items = lines.slice(startIdx, endIdx);

    const prevContext = lines.slice(Math.max(0, startIdx - contextWindow), startIdx).map(l => ({
      rawTime: l.rawTime,
      text: l.text
    }));

    const nextContext = lines.slice(endIdx, Math.min(lines.length, endIdx + contextWindow)).map(l => ({
      rawTime: l.rawTime,
      text: l.text
    }));

    batches.push({
      batchIndex: b,
      totalBatches,
      startIdx,
      endIdx,
      items,
      prevContext,
      nextContext
    });
  }

  return batches;
}

/**
 * Clean a single prompt string returned by the model:
 *   - Strips redundant model-generated timestamps (e.g. "(0:03) ")
 *   - Strips leading numbers/bullets (e.g. "1. ", "#1 ")
 *   - Replaces inner newlines with a single space (ensuring one prompt per line)
 *   - Strips outer enclosing quotes
 * @param {string} promptStr
 * @returns {string}
 */
export function cleanPromptText(promptStr) {
  if (!promptStr || typeof promptStr !== 'string') return '';
  let clean = promptStr.trim();

  // Strip outer quotes if model wrapped prompt in quotes
  clean = clean.replace(/^["'`]|["'`]$/g, '').trim();

  // Strip leading numbering or timestamps (repeat to handle combinations like "1. (0:03) - ")
  for (let iter = 0; iter < 3; iter++) {
    const before = clean;
    // Strip leading list numbering like "1. ", "1: ", "#1 ", "1) "
    clean = clean.replace(/^(?:#?\d+[\.\:\-\)]\s*)/, '');
    // Strip any accidental leading timestamp generated by the model
    clean = clean.replace(/^(\(?\[?\d{1,2}:\d{2}(?::\d{2})?\)?\]?)\s*[:-]?\s*/, '');
    if (clean === before) break;
  }

  // Replace all internal line breaks with a single space
  clean = clean.replace(/[\r\n]+/g, ' ');

  // Collapse multiple spaces
  clean = clean.replace(/\s{2,}/g, ' ');

  return clean.trim();
}

/**
 * Converts a Visual Style Guide (markdown or plain text) into a clean line format
 * without numbering (e.g. "Art Style & Medium: ...\nCharacter Design & Recurring Figures: ...").
 * Placed above prompts for bulk image generation (Gemini, Claude, Midjourney).
 * @param {string} guide
 * @returns {string}
 */
export function formatStyleGuideAsLines(guide) {
  if (!guide || typeof guide !== 'string') return '';
  const lines = guide.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const sections = [];
  let currentKey = '';
  let currentBody = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(?:#{1,6}\s*)?(?:\d+[\.\)]\s*)?([A-Za-z0-9 &,/_-]+?)(?::|$)/);
    const isHeading = line.startsWith('#') || (headingMatch && /^(Art Style|Character Design|Colour|Color|Palette|Lighting|Atmosphere|Camera|Composition|What to Avoid|Negative|Medium|Environment|Mood|Key Elements|Rendering Details|Negative Directives|Rendering)/i.test(headingMatch[1].trim()));

    if (isHeading && headingMatch) {
      if (currentKey && currentBody.length) {
        sections.push(`${currentKey}: ${currentBody.join(' ')}`);
      }
      currentKey = headingMatch[1].replace(/^(?:#{1,6}\s*)?(?:\d+[\.\)]\s*)?/, '').trim();
      currentBody = [];
      const remainder = line.slice(headingMatch[0].length).trim();
      if (remainder) currentBody.push(remainder);
    } else {
      if (!currentKey && line.includes(':')) {
        const idx = line.indexOf(':');
        currentKey = line.slice(0, idx).trim();
        currentBody = [line.slice(idx + 1).trim()];
      } else {
        currentBody.push(line);
      }
    }
  }
  if (currentKey && currentBody.length) {
    sections.push(`${currentKey}: ${currentBody.join(' ')}`);
  }
  return sections.join('\n');
}

/**
 * Converts a Visual Style Guide into a single continuous paragraph without line breaks.
 * Each section is properly punctuated so instructions flow smoothly as one paragraph.
 * @param {string} guide
 * @returns {string}
 */
export function formatStyleGuideAsParagraph(guide) {
  if (!guide || typeof guide !== 'string') return '';
  const lines = formatStyleGuideAsLines(guide).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  return lines.map(line => /[.!?]$/.test(line) ? line : `${line}.`).join(' ');
}

/**
 * Build the final output prompts list and text string.
 * CRITICAL RULE:
 * The time at the start of each prompt is ALWAYS copied from the input
 * and NEVER typed by the model.
 * 
 * @param {Array} inputLines - The original validated input lines
 * @param {Array|object} modelResults - The model's returned output
 * @param {object} options - Options:
 *   - blankLineBetweenPrompts: boolean (default false)
 *   - styleGuide: optional Visual Style Guide string
 *   - stylePrefix: optional style prefix string
 *   - aspectRatio: optional aspect ratio string, e.g. "16:9"
 * @returns {object}
 */
export function buildPromptsOutput(inputLines, modelResults, options = {}) {
  if (!inputLines || !inputLines.length) {
    return {
      success: false,
      totalCount: 0,
      matchedCount: 0,
      missingCount: 0,
      items: [],
      styleGuideHeader: '',
      rawOutputText: ''
    };
  }

  const {
    blankLineBetweenPrompts = true,
    styleGuide = '',
    stylePrefix = '',
    aspectRatio = ''
  } = options;

  const formattedParagraph = formatStyleGuideAsParagraph(styleGuide);

  const byTimeMap = new Map();
  const byIndexList = [];

  if (Array.isArray(modelResults)) {
    modelResults.forEach((item, idx) => {
      if (typeof item === 'string') {
        byIndexList[idx] = cleanPromptText(item);
      } else if (item && typeof item === 'object') {
        const rawTime = (item.time || item.timestamp || '').trim();
        const pText = cleanPromptText(item.prompt || item.text || '');
        if (rawTime) {
          const cleanTime = rawTime.replace(/^[\(\[]/, '').replace(/[\)\]]$/, '').trim();
          byTimeMap.set(cleanTime, pText);
        }
        byIndexList[idx] = pText;
      }
    });
  } else if (modelResults && typeof modelResults === 'object') {
    for (const [key, val] of Object.entries(modelResults)) {
      const cleanKey = key.replace(/^[\(\[]/, '').replace(/[\)\]]$/, '').trim();
      const pText = cleanPromptText(typeof val === 'string' ? val : (val?.prompt || val?.text || ''));
      byTimeMap.set(cleanKey, pText);
    }
  }

  let matchedCount = 0;
  let missingCount = 0;

  const items = inputLines.map((line, idx) => {
    let promptBody = byTimeMap.get(line.cleanTime);
    if (!promptBody && byIndexList[idx]) {
      promptBody = byIndexList[idx];
    }

    const isMissing = !promptBody || !promptBody.trim();
    if (isMissing) {
      missingCount++;
      promptBody = '[MISSING PROMPT - PLEASE REGENERATE]';
    } else {
      matchedCount++;
    }

    const cleanScene = cleanPromptText(promptBody);
    let finalPrompt = cleanScene;
    const cleanPrefix = (stylePrefix || '').trim();

    // Include the visual style guide (or style prefix) directly in each prompt as a single paragraph
    if (!isMissing) {
      if (formattedParagraph) {
        const sep = /[.!?]$/.test(formattedParagraph) ? ' ' : '. ';
        finalPrompt = `${formattedParagraph}${sep}${cleanScene}`;
      } else if (cleanPrefix) {
        if (!finalPrompt.toLowerCase().startsWith(cleanPrefix.toLowerCase())) {
          const sep = /[.!?]$/.test(cleanPrefix) ? ' ' : '. ';
          finalPrompt = `${cleanPrefix}${sep}${finalPrompt}`;
        }
      }
    }

    if (aspectRatio && !isMissing) {
      const arToken = aspectRatio.startsWith('--ar') ? aspectRatio : `--ar ${aspectRatio}`;
      if (!finalPrompt.includes(arToken)) {
        finalPrompt = `${finalPrompt} ${arToken}`;
      }
    }

    // Enforce strictly single paragraph with no internal line breaks
    finalPrompt = cleanPromptText(finalPrompt);

    // CRITICAL: Prepend the EXACT input time written in the exact input style
    const fullPromptLine = `${line.rawTime} ${finalPrompt}`;

    return {
      index: idx,
      rawTime: line.rawTime,
      cleanTime: line.cleanTime,
      captionText: line.text,
      scenePrompt: cleanScene,
      promptText: finalPrompt,
      fullPromptLine,
      isMissing
    };
  });

  const delimiter = blankLineBetweenPrompts ? '\n\n' : '\n';
  const rawOutputText = items.map(it => it.fullPromptLine).join(delimiter);

  return {
    success: missingCount === 0 && items.length === inputLines.length,
    totalCount: inputLines.length,
    matchedCount,
    missingCount,
    items,
    styleGuideHeader: formattedParagraph,
    rawOutputText
  };
}
