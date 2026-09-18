// Minimal, dependency-free XML reader. It only has to survive whatever shape the
// station happens to publish, so it is deliberately forgiving: unknown doctypes,
// processing instructions, comments and stray "<" in text are skipped rather than
// treated as errors.

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function makeNode(name, attrs) {
  return { name, attrs, children: [], text: '' };
}

function parseAttrs(source) {
  const attrs = {};
  const re = /([^\s=/<>"']+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`]+))/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    attrs[match[1]] = decodeEntities(value);
  }
  return attrs;
}

// The end of a tag, ignoring ">" that sits inside a quoted attribute value.
function findTagEnd(source, start) {
  let quote = null;
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return -1;
}

export function parseXml(source) {
  const text = String(source ?? '').replace(/^﻿/, '');
  const root = makeNode('#document', {});
  const stack = [root];
  let index = 0;

  const addText = (chunk, literal = false) => {
    if (!chunk) return;
    const value = literal ? chunk : decodeEntities(chunk);
    stack[stack.length - 1].text += value;
  };

  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) {
      addText(text.slice(index));
      break;
    }
    addText(text.slice(index, open));

    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open);
      index = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open);
      addText(text.slice(open + 9, end === -1 ? text.length : end), true);
      index = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith('<!', open)) {
      const end = text.indexOf('>', open);
      index = end === -1 ? text.length : end + 1;
      continue;
    }

    const close = findTagEnd(text, open);
    if (close === -1) {
      addText(text.slice(open));
      break;
    }

    const inner = text.slice(open + 1, close).trim();
    index = close + 1;
    if (!inner) continue;

    if (inner[0] === '/') {
      const name = inner.slice(1).trim();
      // Close the matching element, tolerating tags that were never closed.
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].name.toLowerCase() === name.toLowerCase()) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1).trim() : inner;
    const nameMatch = /^[^\s/>]+/.exec(body);
    if (!nameMatch) continue;

    const node = makeNode(nameMatch[0], parseAttrs(body.slice(nameMatch[0].length)));
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }

  return root;
}

/** Text of this node and everything below it. */
export function textOf(node) {
  return node.children.reduce((acc, child) => acc + textOf(child), node.text);
}

export function walk(node, visit) {
  for (const child of node.children) {
    visit(child);
    walk(child, visit);
  }
}
