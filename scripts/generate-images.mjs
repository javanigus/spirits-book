import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MANIFEST = path.join('image_prompts', 'sections-manifest.json');
const DEFAULT_OUTPUT_ROOT = 'static';
const KIE_BASE = 'https://api.kie.ai';
const CREATE_TASK_PATH = '/api/v1/jobs/createTask';
const RECORD_INFO_PATH = '/api/v1/jobs/recordInfo';
const MODEL = 'nano-banana-2';

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    startVerse: null,
    endVerse: null,
    overwrite: false,
    overwriteBook: false,
    overwriteYoutube: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    if (key === 'overwrite' || key === 'overwrite-book' || key === 'overwrite-youtube' || key === 'dry-run') {
      if (key === 'overwrite') args.overwrite = true;
      if (key === 'overwrite-book') args.overwriteBook = true;
      if (key === 'overwrite-youtube') args.overwriteYoutube = true;
      if (key === 'dry-run') args.dryRun = true;
      continue;
    }

    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    if (key === 'manifest') args.manifest = value;
    else if (key === 'output-root') args.outputRoot = value;
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
  const match = raw.match(/^([A-Za-z]+)?\.?(.+)?$/);
  const prefix = match && match[1] ? match[1].toUpperCase() : '';
  const nums = (raw.match(/\d+/g) || []).map((n) => Number(n));

  if (prefix) {
    const prefixWeight = 10_000 + prefix.charCodeAt(0);
    return [prefixWeight, ...nums];
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

function filterSections(items, startVerse, endVerse) {
  return items.filter((item) => {
    if (startVerse && compareVerseNumbers(item.verse_end, startVerse) < 0) {
      return false;
    }
    if (endVerse && compareVerseNumbers(item.verse_start, endVerse) > 0) {
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

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Manifest is not valid JSON: ${manifestPath}`);
  }

  if (!data || !Array.isArray(data.items)) {
    throw new Error(`Manifest missing items array: ${manifestPath}`);
  }

  return data;
}

function buildPrompt(manifest, section, imageJob) {
  let basePrompt = imageJob.base_prompt;
  if (!basePrompt && manifest.base_prompt_templates && manifest.base_prompt_templates[imageJob.target]) {
    basePrompt = manifest.base_prompt_templates[imageJob.target].replace('{section_title}', section.section_title || 'Section');
  }

  if (!basePrompt) {
    throw new Error(`Missing base prompt for ${imageJob.target} in ${section.source_file}`);
  }

  const targetKind = String(imageJob.target || '').toLowerCase();
  const sharedPrompt = targetKind === 'book'
    ? String(manifest.base_prompt_book || manifest.base_prompt_shared || '').trim()
    : targetKind === 'youtube'
      ? String(manifest.base_prompt_youtube || manifest.base_prompt_shared || '').trim()
      : String(manifest.base_prompt_shared || '').trim();

  if (sharedPrompt) {
    return `${basePrompt} ${sharedPrompt}\n\n${section.content_prompt}`;
  }

  return `${basePrompt}\n\n${section.content_prompt}`;
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

async function findExistingByStem(targetPath) {
  const dir = path.dirname(targetPath);
  const targetStem = path.basename(targetPath, path.extname(targetPath)).toLowerCase();

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const stem = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
    if (stem === targetStem) {
      return path.join(dir, entry.name);
    }
  }

  return null;
}

function isTerminalState(state) {
  return state === 'success' || state === 'fail';
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJsonWithRetry(url, options, maxAttempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { code: response.status, msg: text };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${payload.msg || text}`);
      }

      if (payload.code && payload.code !== 200) {
        throw new Error(`API ${payload.code}: ${payload.msg || 'Unknown error'}`);
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(1000 * (2 ** (attempt - 1)));
      }
    }
  }

  throw lastError;
}

async function createTask(apiKey, prompt) {
  const url = `${KIE_BASE}${CREATE_TASK_PATH}`;
  const body = {
    model: MODEL,
    input: {
      prompt,
      aspect_ratio: '16:9',
      resolution: '2K',
      output_format: 'jpg',
    },
  };

  const payload = await requestJsonWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const taskId = payload?.data?.taskId;
  if (!taskId) {
    throw new Error('Missing taskId in createTask response');
  }

  return taskId;
}

async function waitForTask(apiKey, taskId, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const url = new URL(`${KIE_BASE}${RECORD_INFO_PATH}`);
    url.searchParams.set('taskId', taskId);

    const payload = await requestJsonWithRetry(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const state = payload?.data?.state;
    if (isTerminalState(state)) {
      if (state === 'fail') {
        const failMsg = payload?.data?.failMsg || 'Generation failed';
        throw new Error(`Task failed: ${failMsg}`);
      }

      const resultJson = payload?.data?.resultJson;
      if (!resultJson) {
        throw new Error('Task succeeded but resultJson is missing');
      }

      let parsedResult;
      try {
        parsedResult = typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson;
      } catch {
        throw new Error('Task succeeded but resultJson is invalid JSON');
      }

      const resultUrl = parsedResult?.resultUrls?.[0];
      if (!resultUrl) {
        throw new Error('Task succeeded but no result URL found');
      }

      return resultUrl;
    }

    await sleep(2500);
  }

  throw new Error('Timed out waiting for task completion');
}

async function downloadBufferWithRetry(url, maxAttempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      const arr = await response.arrayBuffer();
      return Buffer.from(arr);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(1000 * (2 ** (attempt - 1)));
      }
    }
  }

  throw lastError;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const manifestPath = path.resolve(cwd, args.manifest);
  const outputRoot = path.resolve(cwd, args.outputRoot);
  const apiKey = process.env.KIE_API_KEY;

  if (!apiKey) {
    throw new Error('Missing KIE_API_KEY in environment/.env');
  }

  const manifest = await loadManifest(manifestPath);
  const selectedSections = filterSections(manifest.items, args.startVerse, args.endVerse);

  if (selectedSections.length === 0) {
    throw new Error('No matching sections found for the provided verse range');
  }

  const jobs = [];
  for (const section of selectedSections) {
    for (const imageJob of section.image_jobs || []) {
      jobs.push({ section, imageJob });
    }
  }

  if (jobs.length === 0) {
    throw new Error('Selected sections have no image jobs');
  }

  console.log(`Manifest path: ${toPosixPath(path.relative(cwd, manifestPath))}`);
  console.log(`Output root: ${toPosixPath(path.relative(cwd, outputRoot))}`);
  console.log(`Total sections: ${manifest.items.length}`);
  console.log(`Selected sections: ${selectedSections.length}`);
  console.log(`Image jobs: ${jobs.length}`);
  if (args.overwrite) {
    console.log('Overwrite: all targets');
  } else if (args.overwriteBook || args.overwriteYoutube) {
    const scopes = [];
    if (args.overwriteBook) scopes.push('book');
    if (args.overwriteYoutube) scopes.push('youtube');
    console.log(`Overwrite: ${scopes.join(', ')}`);
  }
  if (args.dryRun) console.log('Dry run: enabled');

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < jobs.length; i += 1) {
    const { section, imageJob } = jobs[i];
    const targetPath = path.join(outputRoot, imageJob.output_relpath);
    const targetRel = toPosixPath(path.relative(cwd, targetPath));
    const progress = `[${i + 1}/${jobs.length}]`;
    const targetKind = String(imageJob.target || '').toLowerCase();

    const overwriteForThisTarget =
      args.overwrite
      || (args.overwriteBook && targetKind === 'book')
      || (args.overwriteYoutube && targetKind === 'youtube');

    const existingByStem = await findExistingByStem(targetPath);
    if (existingByStem && !overwriteForThisTarget) {
      console.log(
        `${progress} skipping existing ${toPosixPath(path.relative(cwd, existingByStem))} (stem match)`
      );
      skipped += 1;
      continue;
    }

    console.log(`${progress} generating ${targetRel}`);

    if (args.dryRun) {
      generated += 1;
      continue;
    }

    try {
      const prompt = buildPrompt(manifest, section, imageJob);
      const taskId = await createTask(apiKey, prompt);
      const resultUrl = await waitForTask(apiKey, taskId);
      const buffer = await downloadBufferWithRetry(resultUrl);

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, buffer);
      generated += 1;
    } catch (error) {
      failed += 1;
      console.error(`${progress} failed ${targetRel} -> ${error.message}`);
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
