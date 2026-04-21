import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    input: 'simplified',
    output: path.join('image_prompts', 'sections-manifest.json'),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    if (key === 'input') args.input = value;
    else if (key === 'output') args.output = value;
    else throw new Error(`Unknown argument: --${key}`);

    i += 1;
  }

  return args;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function stripInlineMarkup(value) {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, ''));
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractFrontMatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontMatter: {}, body: raw };
  }

  const frontMatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    frontMatter[key] = value;
  }

  return {
    frontMatter,
    body: raw.slice(match[0].length),
  };
}

function deriveChapterSlug(frontMatter, relFile) {
  const sidebar = frontMatter.sidebar_label || '';
  const title = frontMatter.title || '';

  const numberedSidebar = sidebar.match(/^(\d+(?:\.\d+)+)\b/);
  if (numberedSidebar) return numberedSidebar[1];

  const numberedTitle = title.match(/^(\d+(?:\.\d+)+)\b/);
  if (numberedTitle) return numberedTitle[1];

  const basename = path.basename(relFile, path.extname(relFile)).toLowerCase();
  return (sidebar || title || basename)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractVersesFromBlock(block) {
  const verses = [];
  const verseRegex = /<p\s+id="([^"]+)"\s+className="verse">([\s\S]*?)<\/p>/g;

  for (const match of block.matchAll(verseRegex)) {
    const verseId = match[1];
    const inner = match[2];
    const numMatch = inner.match(/<span\s+className="verse-num">([^<]+)<\/span>/);
    const anchorCloseMatch = inner.match(/<\/a>/);
    if (!numMatch || !anchorCloseMatch) continue;

    const textStart = (anchorCloseMatch.index ?? 0) + anchorCloseMatch[0].length;
    const verseTextRaw = inner.slice(textStart);

    verses.push({
      verse_id: verseId,
      verse_number: normalizeWhitespace(numMatch[1]),
      verse_text: decodeEntities(stripInlineMarkup(verseTextRaw)),
    });
  }

  return verses;
}

function buildRangeFilename(start, end, suffix = '') {
  const core = start === end ? `${start}` : `${start}-${end}`;
  return `${core}${suffix}.jpg`;
}

function buildBasePrompt(imageType, sectionTitle) {
  return `create a 16x9 ${imageType} image for the following content. The title should read "${sectionTitle}".`;
}

function parseH2Sections(body) {
  const lines = body.split(/\r?\n/);
  const h2Regex = /^##(?!#)\s+(.+)$/;
  const h2Headings = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(h2Regex);
    if (!match) continue;

    h2Headings.push({
      lineIndex: i,
      heading_text: normalizeWhitespace(match[1]),
      heading_level: 'h2',
    });
  }

  const sections = [];

  for (let i = 0; i < h2Headings.length; i += 1) {
    const current = h2Headings[i];
    const next = h2Headings[i + 1];
    const start = current.lineIndex;
    const endExclusive = next ? next.lineIndex : lines.length;
    const block = lines.slice(start, endExclusive).join('\n').trim();

    sections.push({
      heading_level: current.heading_level,
      heading_text: current.heading_text,
      content_prompt: block,
      verses: extractVersesFromBlock(block),
    });
  }

  return sections;
}

async function collectMarkdownFiles(rootAbs) {
  const files = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootAbs);
  return files;
}

async function ensureInputExists(inputAbs) {
  try {
    const stat = await fs.stat(inputAbs);
    if (!stat.isDirectory()) {
      throw new Error(`Input is not a directory: ${inputAbs}`);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`Input folder does not exist: ${inputAbs}`);
    }
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const inputAbs = path.resolve(cwd, args.input);
  const outputAbs = path.resolve(cwd, args.output);

  await ensureInputExists(inputAbs);

  const files = await collectMarkdownFiles(inputAbs);
  const items = [];
  let totalVerses = 0;

  for (const fileAbs of files) {
    const raw = await fs.readFile(fileAbs, 'utf8');
    const { frontMatter, body } = extractFrontMatter(raw);
    const relFromRoot = toPosixPath(path.relative(cwd, fileAbs));
    const relFromInput = toPosixPath(path.relative(inputAbs, fileAbs));
    const chapterTitle = frontMatter.title || path.basename(fileAbs);
    const chapterSlug = deriveChapterSlug(frontMatter, relFromInput);

    const sections = parseH2Sections(body);

    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i];
      if (section.verses.length === 0) {
        continue;
      }

      totalVerses += section.verses.length;
      const verseStart = section.verses[0].verse_number;
      const verseEnd = section.verses[section.verses.length - 1].verse_number;
      const verseIds = section.verses.map((v) => v.verse_id);

      items.push({
        source_file: relFromRoot,
        chapter_title: chapterTitle,
        chapter_slug: chapterSlug,
        section_index: i + 1,
        section_title: section.heading_text,
        section_heading_level: section.heading_level,
        verse_start: verseStart,
        verse_end: verseEnd,
        verse_ids: verseIds,
        verse_count: section.verses.length,
        content_prompt: section.content_prompt,
        image_jobs: [
          {
            target: 'book',
            image_type: 'infographic',
            base_prompt: buildBasePrompt('infographic', section.heading_text),
            output_relpath: `img/${buildRangeFilename(verseStart, verseEnd)}`,
          },
          {
            target: 'youtube',
            image_type: 'YouTube-optimized thumbnail',
            base_prompt: buildBasePrompt('YouTube-optimized thumbnail', section.heading_text),
            output_relpath: `img/${buildRangeFilename(verseStart, verseEnd, '-youtube')}`,
          },
        ],
      });
    }
  }

  const manifest = {
    source_root: toPosixPath(args.input),
    total_files: files.length,
    total_sections: items.length,
    total_verses: totalVerses,
    base_prompt_shared: 'Any visuals depicting God should be non-human and abstract, but the words "non-human and abstract" should NOT be shown in the image.',
    items,
  };

  await fs.mkdir(path.dirname(outputAbs), { recursive: true });
  await fs.writeFile(outputAbs, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Input root: ${toPosixPath(args.input)}`);
  console.log(`Total files: ${files.length}`);
  console.log(`Total sections: ${items.length}`);
  console.log(`Total verses: ${totalVerses}`);
  console.log(`Output: ${toPosixPath(path.relative(cwd, outputAbs))}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
