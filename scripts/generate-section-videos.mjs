import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const DEFAULT_IMAGE_MANIFEST = path.join('image_prompts', 'sections-manifest.json');
const DEFAULT_TTS_MANIFEST = path.join('tts_manifest', 'simplified.json');
const DEFAULT_IMAGE_ROOT = path.join('static', 'img');
const DEFAULT_AUDIO_ROOT = 'tts_audio';
const DEFAULT_OUTPUT_ROOT = 'video_clips';

function parseArgs(argv) {
  const args = {
    imageManifest: DEFAULT_IMAGE_MANIFEST,
    ttsManifest: DEFAULT_TTS_MANIFEST,
    imageRoot: DEFAULT_IMAGE_ROOT,
    audioRoot: DEFAULT_AUDIO_ROOT,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    sourceFile: null,
    startVerse: null,
    endVerse: null,
    overwrite: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

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

    if (key === 'image-manifest') args.imageManifest = value;
    else if (key === 'tts-manifest') args.ttsManifest = value;
    else if (key === 'image-root') args.imageRoot = value;
    else if (key === 'audio-root') args.audioRoot = value;
    else if (key === 'output-root') args.outputRoot = value;
    else if (key === 'source-file') args.sourceFile = value;
    else if (key === 'start-verse') args.startVerse = value;
    else if (key === 'end-verse') args.endVerse = value;
    else throw new Error(`Unknown argument: --${key}`);

    i += 1;
  }

  return args;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function parseVerseNumber(value) {
  const raw = String(value).trim();
  const match = raw.match(/^([A-Za-z]+)?\.?/);
  const prefix = match?.[1] ? match[1].toUpperCase() : '';
  const nums = (raw.match(/\d+/g) || []).map((n) => Number(n));

  if (prefix) {
    return [10_000 + prefix.charCodeAt(0), ...nums];
  }
  return [0, ...nums];
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

function overlapsRange(itemStart, itemEnd, rangeStart, rangeEnd) {
  if (rangeStart && compareVerseNumbers(itemEnd, rangeStart) < 0) {
    return false;
  }
  if (rangeEnd && compareVerseNumbers(itemStart, rangeEnd) > 0) {
    return false;
  }
  return true;
}

async function loadJson(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON: ${filePath}`);
  }
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function resolveImagePath(imageRootAbs, outputRelPath) {
  const stem = path.basename(outputRelPath, path.extname(outputRelPath)).toLowerCase();
  const preferred = ['.webp', '.jpg', '.jpeg', '.png'];

  for (const ext of preferred) {
    const candidate = path.join(imageRootAbs, `${stem}${ext}`);
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function chooseBookImageJob(section) {
  const jobs = section.image_jobs || [];
  return jobs.find((j) => String(j.target || '').toLowerCase() === 'book') || jobs[0] || null;
}

function getOutputRelPath(section) {
  const match = section.source_file.match(/\/((part-[^/]+))\//);
  const bucket = match ? match[1] : (section.chapter_slug || 'misc');
  const name = section.verse_start === section.verse_end
    ? `${section.verse_start}.mp4`
    : `${section.verse_start}-${section.verse_end}.mp4`;
  return toPosixPath(path.join(bucket, name));
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-800)}`));
    });
  });
}

async function concatAudio(audioFiles, tempDir) {
  if (audioFiles.length === 1) {
    return audioFiles[0];
  }

  const listPath = path.join(tempDir, 'concat-list.txt');
  const concatOut = path.join(tempDir, 'section-audio.mp3');
  const listContent = audioFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, `${listContent}\n`, 'utf8');

  await runFfmpeg([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    concatOut,
  ]);

  return concatOut;
}

async function makeVideo({ imagePath, audioPath, outputPath }) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  await runFfmpeg([
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-i', audioPath,
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outputPath,
  ]);
}

function filterH2Sections(imageManifest, sourceFile, startVerse, endVerse) {
  const items = Array.isArray(imageManifest.items) ? imageManifest.items : [];
  return items.filter((item) => {
    if (item.section_heading_level !== 'h2') return false;
    if (sourceFile && item.source_file !== sourceFile) return false;
    return overlapsRange(item.verse_start, item.verse_end, startVerse, endVerse);
  });
}

function collectTtsChunksForSection(ttsManifest, section) {
  const all = Array.isArray(ttsManifest.items) ? ttsManifest.items : [];
  const filtered = all.filter((item) => (
    item.source_file === section.source_file
    && overlapsRange(item.verse_start, item.verse_end, section.verse_start, section.verse_end)
  ));

  filtered.sort((a, b) => compareVerseNumbers(a.verse_start, b.verse_start));
  return filtered;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const imageManifestPath = path.resolve(cwd, args.imageManifest);
  const ttsManifestPath = path.resolve(cwd, args.ttsManifest);
  const imageRootAbs = path.resolve(cwd, args.imageRoot);
  const audioRootAbs = path.resolve(cwd, args.audioRoot);
  const outputRootAbs = path.resolve(cwd, args.outputRoot);

  const imageManifest = await loadJson(imageManifestPath);
  const ttsManifest = await loadJson(ttsManifestPath);

  const h2Sections = filterH2Sections(imageManifest, args.sourceFile, args.startVerse, args.endVerse);
  if (h2Sections.length === 0) {
    throw new Error('No matching H2 sections found');
  }

  console.log(`Image manifest: ${toPosixPath(path.relative(cwd, imageManifestPath))}`);
  console.log(`TTS manifest: ${toPosixPath(path.relative(cwd, ttsManifestPath))}`);
  console.log(`Image root: ${toPosixPath(path.relative(cwd, imageRootAbs))}`);
  console.log(`Audio root: ${toPosixPath(path.relative(cwd, audioRootAbs))}`);
  console.log(`Output root: ${toPosixPath(path.relative(cwd, outputRootAbs))}`);
  console.log(`Selected H2 sections: ${h2Sections.length}`);
  if (args.overwrite) console.log('Overwrite: enabled');
  if (args.dryRun) console.log('Dry run: enabled');

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < h2Sections.length; i += 1) {
    const section = h2Sections[i];
    const progress = `[${i + 1}/${h2Sections.length}]`;
    const outRel = getOutputRelPath(section);
    const outAbs = path.join(outputRootAbs, outRel);

    if (!args.overwrite && await exists(outAbs)) {
      console.log(`${progress} skipping existing ${toPosixPath(path.relative(cwd, outAbs))}`);
      skipped += 1;
      continue;
    }

    const imageJob = chooseBookImageJob(section);
    if (!imageJob) {
      console.error(`${progress} failed: missing image job for ${section.source_file}#${section.section_index}`);
      failed += 1;
      continue;
    }

    const imagePath = await resolveImagePath(imageRootAbs, imageJob.output_relpath);
    if (!imagePath) {
      console.error(`${progress} failed: image not found for stem ${path.basename(imageJob.output_relpath, path.extname(imageJob.output_relpath))}`);
      failed += 1;
      continue;
    }

    const chunks = collectTtsChunksForSection(ttsManifest, section);
    if (chunks.length === 0) {
      console.error(`${progress} failed: no TTS chunks for ${section.source_file} ${section.verse_start}-${section.verse_end}`);
      failed += 1;
      continue;
    }

    const audioFiles = chunks.map((c) => path.join(audioRootAbs, c.output_relpath));
    const missingAudio = [];
    for (const f of audioFiles) {
      if (!await exists(f)) missingAudio.push(f);
    }
    if (missingAudio.length > 0) {
      console.error(`${progress} failed: missing audio files (${missingAudio.length}) for ${section.verse_start}-${section.verse_end}`);
      failed += 1;
      continue;
    }

    console.log(`${progress} generating ${toPosixPath(path.relative(cwd, outAbs))} (chunks=${chunks.length})`);
    if (args.dryRun) {
      generated += 1;
      continue;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffclip-'));
    try {
      const mergedAudio = await concatAudio(audioFiles, tempDir);
      await makeVideo({ imagePath, audioPath: mergedAudio, outputPath: outAbs });
      generated += 1;
    } catch (error) {
      failed += 1;
      console.error(`${progress} failed: ${error.message}`);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
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
