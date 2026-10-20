import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, STORE, branchHashes, readCodex, storeRecord, upgradeCodexRecords, collectionInput } from '../src/core.mjs';
import { planAutoCollection } from '../src/auto.mjs';
const chat = () => [{ mes: 'Greeting' }, { mes: 'Question', is_user: true }, { mes: 'The Watch guards the city.', swipe_id: 0, swipes: ['The Watch guards the city.', 'Empty city.'] }];
const articles = [{ id: 'watch', name: 'Watch', pages: [{ id: 'letter', body: 'A letter.' }], manual: true }];
function legacyHashes(history) {
  let previous = 'start';
  return history.map(message => previous = hash(`${previous}|${message.is_user ? 'u' : 'a'}|${message.is_system ? 's' : ''}|${message.swipe_id ?? 0}|${String(message.mes || '')}`));
}
function legacySnapshot(history, id) {
  const record = { format: 1, branch: legacyHashes(history)[id], swipe: history[id].swipe_id ?? 0, articles: structuredClone(articles), deletedArticles: [{ id: 'deleted', names: ['Deleted term'] }], terms: ['watch'] };
  history[id].extra = { [STORE]: structuredClone(record) };
  history[id].swipe_info = [{ extra: { [STORE]: structuredClone(record) } }];
}

test('hide/unhide of sources, player messages, and snapshot anchor preserves articles/pages/deletion markers and hashes', () => {
  const history = chat(), hashes = branchHashes(history);
  storeRecord(history[2], { format: 1, branch: hashes[2], swipe: 0, articles, deletedArticles: [{ id: 'deleted', names: ['Deleted term'] }], terms: ['watch'] });
  for (const message of history) message.is_system = true;
  assert.deepEqual(branchHashes(history), hashes);
  assert.deepEqual(readCodex(history).articles, articles);
  assert.equal(readCodex(history).deletedArticles.length, 1);
  for (const message of history) message.is_system = false;
  assert.deepEqual(readCodex(history).articles, articles);
});

test('a snapshot made while hidden remains valid after unhiding; hidden text stays out of collection input', () => {
  const history = chat(); history[0].is_system = true;
  storeRecord(history[2], { format: 1, branch: branchHashes(history)[2], swipe: 0, articles, terms: [] });
  assert.equal(collectionInput(history, 2, [], {}).messages.some(message => message.id === 0), false);
  history[0].is_system = false;
  assert.deepEqual(readCodex(history).articles, articles);
});

test('legacy visible snapshots are restored after hiding, then stamped in both copies without altering article data', () => {
  const history = chat(); legacySnapshot(history, 2); history[1].is_system = true;
  assert.deepEqual(readCodex(history).articles, articles);
  assert.equal(upgradeCodexRecords(history), 1);
  assert.equal(history[2].extra[STORE].branchFormat, 2);
  assert.equal(history[2].swipe_info[0].extra[STORE].branchFormat, 2);
  assert.deepEqual(history[2].extra[STORE].articles, articles);
  history[0].is_system = true; history[1].is_system = false;
  assert.deepEqual(readCodex(history).articles, articles);
});

test('legacy snapshots saved at an earlier hidden-prefix boundary recover after hiding more messages', () => {
  const history = chat(); history[0].is_system = true; legacySnapshot(history, 2);
  history[1].is_system = true;
  assert.deepEqual(readCodex(history).articles, articles);
  assert.equal(upgradeCodexRecords(history), 1);
  const reloaded = JSON.parse(JSON.stringify(history));
  reloaded[0].is_system = false; reloaded[2].is_system = true;
  assert.deepEqual(readCodex(reloaded).articles, articles);
});

test('legacy arbitrary visibility is upgraded while known, preserving it across later arbitrary visibility changes', () => {
  const history = chat(); history[1].is_system = true; legacySnapshot(history, 2);
  assert.equal(upgradeCodexRecords(history), 1);
  history[0].is_system = true; history[1].is_system = false;
  assert.deepEqual(readCodex(history).articles, articles);
});

test('legacy partial collections after hiding recover older articles/pages/manual edits while retaining explicit deletions', () => {
  const history = chat(); legacySnapshot(history, 2);
  history[2].extra[STORE].articles.push({ id: 'removed', name: 'Removed' });
  history[2].swipe_info[0].extra[STORE] = structuredClone(history[2].extra[STORE]);
  history[0].is_system = true;
  history.push({ mes: 'Another reply' });
  legacySnapshot(history, 3);
  const late = history[3].extra[STORE];
  late.articles = [{ id: 'new', name: 'New topic' }, { id: 'watch', name: 'Watch', definition: 'Accidental auto rewrite' }];
  late.deletedArticles = [{ id: 'removed', names: ['Removed'] }];
  history[3].swipe_info[0].extra[STORE] = structuredClone(late);
  history[1].is_system = true;
  assert.equal(upgradeCodexRecords(history), 2);
  const restored = readCodex(JSON.parse(JSON.stringify(history)));
  assert.deepEqual(restored.articles.map(article => article.id), ['watch', 'new']);
  assert.equal(restored.articles[0].manual, true); assert.equal(restored.articles[0].pages.length, 1);
  assert.equal(restored.deletedArticles.some(entry => entry.id === 'removed'), true);
});

test('real edits, deletions, changed roles, and swipes still invalidate newer and legacy snapshots', () => {
  for (const legacy of [false, true]) for (const mutate of [h => h[1].mes += ' Changed.', h => h.splice(0, 1), h => h[1].is_user = false, h => { h[2].swipe_id = 1; h[2].mes = h[2].swipes[1]; }]) {
    const history = chat(); history[0].is_system = true;
    if (legacy) legacySnapshot(history, 2);
    else storeRecord(history[2], { format: 1, branch: branchHashes(history)[2], swipe: 0, articles, terms: [] });
    mutate(history);
    assert.equal(readCodex(history).articles.length, 0);
  }
});

test('legacy re-created aliases merge into the original identity and preserve facts and scene links', () => {
  const history = chat(); legacySnapshot(history, 2);
  const first = history[2].extra[STORE];
  first.articles = [{ id: 'original', name: 'Grey Watch', aliases: ['Watch'], facts: [{ text: 'Old fact', kind: 'chat', source: 2 }] }];
  first.terms = ['original']; history[2].swipe_info[0].extra[STORE] = structuredClone(first);
  history[0].is_system = true; history.push({ mes: 'Another reply' }); legacySnapshot(history, 3);
  const last = history[3].extra[STORE];
  last.articles = [{ id: 'recreated', name: 'Watch', aliases: [], facts: [{ text: 'New fact', kind: 'chat', source: 3 }] }];
  last.terms = ['recreated']; history[3].swipe_info[0].extra[STORE] = structuredClone(last);
  history[1].is_system = true; upgradeCodexRecords(history);
  const ledger = readCodex(history);
  assert.equal(ledger.articles.length, 1); assert.equal(ledger.articles[0].id, 'original');
  assert.deepEqual(ledger.articles[0].recoveredIds, ['recreated']);
  assert.equal(ledger.articles[0].facts.length, 2); assert.deepEqual(ledger.scenes.get(3), ['original']);
});

test('hiding an earlier counted answer does not reset or advance the automatic interval', () => {
  const history = chat();
  const initial = planAutoCollection(history, 2, undefined, 3);
  history[1].is_system = true; history[2].is_system = true;
  history.push({ mes: 'Another reply' });
  const next = planAutoCollection(history, 3, initial.state, 3);
  assert.equal(next.state.frames.at(-1).count, 2); assert.equal(next.due, false);
});
