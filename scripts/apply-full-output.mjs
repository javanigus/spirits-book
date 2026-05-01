import fs from 'fs/promises';
import path from 'path';

const root = process.cwd();
const sourceDir = path.join(root, 'output_consistency');
const targetDir = path.join(root, 'full');

function zeroPad(value) {
  return String(value).padStart(2, '0');
}

async function mapSourceToTarget(filename) {
  if (filename === 'Conclusion.md') {
    return path.join(targetDir, 'Conclusion.md');
  }

  const match = filename.match(/^Part\s+(\d+)\s+chapter\s+(\d+)\.md$/i);
  if (!match) {
    throw new Error(`Unrecognized chapter filename: ${filename}`);
  }

  const part = Number(match[1]);
  const chapter = Number(match[2]);
  const partDir = path.join(targetDir, `part-${part}`);
  const entries = await fs.readdir(partDir, { withFileTypes: true });
  const chapterSuffix = `chapter-${zeroPad(chapter)}.md`;
  const matchEntry = entries.find(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(chapterSuffix.toLowerCase())
  );
  if (!matchEntry) {
    throw new Error(`Could not locate target chapter file for Part ${part} chapter ${chapter}`);
  }
  return path.join(partDir, matchEntry.name);
}

function extractFrontMatter(text) {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? match[0] : '';
}

function adaptBody(text) {
  let body = text.replace(/^##\s+.+?\r?\n\r?\n/, '');
  body = body.replace(/^#####\s+/gm, '__H5__ ');
  body = body.replace(/^####\s+/gm, '__H4__ ');
  body = body.replace(/^###\s+/gm, '__H3__ ');
  body = body.replace(/^__H5__\s+/gm, '#### ');
  body = body.replace(/^__H4__\s+/gm, '### ');
  body = body.replace(/^__H3__\s+/gm, '## ');
  return body.trimStart();
}

async function main() {
  const sourceEntries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of sourceEntries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = await mapSourceToTarget(entry.name);

    const [sourceText, existingTargetText] = await Promise.all([
      fs.readFile(sourcePath, 'utf8'),
      fs.readFile(targetPath, 'utf8'),
    ]);

    const frontMatter = extractFrontMatter(existingTargetText);
    if (!frontMatter) {
      throw new Error(`Missing front matter in target file: ${targetPath}`);
    }

    const adapted = `${frontMatter}\n${adaptBody(sourceText)}`;
    await fs.writeFile(targetPath, adapted, 'utf8');
    console.log(`UPDATED ${path.relative(root, targetPath)}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
