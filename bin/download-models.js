'use strict';

/**
 * download-models.js — CLI tool to pre-download Whisper models
 * Run with: npm run download-models
 */

const { downloadModel, getModelStatus } = require('../src/whisper_models');

async function main() {
  console.log('====================================================');
  console.log('  SceneFlow — Whisper Model Pre-Downloader');
  console.log('====================================================\n');

  const models = ['fast', 'best'];

  for (const m of models) {
    const status = getModelStatus(m);
    if (status.downloaded) {
      console.log(`[OK] Model '${status.label}' (${status.realName}) is already downloaded in models/${status.folder}/.`);
      continue;
    }

    console.log(`Downloading '${status.label}' (${status.realName}, ~${status.approxMb}MB)...`);
    let lastPct = -1;

    try {
      await downloadModel(m, (p) => {
        if (p.percent !== lastPct) {
          lastPct = p.percent;
          process.stdout.write(`\r  [${p.percent}%] ${p.mbDownloaded} / ${p.mbTotal} MB (${p.speedMb} MB/s, ETA: ${p.etaSec}s) - ${p.file}    `);
        }
      });
      console.log(`\n[OK] Model '${status.label}' downloaded successfully.\n`);
    } catch (err) {
      console.error(`\n[ERROR] Failed to download '${m}': ${err.message}\n`);
    }
  }

  console.log('All model checks completed.');
}

main().catch(console.error);
