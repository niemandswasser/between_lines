import test from 'node:test';
import assert from 'node:assert/strict';
import { writingInput, decodeWriting, addWriting, editWriting, removeWriting } from '../src/writing.mjs';
import { integrate } from '../src/core.mjs';
const topic = { id: 'topic-1', name: 'The Grey Watch', category: 'faction', definition: 'A city guard.', details: 'The guard protects the harbor.', knowledge: '', aliases: [], related: [], firstSeen: 0, updated: 0, facts: [{ text: 'The guard protects the harbor.', kind: 'chat', source: 0 }] };
const history = [{ mes: 'The guard protects the harbor.', extra: {} }];
const input = writingInput(history, 0, topic, { language: 'en' }, { form: 'letter', request: 'A tired guard writes home.' });
const sample = extra => ({ articleId: topic.id, form: 'letter', title: 'After the Third Bell', byline: 'From an unsent letter by a night guard', body: 'Mother, I still count the boats before the evening bell. The harbor grows quiet, and the lamps keep the wet stones warm in my imagination.\n\nI will write again when my shift ends.', ...extra });

test('writing input follows output language and never includes private notes or unrelated articles', () => {
  const request = writingInput(history, 0, topic, { language: 'custom', customLanguage: 'Turkish', notes: { secret: 'Private thoughts' }, favorites: ['secret'] });
  assert.equal(request.profile.outputLanguage, 'Turkish'); assert.equal(request.topic.id, topic.id);
  assert.equal(JSON.stringify(request).includes('Private thoughts'), false); assert.equal(request.form, 'auto');
});
test('complete multi-paragraph prose and attribution survive strict JSON parsing', () => {
  const page = decodeWriting(JSON.stringify(sample()), input);
  assert.equal(page.body, sample().body); assert.equal(page.byline, sample().byline); assert.equal(page.language, 'English');
});
test('wrong topic, wrong form, malformed JSON, and oversized prose are rejected', () => {
  assert.throws(() => decodeWriting('invalid', input), /JSON/);
  assert.throws(() => decodeWriting(JSON.stringify(sample({ articleId: 'wrong' })), input), /другую статью/);
  assert.throws(() => decodeWriting(JSON.stringify(sample({ form: 'diary' })), input), /форму/);
  assert.throws(() => decodeWriting(JSON.stringify(sample({ body: 'x'.repeat(18001) })), input), /body/);
  assert.throws(() => decodeWriting(JSON.stringify(sample({ form: '__proto__' })), input), /форма/);
});
test('adding a page preserves reference facts and previous snapshots; duplicate prose is not appended', () => {
  const page = decodeWriting(JSON.stringify(sample()), input), known = [structuredClone(topic)];
  const result = addWriting(known, topic.id, page, 0);
  assert.equal(known[0].pages, undefined); assert.deepEqual(result.articles[0].facts, topic.facts);
  assert.equal(result.articles[0].pages[0].body, sample().body);
  assert.equal(addWriting(result.articles, topic.id, page, 0).added, false);
});
test('ordinary collection retains all literary pages without treating them as new facts', () => {
  const page = decodeWriting(JSON.stringify(sample()), input), known = addWriting([topic], topic.id, page, 0).articles;
  const updated = integrate(known, { articles: [{ ...topic, definition: 'An updated guard definition.' }], terms: [topic.name] }, 1);
  assert.deepEqual(updated.articles[0].pages, known[0].pages); assert.deepEqual(updated.articles[0].facts, topic.facts);
});
test('the document limit rejects updates instead of discarding earlier pages', () => {
  const page = decodeWriting(JSON.stringify(sample()), input);
  const full = [{ ...topic, pages: Array.from({ length: 12 }, (_, i) => ({ ...page, body: page.body + i })) }];
  assert.throws(() => addWriting(full, topic.id, page, 0), /12/); assert.equal(full[0].pages.length, 12);
});
test('an explicit skip is returned without inventing a page', () => {
  assert.deepEqual(decodeWriting('{"skip":true,"reason":"Not enough grounded detail."}', input), { skip: true, reason: 'Not enough grounded detail.' });
});

test('manual editing preserves the stable page ID, prior snapshots, sibling pages, and article facts', () => {
  const page = decodeWriting(JSON.stringify(sample()), input);
  const first = addWriting([topic], topic.id, page, 0).articles;
  const second = addWriting(first, topic.id, { ...page, body: page.body + ' Another page.' }, 0).articles;
  const id = second[0].pages[0].id;
  const next = editWriting(second, topic.id, id, { title: 'Edited title', byline: '', form: 'diary', body: 'A shorter manual entry.' });
  assert.equal(next[0].pages[0].id, id); assert.equal(next[0].pages[0].manual, true);
  assert.equal(next[0].pages[0].body, 'A shorter manual entry.'); assert.equal(next[0].pages[0].byline, '');
  assert.deepEqual(next[0].facts, topic.facts); assert.deepEqual(next[0].pages[1], second[0].pages[1]);
  assert.equal(second[0].pages[0].body, page.body);
});

test('regenerating original prose after a manual edit creates a separately addressable page', () => {
  const page = decodeWriting(JSON.stringify(sample()), input);
  const known = addWriting([topic], topic.id, page, 0).articles, id = known[0].pages[0].id;
  const edited = editWriting(known, topic.id, id, { ...page, body: 'A manually rewritten page.' });
  const regenerated = addWriting(edited, topic.id, page, 0).articles;
  assert.equal(new Set(regenerated[0].pages.map(item => item.id)).size, 2);
  const remaining = removeWriting(regenerated, topic.id, id);
  assert.equal(remaining[0].pages.length, 1); assert.equal(remaining[0].pages[0].body, page.body);
});

test('manual edit validation rejects empty, oversized, unknown-form, and duplicate changes', () => {
  const page = decodeWriting(JSON.stringify(sample()), input), known = addWriting([topic], topic.id, page, 0).articles;
  const id = known[0].pages[0].id, values = { title: 'Edited', byline: '', form: 'diary', body: 'Body' };
  assert.throws(() => editWriting(known, topic.id, id, { ...values, title: '' }), /title/);
  assert.throws(() => editWriting(known, topic.id, id, { ...values, body: 'x'.repeat(18001) }), /body/);
  assert.throws(() => editWriting(known, topic.id, id, { ...values, form: '__proto__' }), /форму/);
  assert.throws(() => editWriting(known, topic.id, 'missing', values), /недоступна/);
  const second = addWriting(known, topic.id, { ...page, body: page.body + ' More.' }, 0).articles;
  assert.throws(() => editWriting(second, topic.id, second[0].pages[1].id, { ...page }), /уже есть/);
});

test('deleting a page leaves its article and sibling pages; deleting the last page stays empty after collection', () => {
  const page = decodeWriting(JSON.stringify(sample()), input), known = addWriting([topic], topic.id, page, 0).articles;
  const id = known[0].pages[0].id;
  const second = addWriting(known, topic.id, { ...page, body: page.body + ' Another.' }, 0).articles;
  const next = removeWriting(second, topic.id, id);
  assert.equal(next[0].pages.length, 1); assert.deepEqual(next[0].facts, topic.facts);
  assert.equal(second[0].pages.length, 2);
  const empty = removeWriting(next, topic.id, next[0].pages[0].id);
  const updated = integrate(empty, { articles: [topic], terms: [topic.name] }, 1);
  assert.deepEqual(updated.articles[0].pages, []);
  assert.throws(() => removeWriting(empty, topic.id, 'missing'), /недоступна/);
});
