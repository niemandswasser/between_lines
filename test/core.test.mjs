import test from 'node:test';
import assert from 'node:assert/strict';
import { STORE, preferences, collectionProfile, collectionInput, decodeCollection, integrate, readCodex, branchHashes, storeRecord, identity } from '../src/core.mjs';

const chat = () => [{ mes: 'Greeting.' }, { mes: 'What is the watch?', is_user: true }, { mes: 'The Grey Watch guards the gate.', swipe_id: 0, swipes: ['The Grey Watch guards the gate.', 'An empty street.'], extra: { extblocks: 'Other block data', unrelated: true } }];
const article = (extra = {}) => ({ name: 'Grey Watch', category: 'faction', aliases: [], definition: 'The city night guard.', details: 'The watch guards the gate after sunset.', knowledge: 'A local could recognize its uniforms.', facts: [{ text: 'The watch guards the gate.', kind: 'chat', source: 2 }], related: [], ...extra });
const input = (options = {}) => collectionInput(chat(), 2, [], options);
const raw = extra => JSON.stringify({ articles: [article(extra)], terms: ['Grey Watch'] });
const saved = (history, id, result, extra = {}) => ({ format: 1, branch: branchHashes(history)[id], swipe: history[id].swipe_id ?? 0, articles: result.articles, terms: result.terms, ...extra });

test('output language is independent from chat language and private preferences', () => {
  assert.equal(collectionProfile({}).outputLanguage, 'Russian');
  assert.equal(collectionProfile({ language: 'en' }).outputLanguage, 'English');
  assert.equal(collectionProfile({ language: 'custom', customLanguage: ' Turkish ' }).outputLanguage, 'Turkish');
  assert.equal(collectionProfile({ language: 'unknown' }).outputLanguage, 'Russian');
  assert.equal(collectionProfile({ language: 'custom' }).outputLanguage, 'Russian');
  const data = collectionInput(chat(), 2, [], { language: 'en', notes: { secret: 'Private journal' }, favorites: ['secret'] });
  assert.equal(data.profile.outputLanguage, 'English');
  assert.equal(JSON.stringify(data).includes('Private journal'), false);
  assert.equal('notes' in data.profile, false);
});
test('collection windows skip system and empty messages without clipping long text', () => {
  const history = [{ mes: 'Earlier' }, { mes: 'System', is_system: true }, { mes: '' }, { mes: 'x'.repeat(30000), is_user: true }, { mes: 'Latest' }];
  const data = collectionInput(history, 4, [], { window: 2 });
  assert.deepEqual(data.messages.map(m => m.id), [3, 4]);
  assert.equal(data.messages[0].text.length, 30000);
  assert.equal(preferences({ window: 500 }).window, 100);
  assert.equal(preferences({ window: -2 }).window, 1);
});
test('strict schema and genuine chat citations reject malformed model output', () => {
  assert.throws(() => decodeCollection('no json', input()), /JSON/);
  assert.throws(() => decodeCollection(JSON.stringify({ articles: [], terms: 'watch' }), input()), /terms/);
  assert.throws(() => decodeCollection(raw({ category: '__proto__' }), input()), /категория/);
  assert.throws(() => decodeCollection(raw({ facts: [{ text: 'Invented citation', kind: 'chat', source: 999 }] }), input()), /источник/);
  assert.throws(() => decodeCollection(raw({ facts: [] }), input()), /сведений/);
  assert.equal(decodeCollection('```json\n' + raw() + '\n```', input()).articles.length, 1);
});
test('canon and lorebook permissions are enforced independently', () => {
  const canon = raw({ facts: [{ text: 'Basic canon.', kind: 'canon', source: null }] });
  assert.throws(() => decodeCollection(canon, input()), /каноном/);
  assert.throws(() => decodeCollection(canon, input({ canon: true })), /каноном/);
  assert.equal(decodeCollection(canon, input({ canon: true, fandom: 'Example, first edition' })).articles[0].facts[0].source, null);
  const lore = raw({ facts: [{ text: 'A world-info fact.', kind: 'lorebook' }] });
  assert.throws(() => decodeCollection(lore, input({ lorebook: false })), /лорбука/);
  assert.equal(decodeCollection(lore, input()).articles[0].facts[0].kind, 'lorebook');
});
test('aliases and language changes preserve article identity without mutating earlier snapshots', () => {
  const first = integrate([], decodeCollection(raw(), input()), 2);
  const updated = integrate(first.articles, decodeCollection(raw({ name: 'Серый дозор', aliases: ['Grey Watch'], definition: 'Ночная стража города.' }), input()), 4);
  assert.equal(updated.articles.length, 1); assert.equal(updated.articles[0].id, first.articles[0].id);
  assert.equal(updated.articles[0].name, 'Grey Watch');
  assert.equal(first.articles[0].definition, 'The city night guard.');
  assert.equal(updated.articles[0].facts.length, 1);
});
test('a real chat source upgrades canonical provenance without duplicate facts', () => {
  const first = integrate([], { articles: [article({ facts: [{ text: 'A stable fact.', kind: 'canon', source: null }] })], terms: [] }, 2);
  const updated = integrate(first.articles, { articles: [article({ facts: [{ text: 'A stable fact.', kind: 'chat', source: 4 }] })], terms: [] }, 4);
  assert.equal(updated.articles[0].facts.length, 1); assert.equal(updated.articles[0].facts[0].source, 4);
  assert.equal(first.articles[0].facts[0].kind, 'canon');
});
test('swipe zero and alternate variants have independent snapshots', () => {
  const history = chat(), result = integrate([], decodeCollection(raw(), input()), 2);
  storeRecord(history[2], saved(history, 2, result));
  assert.equal(history[2].extra.extblocks, 'Other block data');
  assert.equal(history[2].swipe_info[0].extra[STORE].articles.length, 1);
  history[2].swipe_id = 1; history[2].mes = history[2].swipes[1];
  assert.equal(readCodex(history).articles.length, 0);
  storeRecord(history[2], saved(history, 2, { articles: [], terms: [] }));
  history[2].swipe_id = 0; history[2].mes = history[2].swipes[0];
  assert.equal(readCodex(history).articles.length, 1);
});
test('editing an ancestor invalidates all dependent records', () => {
  const history = chat(), result = integrate([], decodeCollection(raw(), input()), 2);
  storeRecord(history[2], saved(history, 2, result));
  assert.equal(readCodex(history).articles.length, 1);
  history[1].mes = 'A different question.';
  assert.equal(readCodex(history).articles.length, 0);
});
test('existing concepts can be selected for a scene with no new article updates', () => {
  const known = integrate([], decodeCollection(raw(), input()), 2).articles;
  const result = integrate(known, decodeCollection('{"articles":[],"terms":["Grey Watch"]}', input()), 4);
  assert.equal(result.articles.length, 1); assert.deepEqual(result.terms, [known[0].id]);
  assert.equal(integrate(known, { articles: [], terms: ['Unknown entity'] }, 4).terms.length, 0);
});
test('full fact text is used for deduplication and ambiguous identities fail', () => {
  const long = 'a'.repeat(220);
  assert.notEqual(identity(long + ' one'), identity(long + ' two'));
  const known = integrate([], { articles: [article(), article({ name: 'Other Guard' })], terms: [] }, 2).articles;
  assert.throws(() => integrate(known, { articles: [article({ aliases: ['Other Guard'] })], terms: [] }, 4), /разные статьи/);
});
test('prototype-shaped model names remain ordinary article data', () => {
  const result = integrate([], decodeCollection(raw({ name: '__proto__' }), input()), 2);
  assert.equal(result.articles[0].name, '__proto__'); assert.equal({}.polluted, undefined);
});
