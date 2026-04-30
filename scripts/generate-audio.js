#!/usr/bin/env node
/**
 * narration.json を読んで Aivis Cloud で音声合成、ffmpeg で MP3 に変換。
 *
 * 入力: pitch/audio/narration.json
 *      環境変数 AIVIS_API_KEY, AIVIS_MODEL_UUID
 *      (未設定なら $TEALUS_REPO/agent-server/.env から読む)
 * 出力: pitch/audio/slide-XX.mp3 (1-origin、zero-pad 2)
 *
 * Flags:
 *   --slide N   特定 slide だけ生成 (テスト用)
 *   --force     既存ファイルがあっても上書き
 *   --dry-run   API 呼び出しせず予定のみ表示
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const TEALUS_REPO = process.env.TEALUS_REPO || 'C:/app/tealus';
const AUDIO_DIR = path.join(__dirname, '..', 'pitch', 'audio');
const NARRATION = path.join(AUDIO_DIR, 'narration.json');

// .env をパース (AIVIS_API_KEY が未設定の場合の fallback)
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return out;
}

const env = (() => {
  if (process.env.AIVIS_API_KEY) {
    return { AIVIS_API_KEY: process.env.AIVIS_API_KEY, AIVIS_MODEL_UUID: process.env.AIVIS_MODEL_UUID };
  }
  return loadEnv(path.join(TEALUS_REPO, 'agent-server', '.env'));
})();

const API_KEY = env.AIVIS_API_KEY;
const MODEL_UUID = env.AIVIS_MODEL_UUID;

if (!API_KEY || !MODEL_UUID) {
  console.error('Missing AIVIS_API_KEY or AIVIS_MODEL_UUID');
  process.exit(1);
}

// CLI flags
const args = process.argv.slice(2);
const flagSlide = (() => {
  const i = args.indexOf('--slide');
  return i >= 0 ? parseInt(args[i + 1], 10) : null;
})();
const flagForce = args.includes('--force');
const flagDryRun = args.includes('--dry-run');

function synthesizeOnce(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ model_uuid: MODEL_UUID, text, output_format: 'wav' });
    const req = https.request('https://api.aivis-project.com/v1/tts/synthesize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode === 200) resolve(buf);
        else {
          const err = new Error(`Aivis ${res.statusCode}: ${buf.toString().substring(0, 200)}`);
          err.status = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function synthesize(text) {
  // 429 (rate limit) で exponential backoff、3 回リトライ
  const delays = [10000, 20000, 40000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await synthesizeOnce(text);
    } catch (e) {
      if (e.status === 429 && attempt < delays.length) {
        const wait = delays[attempt];
        process.stdout.write(`(429, retry in ${wait/1000}s) `);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

function wavToMp3(wavPath, mp3Path) {
  // 128kbps mono、適度な品質、サイズ抑制
  const r = spawnSync('ffmpeg', [
    '-y', '-i', wavPath,
    '-ac', '1',          // mono
    '-ar', '24000',      // 24kHz は narration に十分
    '-b:a', '64k',       // mono なら 64kbps で十分聴ける、サイズ削減
    mp3Path,
  ], { stdio: 'pipe' });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed: ${r.stderr.toString().substring(0, 300)}`);
  }
}

async function main() {
  const j = JSON.parse(fs.readFileSync(NARRATION, 'utf8'));
  const targets = flagSlide ? [flagSlide] : j.slides.map((_, i) => i + 1);

  console.log(`Generating ${targets.length} slide(s) audio...`);
  console.log(`Model: ${MODEL_UUID}`);
  let totalBytes = 0;

  for (const n of targets) {
    const idx = n - 1;
    const text = j.slides[idx];
    if (!text) { console.warn(`  [${n}] no text, skip`); continue; }

    const fname = `slide-${String(n).padStart(2, '0')}.mp3`;
    const outPath = path.join(AUDIO_DIR, fname);
    if (!flagForce && fs.existsSync(outPath)) {
      console.log(`  [${n}] ${fname} exists, skip (use --force to overwrite)`);
      totalBytes += fs.statSync(outPath).size;
      continue;
    }

    if (flagDryRun) {
      console.log(`  [${n}] (dry-run) ${text.length} chars: ${text.substring(0, 50)}...`);
      continue;
    }

    process.stdout.write(`  [${n}] synthesizing ${text.length} chars... `);
    const t0 = Date.now();
    try {
      const wav = await synthesize(text);
      const wavPath = outPath.replace(/\.mp3$/, '.wav.tmp');
      fs.writeFileSync(wavPath, wav);
      wavToMp3(wavPath, outPath);
      fs.unlinkSync(wavPath);
      const sz = fs.statSync(outPath).size;
      totalBytes += sz;
      console.log(`OK (${Math.round(sz / 1024)}KB, ${Date.now() - t0}ms)`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
      throw e;
    }
    // rate limit 対策: 各リクエスト後に小休止
    await sleep(1500);
  }

  console.log(`\nTotal MP3 size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(e => { console.error(e); process.exit(1); });
