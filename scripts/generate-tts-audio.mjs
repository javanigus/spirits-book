import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MANIFEST = path.join('tts_manifest', 'simplified.json');
const DEFAULT_OUTPUT_ROOT = 'tts_audio';
const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const OUTPUT_FORMAT = 'mp3_44100_128';
const MODEL_ID = 'eleven_multilingual_v2';

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    startSection: null,
    endSection: null,
    overwrite: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);

    if (key === 'overwrite' || key === 'dry-run') {
      if (key === 'overwrite') args.overwrite = true;
      if (key === 'dry-run') args.dryRun = true;
      continue;
    }

    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    if (key === 'manifest') args.manifest = value;
    else if (key === 'output-root') args.outputRoot = value;
    else if (key === 'start-section') args.startSection = value;
    else if (key === 'end-section') args.endSection = value;
    else throw new Error(`Unknown argument: --${key}`);

    i += 1;
  }

  return args;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function parseVerseNumber(value) {
  const raw = String(value).trim();
  const parts = raw.match(/\d+/g);
  if (!parts || parts.length === 0) {
    return [];
  }

  const numbers = parts.map((n) => Number(n));
  if (!/^\d/.test(raw)) {
    return [0, ...numbers];
  }
  return numbers;
}

function compareVerseNumbers(a, b) {
  const pa = parseVerseNumber(a);
  const pb = parseVerseNumber(b);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i += 1) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

function filterItems(items, startSection, endSection) {
  return items.filter((item) => {
    if (startSection && compareVerseNumbers(item.verse_end, startSection) < 0) {
      return false;
    }
    if (endSection && compareVerseNumbers(item.verse_start, endSection) > 0) {
      return false;
    }
    return true;
  });
}

async function loadManifest(manifestPath) {
  let raw;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`Manifest not found: ${manifestPath}`);
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Manifest is not valid JSON: ${manifestPath}`);
  }

  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error(`Manifest missing items array: ${manifestPath}`);
  }

  return parsed;
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestAudio({ apiKey, voiceId, text, previousText, nextText }) {
  const url = `${API_BASE}/${voiceId}?output_format=${OUTPUT_FORMAT}`;

  const body = {
    text,
    model_id: MODEL_ID,
  };

  if (previousText) body.previous_text = previousText;
  if (nextText) body.next_text = nextText;

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        const waitMs = 1000 * (2 ** (attempt - 1));
        await sleep(waitMs);
      }
    }
  }

  throw lastError;
}

function redactKey(value) {
  if (!value) return value;
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const manifestPath = path.resolve(cwd, args.manifest);
  const outputRoot = path.resolve(cwd, args.outputRoot);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || process.env.voice_id || process.env.VOICE_ID;

  if (!apiKey) {
    throw new Error('Missing ELEVENLABS_API_KEY in environment/.env');
  }
  if (!voiceId) {
    throw new Error('Missing ELEVENLABS_VOICE_ID in environment/.env');
  }

  const manifest = await loadManifest(manifestPath);
  const selected = filterItems(manifest.items, args.startSection, args.endSection);

  if (selected.length === 0) {
    throw new Error('No matching sections found for the provided range');
  }

  const indexByObject = new Map();
  manifest.items.forEach((item, idx) => indexByObject.set(item, idx));

  console.log(`Manifest path: ${toPosix(path.relative(cwd, manifestPath))}`);
  console.log(`Output root: ${toPosix(path.relative(cwd, outputRoot))}`);
  console.log(`Voice ID: ${voiceId}`);
  console.log(`Total items: ${manifest.items.length}`);
  console.log(`Selected items: ${selected.length}`);
  if (args.dryRun) {
    console.log('Dry run: enabled');
  }
  if (args.overwrite) {
    console.log('Overwrite: enabled');
  }

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i];
    const relOutput = toPosix(item.output_relpath);
    const targetPath = path.join(outputRoot, item.output_relpath);
    const progress = `[${i + 1}/${selected.length}]`;

    const alreadyExists = await exists(targetPath);
    if (alreadyExists && !args.overwrite) {
      console.log(`${progress} skipping existing ${toPosix(path.relative(cwd, targetPath))}`);
      skipped += 1;
      continue;
    }

    console.log(`${progress} generating ${toPosix(path.relative(cwd, targetPath))}`);

    if (args.dryRun) {
      generated += 1;
      continue;
    }

    const manifestIdx = indexByObject.get(item);
    const prev = manifest.items[manifestIdx - 1];
    const next = manifest.items[manifestIdx + 1];

    const text = item.tts_ssml || item.tts_text;
    const previousText = prev ? prev.tts_text : undefined;
    const nextText = next ? next.tts_text : undefined;

    try {
      const audio = await requestAudio({
        apiKey,
        voiceId,
        text,
        previousText,
        nextText,
      });

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, audio);
      generated += 1;
    } catch (error) {
      failed += 1;
      console.error(`${progress} failed ${relOutput} -> ${error.message}`);
    }
  }

  console.log(`Generated: ${generated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
