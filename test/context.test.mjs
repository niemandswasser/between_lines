import test from 'node:test';
import assert from 'node:assert/strict';
import { selectArticleContext, compactWritingTopic, fitRequestContext, fitTokenRequestContext, createTokenCounter, profileTokenizerModel, requestTextSize, contextLimits } from '../src/context.mjs';
import { collectionInput, decodeCollection, integrate } from '../src/core.mjs';
import { questionInput } from '../src/articles.mjs';

const articles = Array.from({ length: 300 }, (_, id) => ({ id: `a-${id}`, name: `Guild ${id}`, aliases: [`Order ${id}`], category: 'faction', definition: 'A guild of artisans.', details: 'Established history. '.repeat(300), knowledge: 'Known to locals.', facts: Array.from({ length: 80 }, (_, n) => ({ text: `Fact ${n}: ` + 'A supported fact. '.repeat(30), kind: 'chat', source: 0 })), pages: [{ title: 'A private draft', form: 'letter', body: 'Literary text '.repeat(1000) }] }));
const messages = [{ id: 0, text: 'Guild 0 guards the road.' }, { id: 1, text: 'Order 299 is at the gates.' }];

test('local selection preserves a compact catalog and prefers the question over the scene', () => {
  const selected = selectArticleContext(articles, messages);
  assert.equal(selected.articleIndex.length, 300);
  assert.ok(selected.existingArticles.length <= 6);
  assert.equal(selected.existingArticles[0].id, 'a-299');
  assert.ok(selected.existingArticles.every(article => article.facts.length <= 6));
  const question = questionInput([{ mes: messages[1].text }], 0, articles, {}, 'What is Guild 250?');
  assert.equal(question.existingArticles[0].id, 'a-250');
  assert.equal(JSON.stringify(question).includes('A private draft'), false);
});

test('large collections, escaping and lore fit the hard budget without altering stored articles or chat', () => {
  const chat = Array.from({ length: 20 }, (_, id) => ({ mes: `Guild ${id}. ` + 'line\n"\\'.repeat(3000) }));
  const before = JSON.stringify(articles), chatBefore = JSON.stringify(chat);
  const input = collectionInput(chat, 19, articles, { window: 20 });
  const packed = fitRequestContext('collect', input, 'English instructions '.repeat(200), ['Lore '.repeat(100000)], 12000, 1000);
  assert.ok(requestTextSize(packed.messages) <= 12000);
  assert.ok(packed.stats.loreChars <= 1000);
  assert.equal(packed.input.messages.at(-1).id, 19);
  assert.ok(packed.stats.omittedMessageIds.length > 0);
  assert.ok(packed.stats.truncatedMessageIds.includes(19));
  assert.equal(JSON.stringify(articles), before); assert.equal(JSON.stringify(chat), chatBefore);
  assert.equal(input.messages.length, 20);
  const full = fitRequestContext('collect', { ...input, messages }, 'English instructions', [], 48000, 8000);
  assert.equal(full.input.articleIndex.length, 300);
});

test('writing sends bounded selected facts and three page openings; full pages stay stored', () => {
  const topic = { ...articles[0], facts: [...articles[0].facts, { text: 'The harbor dues were abolished.', kind: 'chat', source: 1 }], pages: Array.from({ length: 12 }, (_, n) => ({ title: `Page ${n}`, form: 'letter', body: 'A full literary page. '.repeat(500) })) };
  const before = JSON.stringify(topic), compact = compactWritingTopic(topic, 'harbor dues');
  assert.equal(compact.facts.length, 8);
  assert.ok(compact.facts.some(fact => fact.text.includes('harbor dues')));
  assert.equal(compact.previousPages.length, 3);
  assert.ok(compact.previousPages.every(page => page.opening.length <= 240));
  const packed = fitRequestContext('write', { topic: compact, profile: { outputLanguage: 'English' }, messages }, 'English instructions', [], 12000, 0);
  assert.equal(packed.input.topic.id, topic.id);
  assert.ok(requestTextSize(packed.messages) <= 12000);
  assert.equal(JSON.stringify(topic), before);
});

test('only actually supplied message IDs and lore can support model citations', () => {
  const input = { profile: { allowLorebook: true }, messages, requestMessageIds: [1], requestHasLorebook: false };
  const response = kind => JSON.stringify({ articles: [{ name: 'Guild 0', category: 'faction', definition: 'A guild.', details: 'A guild guards the road.', facts: [{ text: 'The guild guards the road.', kind, source: 0 }] }], terms: [] });
  assert.throws(() => decodeCollection(response('chat'), input), /сообщение-источник/);
  assert.throws(() => decodeCollection(response('lorebook'), input), /лорбука/);
  const valid = JSON.parse(response('chat')); valid.articles[0].facts[0].source = 1;
  const result = decodeCollection(JSON.stringify(valid), input);
  const known = [{ ...articles[0], related: [], facts: articles[0].facts.slice(0, 60) }, articles[1]];
  const next = integrate(known, result, 1);
  assert.equal(next.articles[0].facts.length, 61);
  assert.deepEqual(next.articles[1], articles[1]);
});

test('context budgets are bounded and use independent defaults', () => {
  assert.deepEqual(contextLimits(), { inputMaxTokens: 12000, loreMaxTokens: 2000 });
  assert.deepEqual(contextLimits({ inputMaxTokens: -1, loreMaxTokens: 9999999 }), { inputMaxTokens: 2048, loreMaxTokens: 2048 });
  assert.equal(contextLimits({ loreMaxTokens: 0 }).loreMaxTokens, 0);
  assert.deepEqual(contextLimits({ inputMaxChars: 24000, loreMaxChars: 4000 }), { inputMaxTokens: 6000, loreMaxTokens: 1000 });
  assert.deepEqual(contextLimits({ inputMaxTokens: 16000, inputMaxChars: 24000, loreMaxTokens: 0, loreMaxChars: 4000 }), { inputMaxTokens: 16000, loreMaxTokens: 0 });
});

test('real token measurements enforce both limits even when text density differs from characters', async () => {
  // Deliberately dense counting: one character is two tokens, unlike the packing heuristic.
  const counter = { model: 'dense-test', count: async value => 2 * requestTextSize(value) };
  const original = { profile: { outputLanguage: 'English' }, messages: [{ id: 1, text: 'Dense passage. '.repeat(10000) }], ...selectArticleContext(articles, messages) };
  const before = JSON.stringify(original), limits = { inputMaxTokens: 12000, loreMaxTokens: 600 };
  const packed = await fitTokenRequestContext('collect', original, 'Required instructions', ['Dense lore '.repeat(30000)], limits, counter, messages => 'Profile header '.repeat(10) + JSON.stringify(messages));
  assert.ok(await counter.count(packed.prompt) <= limits.inputMaxTokens);
  assert.ok(packed.stats.loreTokens <= limits.loreMaxTokens);
  assert.equal(packed.stats.inputTokens, await counter.count(packed.prompt));
  assert.equal(packed.input.messages.at(-1).id, 1);
  assert.equal(packed.input.contextSummary.loreTruncated, true);
  assert.equal(JSON.stringify(original), before);
});

test('tokenizer uses selected auxiliary profile, local count/encode endpoints, CSRF headers and abort signal', async () => {
  const calls = [], controller = new AbortController();
  const fetcher = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => url.includes('/count?') ? { token_count: 37 } : { count: 11 } }; };
  const counter = createTokenCounter({ getRequestHeaders: () => ({ 'X-CSRF-Token': 'test-only' }) }, { model: 'anthropic/claude-sonnet' }, controller.signal, fetcher);
  assert.equal(await counter.count([{ role: 'user', content: 'Hello' }]), 37);
  assert.equal(await counter.count('Lore'), 11); assert.equal(await counter.count('Lore'), 11);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/tokenizers/openai/count?model=claude');
  assert.equal(calls[1].url, '/api/tokenizers/openai/encode?model=claude');
  assert.equal(calls[0].options.headers['X-CSRF-Token'], 'test-only');
  assert.equal(calls[0].options.signal, controller.signal);
  controller.abort(); await assert.rejects(counter.count('Next'), /отменён/);
  assert.equal(profileTokenizerModel({ model: 'vendor/qwen3-32b' }), 'qwen2');
  assert.equal(profileTokenizerModel({ model: 'openai/gpt-5' }), 'gpt-4o');
});

test('tokenizer failure never silently changes to a character estimate', async () => {
  const broken = createTokenCounter({}, {}, undefined, async () => ({ ok: false }));
  await assert.rejects(broken.count('Text'), /не отправлен/);
  const invalid = createTokenCounter({}, {}, undefined, async () => ({ ok: true, json: async () => ({ count: 0 }) }));
  await assert.rejects(invalid.count('Text'), /неверный результат/);
});
