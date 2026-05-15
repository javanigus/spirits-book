import fs from 'node:fs';

const HIDDEN_LABEL_VARIANTS = new Map([
  ['Background', 'death-line--background'],
  ['Narration', 'death-line--narration'],
]);

const SPEAKER_TONE_CLASSES = [
  'death-label--tone-1',
  'death-label--tone-2',
  'death-label--tone-3',
];

const DEFAULT_SPEAKER_LABELS = [
  'Allan',
  'Medium',
  'Mediums’ Guide',
  "Mediums' Guide",
];

function visit(node, callback) {
  if (!node || typeof node !== 'object') {
    return;
  }

  callback(node);

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      visit(child, callback);
    }
  }
}

function normalizeClassName(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return [...value];
  }

  return [value];
}

function addClasses(node, ...classes) {
  node.properties ||= {};
  const className = normalizeClassName(node.properties.className);

  for (const classItem of classes) {
    if (!className.includes(classItem)) {
      className.push(classItem);
    }
  }

  node.properties.className = className;
}

function createText(value) {
  return {type: 'text', value};
}

function createElement(tagName, classNames, children) {
  return {
    type: 'element',
    tagName,
    properties: {className: classNames},
    children,
  };
}

function normalizeLabel(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function stripOuterQuotes(value) {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function readSpeakerConfig(file) {
  const filePath = file?.path || file?.history?.[0];
  if (!filePath || !fs.existsSync(filePath)) {
    return {title: '', speakerLabels: []};
  }

  const source = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return {title: '', speakerLabels: []};
  }

  const lines = source.split(/\r?\n/);
  let title = '';
  const speakerLabels = [];
  let inSpeakerLabels = false;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === '---') {
      break;
    }

    const titleMatch = line.match(/^title:\s*(.+)$/);
    if (titleMatch) {
      title = stripOuterQuotes(titleMatch[1]);
      inSpeakerLabels = false;
      continue;
    }

    if (/^speaker_labels:\s*$/.test(line)) {
      inSpeakerLabels = true;
      continue;
    }

    if (inSpeakerLabels) {
      const speakerMatch = line.match(/^\s*-\s+(.+)$/);
      if (speakerMatch) {
        speakerLabels.push(stripOuterQuotes(speakerMatch[1]));
        continue;
      }

      if (/^\S/.test(line)) {
        inSpeakerLabels = false;
      }
    }
  }

  return {title, speakerLabels};
}

export default function deathExperiencesDialogue() {
  return (tree, file) => {
    const toneBySpeaker = new Map();
    let toneIndex = 0;
    const {title, speakerLabels} = readSpeakerConfig(file);
    const allowedLabels = new Set(
      [...DEFAULT_SPEAKER_LABELS, title, ...speakerLabels]
        .filter(Boolean)
        .map(normalizeLabel),
    );

    visit(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'p' || !Array.isArray(node.children) || node.children.length === 0) {
        return;
      }

      const firstChild = node.children[0];
      if (!firstChild || firstChild.type !== 'text' || typeof firstChild.value !== 'string') {
        return;
      }

      const match = firstChild.value.match(/^([^:\n]{1,80}):\s*/);
      if (!match) {
        return;
      }

      const label = match[1].trim();
      const remainingText = firstChild.value.slice(match[0].length);
      const remainingChildren = [...node.children];

      if (remainingText) {
        remainingChildren[0] = {...firstChild, value: remainingText};
      } else {
        remainingChildren.shift();
      }

      addClasses(node, 'death-line');

      if (HIDDEN_LABEL_VARIANTS.has(label)) {
        addClasses(node, HIDDEN_LABEL_VARIANTS.get(label));
        node.children = remainingChildren;
        return;
      }

      if (!allowedLabels.has(normalizeLabel(label))) {
        return;
      }

      if (!toneBySpeaker.has(label)) {
        toneBySpeaker.set(label, SPEAKER_TONE_CLASSES[toneIndex % SPEAKER_TONE_CLASSES.length]);
        toneIndex += 1;
      }

      const labelNode = createElement('span', ['death-label', toneBySpeaker.get(label)], [createText(label)]);
      const children = [labelNode];

      if (remainingChildren.length > 0) {
        children.push(createElement('span', ['death-text'], remainingChildren));
      }

      addClasses(node, 'death-line--speaker');
      node.children = children;
    });
  };
}
