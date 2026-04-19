import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    i += 1;
  }

  return {
    input: args.input || 'simplified',
    output: args.output || path.join('tts_manifest', 'simplified.json'),
  };
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

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function ensureDirectoryExists(dirPath, label) {
  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`${label} is not a directory: ${dirPath}`);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`${label} does not exist: ${dirPath}`);
    }
    throw error;
  }
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

function parseContentTokens(body) {
  const tokens = [];
  const headingRegex = /^(#{2,4})(?!#)\s+(.+)$/gm;
  const verseRegex = /<p\s+id="([^"]+)"\s+className="verse">([\s\S]*?)<\/p>/g;

  for (const match of body.matchAll(headingRegex)) {
    const level = `h${match[1].length}`;
    tokens.push({
      type: 'heading',
      index: match.index ?? 0,
      heading_level: level,
      heading_text: normalizeWhitespace(match[2]),
    });
  }

  for (const match of body.matchAll(verseRegex)) {
    const verseId = match[1];
    const block = match[2];
    const numMatch = block.match(/<span\s+className="verse-num">([^<]+)<\/span>/);
    const anchorCloseMatch = block.match(/<\/a>/);
    if (!numMatch || !anchorCloseMatch) continue;

    const textStart = (anchorCloseMatch.index ?? 0) + anchorCloseMatch[0].length;
    const verseTextRaw = block.slice(textStart);
    const verseText = decodeEntities(stripInlineMarkup(verseTextRaw));

    tokens.push({
      type: 'verse',
      index: match.index ?? 0,
      verse_id: verseId,
      verse_number: normalizeWhitespace(numMatch[1]),
      verse_text: verseText,
    });
  }

  tokens.sort((a, b) => a.index - b.index);
  return tokens;
}

function deriveChapterSlug(frontMatter) {
  const sidebar = frontMatter.sidebar_label || '';
  const title = frontMatter.title || '';

  const numberedSidebar = sidebar.match(/^(\d+(?:\.\d+)+)\b/);
  if (numberedSidebar) return numberedSidebar[1];

  const numberedTitle = title.match(/^(\d+(?:\.\d+)+)\b/);
  if (numberedTitle) return numberedTitle[1];

  return (sidebar || title || 'chapter')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getHeadingPause(level) {
  if (level === 'h2') return '1200ms';
  if (level === 'h3') return '800ms';
  if (level === 'h4') return '600ms';
  return null;
}

function buildOutputRelPath(fileRelativeFromInput, verseStart, verseEnd) {
  const normalized = toPosixPath(fileRelativeFromInput);
  const partMatch = normalized.match(/^(part-[^/]+)\//);
  const baseFolder = partMatch
    ? partMatch[1]
    : path.basename(normalized, path.extname(normalized)).toLowerCase();

  const name = verseStart === verseEnd ? `${verseStart}.mp3` : `${verseStart}-${verseEnd}.mp3`;
  return `${baseFolder}/${name}`;
}

function buildTtsFields(headingText, headingLevel, verses) {
  const verseTexts = verses.map((v) => v.verse_text);
  const plain = headingText
    ? `${headingText}. ${verseTexts.join(' ')}`
    : verseTexts.join(' ');

  const ssmlParts = ['<speak>'];

  if (headingText) {
    ssmlParts.push(`${escapeXml(headingText)}.`);
    const pause = getHeadingPause(headingLevel);
    if (pause) {
      ssmlParts.push(`<break time="${pause}"/>`);
    }
  }

  verses.forEach((verse, idx) => {
    ssmlParts.push(` ${escapeXml(verse.verse_text)}`);
    if (idx < verses.length - 1) {
      ssmlParts.push('<break time="350ms"/>');
    }
  });

  ssmlParts.push('</speak>');

  return {
    tts_text: plain,
    tts_ssml: ssmlParts.join('').trim(),
  };
}

function buildSectionItemsForFile({
  fileAbs,
  fileRelativeFromRoot,
  fileRelativeFromInput,
  frontMatter,
  body,
}) {
  const tokens = parseContentTokens(body);
  const sections = [];

  let activeH2 = null;
  let activeH3 = null;
  let activeH4 = null;
  let currentSection = null;
  let sectionIndex = 0;

  const sourceFile = toPosixPath(fileRelativeFromRoot);
  const bookTitle = frontMatter.title || path.basename(fileAbs);
  const chapterSlug = deriveChapterSlug(frontMatter);

  const startSection = (headingLevel, headingText) => {
    sectionIndex += 1;
    currentSection = {
      source_file: sourceFile,
      book_title: bookTitle,
      chapter_slug: chapterSlug,
      heading_level: headingLevel,
      heading_text: headingText,
      section_index: sectionIndex,
      verses: [],
    };
    sections.push(currentSection);
  };

  for (const token of tokens) {
    if (token.type === 'heading') {
      if (token.heading_level === 'h2') {
        activeH2 = token.heading_text;
        activeH3 = null;
        activeH4 = null;
      } else if (token.heading_level === 'h3') {
        activeH3 = token.heading_text;
        activeH4 = null;
      } else if (token.heading_level === 'h4') {
        activeH4 = token.heading_text;
      }

      const nearestText = activeH4 || activeH3 || activeH2;
      const nearestLevel = activeH4 ? 'h4' : activeH3 ? 'h3' : 'h2';
      startSection(nearestLevel, nearestText);
      continue;
    }

    if (!currentSection) {
      startSection(null, null);
    }

    currentSection.verses.push({
      verse_id: token.verse_id,
      verse_number: token.verse_number,
      verse_text: token.verse_text,
    });
  }

  const items = [];

  for (const section of sections) {
    if (section.verses.length === 0) continue;

    const verseNumbers = section.verses.map((v) => v.verse_number);
    const verseIds = section.verses.map((v) => v.verse_id);
    const verseStart = verseNumbers[0];
    const verseEnd = verseNumbers[verseNumbers.length - 1];
    const { tts_text, tts_ssml } = buildTtsFields(section.heading_text, section.heading_level, section.verses);

    items.push({
      source_file: section.source_file,
      book_title: section.book_title,
      chapter_slug: section.chapter_slug,
      heading_level: section.heading_level,
      heading_text: section.heading_text,
      section_index: section.section_index,
      verse_start: verseStart,
      verse_end: verseEnd,
      verse_ids: verseIds,
      verse_numbers: verseNumbers,
      verse_count: section.verses.length,
      verses: section.verses,
      tts_text,
      tts_ssml,
      output_relpath: buildOutputRelPath(fileRelativeFromInput, verseStart, verseEnd),
    });
  }

  return items;
}

async function collectMarkdownFiles(inputAbs) {
  const files = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
        files.push(fullPath);
      }
    }
  }

  await walk(inputAbs);
  return files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const inputAbs = path.resolve(cwd, args.input);
  const outputAbs = path.resolve(cwd, args.output);

  await ensureDirectoryExists(inputAbs, 'Input folder');

  const files = await collectMarkdownFiles(inputAbs);
  const items = [];

  for (const fileAbs of files) {
    const raw = await fs.readFile(fileAbs, 'utf8');
    const { frontMatter, body } = extractFrontMatter(raw);

    const fileRelativeFromRoot = path.relative(cwd, fileAbs);
    const fileRelativeFromInput = path.relative(inputAbs, fileAbs);

    const fileItems = buildSectionItemsForFile({
      fileAbs,
      fileRelativeFromRoot,
      fileRelativeFromInput,
      frontMatter,
      body,
    });

    items.push(...fileItems);
  }

  const totalVerses = items.reduce((sum, item) => sum + item.verse_count, 0);
  if (totalVerses === 0) {
    throw new Error(`No verses found under input folder: ${args.input}`);
  }

  const manifest = {
    source_root: toPosixPath(args.input),
    total_files: files.length,
    total_sections: items.length,
    total_verses: totalVerses,
    items,
  };

  await fs.mkdir(path.dirname(outputAbs), { recursive: true });
  await fs.writeFile(outputAbs, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Input root: ${toPosixPath(args.input)}`);
  console.log(`Total files processed: ${files.length}`);
  console.log(`Total sections found: ${items.length}`);
  console.log(`Total verses found: ${totalVerses}`);
  console.log(`Output path: ${toPosixPath(path.relative(cwd, outputAbs))}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
