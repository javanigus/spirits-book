import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    i += 1;
  }

  if (!args.input || !args.output) {
    throw new Error('Required flags: --input and --output');
  }

  return args;
}

function extractFrontMatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontMatter: {}, body: raw };
  }

  const frontMatter = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) {
      continue;
    }

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    frontMatter[key] = value;
  }

  return {
    frontMatter,
    body: raw.slice(match[0].length),
  };
}

function parseHeadings(body) {
  const headings = [];
  const h2Regex = /^##(?!#)\s+(.+)$/gm;
  const h3Regex = /^###(?!#)\s+(.+)$/gm;

  for (const match of body.matchAll(h2Regex)) {
    headings.push({ level: 'h2', title: match[1].trim(), index: match.index ?? 0 });
  }

  for (const match of body.matchAll(h3Regex)) {
    headings.push({ level: 'h3', title: match[1].trim(), index: match.index ?? 0 });
  }

  headings.sort((a, b) => a.index - b.index);
  return headings;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function stripInlineMarkup(value) {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, ''));
}

function parseVerses(body) {
  const verseRegex = /<p\s+id="([^"]+)"\s+className="verse">([\s\S]*?)<\/p>/g;
  const verseNumberRegex = /<span\s+className="verse-num">([^<]+)<\/span>/;
  const anchorCloseRegex = /<\/a>/;

  const verses = [];

  for (const match of body.matchAll(verseRegex)) {
    const id = match[1];
    const block = match[2];
    const verseNumberMatch = block.match(verseNumberRegex);
    const anchorCloseMatch = block.match(anchorCloseRegex);

    if (!verseNumberMatch || !anchorCloseMatch) {
      continue;
    }

    const verseNumber = normalizeWhitespace(verseNumberMatch[1]);
    const textStart = anchorCloseMatch.index + anchorCloseMatch[0].length;
    const textRaw = block.slice(textStart);
    const verseText = stripInlineMarkup(textRaw);

    verses.push({
      verse_id: id,
      verse_number: verseNumber,
      verse_text: verseText,
      index: match.index ?? 0,
    });
  }

  return verses;
}

function getHeadingContext(headings, verseIndex) {
  let currentH2 = null;
  let currentH3 = null;

  for (const heading of headings) {
    if (heading.index > verseIndex) {
      break;
    }

    if (heading.level === 'h2') {
      currentH2 = heading.title;
      currentH3 = null;
    } else {
      currentH3 = heading.title;
    }
  }

  return { h2: currentH2, h3: currentH3 };
}

function splitIntoSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function summarizeSection(verseTexts) {
  if (verseTexts.length === 0) {
    return 'This section introduces core ideas from the chapter.';
  }

  if (verseTexts.length === 1) {
    const one = splitIntoSentences(verseTexts[0])[0] || verseTexts[0];
    return one;
  }

  const firstSentence = splitIntoSentences(verseTexts[0])[0] || verseTexts[0];
  const secondSentence = splitIntoSentences(verseTexts[1])[0] || verseTexts[1];

  return `${firstSentence} ${secondSentence}`;
}

function parseVerseNumber(value) {
  if (!/^\d+(?:\.\d+)+$/.test(value)) {
    throw new Error(`Invalid verse number format: ${value}`);
  }

  return value.split('.').map((n) => Number.parseInt(n, 10));
}

function compareVerseNumber(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
  }

  return 0;
}

function chooseSpiritState(verseText) {
  const lower = verseText.toLowerCase();

  const lowerSpiritHints = ['inferior', 'impure', 'evil', 'malicious', 'vice', 'dark'];
  const higherSpiritHints = ['pure spirit', 'superior', 'elevated', 'perfect', 'higher'];

  if (lowerSpiritHints.some((hint) => lower.includes(hint))) {
    return 'lower-level spirit silhouette with dark ruby glow and dim, heavier aura';
  }

  if (higherSpiritHints.some((hint) => lower.includes(hint))) {
    return 'high-level spirit silhouette with bright white and subtle warm-gold glow';
  }

  if (lower.includes('spirit')) {
    return 'mid-level spirit silhouette with soft white glow and semi-transparent calm form';
  }

  return null;
}

function buildImagePrompt({ chapterTitle, sectionTitle, sectionSummary, verseText }) {
  const spiritState = chooseSpiritState(verseText);
  const spiritLine = spiritState
    ? `Include ${spiritState} based on the verse meaning.`
    : 'Do not force visible spirits if the verse does not require them.';

  return [
    'Create a minimalist educational infographic diagram with a dark charcoal or deep navy background, balanced spacing, simple geometric forms, soft gradients, subtle glow, clear hierarchy, and no visual clutter.',
    'No photorealism, no painterly rendering, no horror styling, and no religious symbols unless directly required by the verse.',
    `Chapter context: ${chapterTitle}.`,
    `Section: ${sectionTitle}.`,
    `Section summary: ${sectionSummary}.`,
    `Verse concept: ${verseText}.`,
    spiritLine,
    'Keep it suitable for educational use and later video adaptation; avoid text labels unless relational labeling is essential.',
  ].join(' ');
}

function getChapterSlug(chapterTitle) {
  const match = chapterTitle.match(/^\d+(?:\.\d+)*/);
  return match ? match[0] : chapterTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildSections(versesWithContext) {
  const h2Map = new Map();

  for (const verse of versesWithContext) {
    if (!verse.h2) {
      continue;
    }

    if (!h2Map.has(verse.h2)) {
      h2Map.set(verse.h2, { hasH3: false });
    }
    if (verse.h3) {
      h2Map.get(verse.h2).hasH3 = true;
    }
  }

  const sections = [];
  const byKey = new Map();

  for (const verse of versesWithContext) {
    const h2Info = verse.h2 ? h2Map.get(verse.h2) : null;
    const usesH3Sections = Boolean(h2Info?.hasH3);
    const sectionTitle = usesH3Sections ? verse.h3 || verse.h2 || 'Untitled Section' : verse.h2 || 'Untitled Section';
    const sectionLevel = usesH3Sections && verse.h3 ? 'h3' : 'h2';
    const key = `${sectionLevel}:${sectionTitle}`;

    if (!byKey.has(key)) {
      const section = {
        key,
        section_title: sectionTitle,
        section_heading_level: sectionLevel,
        verses: [],
      };
      byKey.set(key, section);
      sections.push(section);
    }

    byKey.get(key).verses.push(verse);
  }

  sections.forEach((section, idx) => {
    section.section_index = idx + 1;
    section.section_summary = summarizeSection(section.verses.map((v) => v.verse_text));
  });

  return sections;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const raw = await fs.readFile(args.input, 'utf8');
  const { frontMatter, body } = extractFrontMatter(raw);

  const chapterTitle = frontMatter.title || path.basename(args.input);
  const chapterSlug = getChapterSlug(chapterTitle);

  const headings = parseHeadings(body);
  const verses = parseVerses(body);

  if (verses.length === 0) {
    throw new Error('No verses were found in the input file.');
  }

  const versesWithContext = verses.map((verse) => {
    const context = getHeadingContext(headings, verse.index);
    return { ...verse, ...context, verse_key: parseVerseNumber(verse.verse_number) };
  });

  const sections = buildSections(versesWithContext);

  const firstVerse = versesWithContext[0].verse_key;
  const lastVerse = versesWithContext[versesWithContext.length - 1].verse_key;

  const startVerse = args['start-verse'] ? parseVerseNumber(args['start-verse']) : firstVerse;
  const endVerse = args['end-verse'] ? parseVerseNumber(args['end-verse']) : lastVerse;

  if (compareVerseNumber(startVerse, endVerse) > 0) {
    throw new Error('Invalid range: --start-verse must be <= --end-verse');
  }

  if (compareVerseNumber(startVerse, firstVerse) < 0 || compareVerseNumber(startVerse, lastVerse) > 0) {
    throw new Error(`--start-verse is out of range. Chapter range is ${versesWithContext[0].verse_number} to ${versesWithContext[versesWithContext.length - 1].verse_number}`);
  }

  if (compareVerseNumber(endVerse, firstVerse) < 0 || compareVerseNumber(endVerse, lastVerse) > 0) {
    throw new Error(`--end-verse is out of range. Chapter range is ${versesWithContext[0].verse_number} to ${versesWithContext[versesWithContext.length - 1].verse_number}`);
  }

  const selectedSections = [];

  for (const section of sections) {
    const selectedVerses = section.verses
      .filter((verse) => compareVerseNumber(verse.verse_key, startVerse) >= 0 && compareVerseNumber(verse.verse_key, endVerse) <= 0)
      .map((verse) => ({
        verse_id: verse.verse_id,
        verse_number: verse.verse_number,
        verse_text: verse.verse_text,
        image_type: 'infographic_diagram',
        image_prompt: buildImagePrompt({
          chapterTitle,
          sectionTitle: section.section_title,
          sectionSummary: section.section_summary,
          verseText: verse.verse_text,
        }),
      }));

    if (selectedVerses.length === 0) {
      continue;
    }

    selectedSections.push({
      section_index: section.section_index,
      section_title: section.section_title,
      section_heading_level: section.section_heading_level,
      section_summary: section.section_summary,
      verse_count: selectedVerses.length,
      verses: selectedVerses,
    });
  }

  const totalVersesProcessed = selectedSections.reduce((sum, section) => sum + section.verse_count, 0);
  if (totalVersesProcessed === 0) {
    throw new Error('No verses matched the requested range.');
  }

  const output = {
    source_file: args.input,
    chapter_title: chapterTitle,
    chapter_slug: chapterSlug,
    total_sections: sections.length,
    processed_verse_range: {
      start: args['start-verse'] || versesWithContext[0].verse_number,
      end: args['end-verse'] || versesWithContext[versesWithContext.length - 1].verse_number,
    },
    sections: selectedSections,
  };

  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Source file: ${args.input}`);
  console.log(`Total sections found: ${sections.length}`);
  console.log(`Processed verse range: ${output.processed_verse_range.start} to ${output.processed_verse_range.end}`);
  console.log(`Total verses processed: ${totalVersesProcessed}`);
  console.log(`Output path: ${args.output}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
