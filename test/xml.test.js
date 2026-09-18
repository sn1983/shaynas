import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeEntities, parseXml, textOf } from '../src/xml.js';

test('decodes named and numeric entities', () => {
  assert.equal(decodeEntities('AC&amp;DC &#65; &#x42; &unknown;'), 'AC&DC A B &unknown;');
});

test('reads attributes, CDATA and nesting', () => {
  const document = parseXml('<?xml version="1.0"?><a x="1 &gt; 0"><b><![CDATA[<raw> & co]]></b></a>');
  const [a] = document.children;
  assert.equal(a.name, 'a');
  assert.equal(a.attrs.x, '1 > 0');
  assert.equal(textOf(a), '<raw> & co');
});

test('survives comments, doctypes and an unclosed tag', () => {
  const document = parseXml('<!DOCTYPE x><!-- note --><a><b>one<c>two</a>');
  assert.equal(textOf(document).replace(/\s+/g, ''), 'onetwo');
  assert.equal(document.children.length, 1);
});
