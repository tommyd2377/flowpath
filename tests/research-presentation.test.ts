import assert from 'node:assert/strict';
import test from 'node:test';
import { compactResearchText } from '../lib/research-presentation';

test('short research remains exact and needs no disclosure', () => {
  assert.deepEqual(compactResearchText('A complete qualified finding.'), { text: 'A complete qualified finding.', shortened: false });
});

test('long previews end at a sentence or word boundary and signal more text', () => {
  const text = 'This is a complete sentence. Another sentence contains a qualification that must stay in the original research.';
  assert.deepEqual(compactResearchText(text, 40), { text: 'This is a complete sentence.…', shortened: true });
  const preview = compactResearchText('A longer single sentence needs several words before it reaches its closing condition.', 30);
  assert.equal(preview.text, 'A longer single sentence…');
  assert.ok(preview.text.length <= 30);
});

test('a preview never cuts a Unicode code point or replaces the original research', () => {
  const original = `${'🌊'.repeat(25)} The final qualifier is still available in full.`;
  assert.deepEqual(compactResearchText(original, 8), { text: `${'🌊'.repeat(7)}…`, shortened: true });
  assert.ok(original.endsWith('The final qualifier is still available in full.'));
  assert.throws(() => compactResearchText(original, 1));
});
