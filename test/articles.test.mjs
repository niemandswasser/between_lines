import test from 'node:test';
import assert from 'node:assert/strict';
import { integrate, readCodex, storeRecord, branchHashes, STORE } from '../src/core.mjs';
import { editArticle, removeArticle, questionInput, decodeQuestion, questionTopic } from '../src/articles.mjs';

const row = { name: 'Grey Watch', category: 'faction', aliases: ['Watch'], definition: 'Guards.', details: 'The city guard.', knowledge: '', facts: [{ text: 'Guards the gate.', kind: 'chat', source: 0 }], related: [] };
const history = () => [{ mes: 'The Grey Watch guards the gate.', swipes: ['The Grey Watch guards the gate.', 'Alternative.'], swipe_id: 0 }];
const ledger = () => ({ ...integrate([], { articles: [row], terms: [row.name] }, 0), deletedArticles: [] });
const values = (article, extra = {}) => ({ ...article, aliases: article.aliases.join('\n'), related: article.related.join('\n'), facts: article.facts.map(f => f.text).join('\n'), ...extra });

test('article edits preserve pages, identity and citations; changed facts are manual; collection cannot overwrite them', () => {
  const known = ledger(), id = known.articles[0].id;
  known.articles[0].pages = [{ id: 'page', body: 'Letter' }];
  const edited = editArticle(known, id, values(known.articles[0], { name: 'Night Watch', details: 'My revision.', facts: 'Guards the gate.\nMy observation.' }));
  assert.equal(edited.articles[0].id, id); assert.equal(edited.articles[0].manual, true);
  assert.deepEqual(edited.articles[0].pages, known.articles[0].pages);
  assert.deepEqual(edited.articles[0].facts.map(f => f.kind), ['chat', 'manual']);
  assert.equal(known.articles[0].details, row.details);
  const collected = integrate(edited.articles, { articles: [row], terms: [row.name] }, 1);
  assert.equal(collected.articles.length, 1); assert.equal(collected.articles[0].details, 'My revision.'); assert.deepEqual(collected.terms, [id]);
});

test('article validation rejects duplicate identity, empty or oversized text, and oversized lists', () => {
  const known = ledger(), id = known.articles[0].id, base = values(known.articles[0]);
  for (const extra of [{ name: '' }, { details: 'x'.repeat(6001) }, { category: '__proto__' }, { aliases: 'x'.repeat(121) }]) assert.throws(() => editArticle(known, id, { ...base, ...extra }));
  known.articles.push({ ...structuredClone(known.articles[0]), id: 'other', name: 'Other', aliases: [] });
  assert.throws(() => editArticle(known, id, { ...base, name: 'Other' }), /имя/);
});

test('deletion blocks automatic recreation through aliases and survives snapshots; alternate swipe is independent', () => {
  const known = ledger(), deleted = removeArticle(known, known.articles[0].id), chat = history();
  const again = integrate(deleted.articles, { articles: [{ ...row, name: 'Watch', aliases: [] }], terms: ['Watch'] }, 0, deleted.deletedArticles);
  assert.deepEqual(again.articles, []);
  storeRecord(chat[0], { format: 1, branch: branchHashes(chat)[0], swipe: 0, ...deleted, terms: [], sceneTerms: { 0: [] } });
  assert.deepEqual(readCodex(chat).deletedArticles, deleted.deletedArticles);
  chat[0].swipe_id = 1; chat[0].mes = 'Alternative.';
  assert.deepEqual(readCodex(chat).deletedArticles, []);
  chat[0].swipe_id = 0; chat[0].mes = chat[0].swipes[0];
  assert.equal(readCodex(chat).deletedArticles.length, 1); assert.ok(chat[0].extra[STORE]);
});

test('question input uses configured language/sources and excludes private notes; topic recognizes natural questions', () => {
  assert.equal(questionTopic('А что такое Тень?'), 'Тень'); assert.equal(questionTopic('Who is Solas?'), 'Solas');
  const input = questionInput(history(), 0, [], { language: 'en', notes: { x: 'Secret' } }, 'What is the Watch?');
  assert.equal(input.profile.outputLanguage, 'English'); assert.equal(input.profile.allowCanon, false);
  assert.equal(JSON.stringify(input).includes('Secret'), false);
  assert.throws(() => questionInput(history(), 0, [], {}, ''));
});

test('question decoding accepts one supported article or refusal; rejects extra articles and invented sources', () => {
  const input = questionInput(history(), 0, [], {}, 'Grey Watch');
  assert.equal(decodeQuestion(JSON.stringify({ articles: [row], terms: [] }), input).articles.length, 1);
  assert.equal(decodeQuestion('{"unavailable":true,"reason":"Clarify the setting"}', input).unavailable, true);
  assert.throws(() => decodeQuestion(JSON.stringify({ articles: [row, row], terms: [] }), input), /одна/);
  assert.throws(() => decodeQuestion(JSON.stringify({ articles: [{ ...row, facts: [{ text: 'Unknown', kind: 'chat', source: 999 }] }], terms: [] }), input));
  assert.throws(() => decodeQuestion(JSON.stringify({ articles: [{ ...row, facts: [{ text: 'Memory', kind: 'canon', source: null }] }], terms: [] }), input));
});
