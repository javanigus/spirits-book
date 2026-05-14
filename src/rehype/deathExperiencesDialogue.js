const HIDDEN_LABEL_VARIANTS = new Map([
  ['Background', 'death-line--background'],
  ['Narration', 'death-line--narration'],
]);

const SPEAKER_TONE_CLASSES = [
  'death-label--tone-1',
  'death-label--tone-2',
  'death-label--tone-3',
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

export default function deathExperiencesDialogue() {
  return (tree) => {
    const toneBySpeaker = new Map();
    let toneIndex = 0;

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
