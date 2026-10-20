import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexConnection, EXTENSION_KEY, connectionSettings } from '../src/connection.mjs';

function fixture(extra = {}) {
  const state = { characterId: 0, maxContext: 16000, extensionSettings: { [EXTENSION_KEY]: { profileId: 'codex', enabled: true }, connectionManager: { selectedProfile: 'main' } }, ...extra };
  const calls = [], profiles = [{ id: 'codex', name: 'Codex', api: 'custom', model: 'model-a' }];
  const service = { getSupportedProfiles: () => profiles, constructPrompt: (messages, id) => ({ messages, id }), sendRequest: async (...args) => { calls.push(args); return { content: '{"articles":[],"terms":[]}', reasoning: 'Private reasoning' }; } };
  const createTokenCounter = () => ({ model: 'test', count: async value => Math.ceil((typeof value === 'string' ? value.length : JSON.stringify(value).length) / 4) });
  return { state, calls, profiles, service, adapter: new CodexConnection(() => state, service, { collect: 'English instructions' }, { createTokenCounter }) };
}
const input = { profile: { outputLanguage: 'Russian', allowLorebook: false }, messages: [{ id: 2, text: 'The watch.' }] };

test('requests use explicit profile, prompt formatter and server secrets while leaving main connection unchanged', async () => {
  const f = fixture();
  assert.equal(await f.adapter.request('collect', input), '{"articles":[],"terms":[]}');
  const [id, formatted, tokens, options, overrides] = f.calls[0];
  assert.equal(id, 'codex'); assert.equal(formatted.id, 'codex'); assert.equal(tokens, 6000);
  assert.equal(options.stream, false); assert.equal(options.includePreset, true); assert.equal(options.includeInstruct, true);
  assert.ok(options.signal instanceof AbortSignal); assert.equal(overrides.temperature, 0.35);
  assert.equal(f.state.extensionSettings.connectionManager.selectedProfile, 'main');
  const sent = JSON.parse(formatted.messages[1].content);
  assert.deepEqual(sent.messages, input.messages); assert.deepEqual(sent.profile, input.profile);
  assert.equal(sent.requestMessageIds, undefined); assert.deepEqual(input.requestMessageIds, [2]);
  assert.equal(f.adapter.lastContext.inputTokens <= 12000, true);
});

test('missing or deleted profiles cause a clear error without fallback or requests', async () => {
  const f = fixture(); f.state.extensionSettings[EXTENSION_KEY].profileId = '';
  await assert.rejects(f.adapter.request('collect', input), /Выберите профиль/);
  f.state.extensionSettings[EXTENSION_KEY].profileId = 'deleted';
  await assert.rejects(f.adapter.request('collect', input), /удалён/); assert.equal(f.calls.length, 0);
});

test('lorebook scanning is a dry run and covers depth, examples and outlet material', async () => {
  let scan;
  const f = fixture({ getWorldInfoPrompt: async (...args) => { scan = args; return { worldInfoString: 'Base', worldInfoExamples: [{ content: 'Example' }], worldInfoDepth: [{ entries: ['Depth'] }], outletEntries: { x: ['Outlet'] } }; } });
  await f.adapter.request('collect', { ...input, profile: { ...input.profile, allowLorebook: true } });
  assert.equal(scan[2], true); assert.equal(scan[1], 16000);
  assert.match(f.calls[0][1].messages[2].content, /Base\n\nExample\n\nDepth\n\nOutlet/);
});

test('profile changes during request reject stale output and never switch the chat profile', async () => {
  const f = fixture();
  f.service.sendRequest = async () => { f.state.extensionSettings[EXTENSION_KEY].profileId = 'other'; return { content: 'stale' }; };
  await assert.rejects(f.adapter.request('collect', input), /не сохранён/);
  assert.equal(f.state.extensionSettings.connectionManager.selectedProfile, 'main');
});

test('abort and empty replies release the request lock', async () => {
  const f = fixture();
  f.service.sendRequest = async () => { f.adapter.cancel(); return { content: 'late' }; };
  await assert.rejects(f.adapter.request('collect', input), /отменён/); assert.equal(f.adapter.active, null);
  f.service.sendRequest = async () => ({ content: '' });
  await assert.rejects(f.adapter.request('collect', input), /пустой/); assert.equal(f.adapter.active, null);
});

test('connection settings clamp response limits and preserve an explicit disabled choice', () => {
  assert.equal(connectionSettings({ maxTokens: 999999, temperature: -10, enabled: false }).maxTokens, 32000);
  assert.equal(connectionSettings({ temperature: -10 }).temperature, 0);
  assert.equal(connectionSettings({ enabled: false }).enabled, false);
});

test('hard input limit includes formatted text-completion overhead and bounds lorebook separately', async () => {
  const f = fixture({ getWorldInfoPrompt: async () => ({ worldInfoString: 'Lore '.repeat(50000) }) });
  Object.assign(f.state.extensionSettings[EXTENSION_KEY], { inputMaxTokens: 3000, loreMaxTokens: 250 });
  f.service.constructPrompt = messages => 'Profile template '.repeat(200) + JSON.stringify(messages);
  const data = { profile: { outputLanguage: 'Russian', allowLorebook: true }, messages: Array.from({ length: 20 }, (_, id) => ({ id, text: 'scene\\\n"'.repeat(4000) })) };
  await f.adapter.request('collect', data);
  assert.ok(f.calls[0][1].length <= 12000);
  assert.ok(f.adapter.lastContext.loreTokens <= 250);
  assert.equal(data.requestMessageIds.at(-1), 19);
  assert.ok(data.requestMessageIds.length < 20);
  assert.equal(data.messages.length, 20);
});

test('zero lorebook budget skips scanning and cannot support lorebook citations', async () => {
  const f = fixture({ getWorldInfoPrompt: async () => { throw Error('Must not scan'); } });
  f.state.extensionSettings[EXTENSION_KEY].loreMaxTokens = 0;
  const data = { ...input, profile: { ...input.profile, allowLorebook: true } };
  await f.adapter.request('collect', data);
  assert.equal(data.requestHasLorebook, false); assert.equal(f.calls[0][1].messages.length, 2);
});

test('oversized required instructions fail before sending and release the connection lock', async () => {
  const f = fixture(); f.adapter.prompts.collect = 'Required instructions '.repeat(20000);
  await assert.rejects(f.adapter.request('collect', input), /лимит/);
  assert.equal(f.calls.length, 0); assert.equal(f.adapter.active, null);
});

test('tokenization failure or a changed profile during counting prevents the model request', async () => {
  const f = fixture();
  f.adapter.createTokenCounter = () => ({ count: async () => { throw Error('Tokenizer unavailable'); } });
  await assert.rejects(f.adapter.request('collect', input), /Tokenizer unavailable/);
  assert.equal(f.calls.length, 0); assert.equal(f.adapter.active, null);
  f.adapter.createTokenCounter = () => ({ count: async () => { f.state.extensionSettings[EXTENSION_KEY].profileId = 'other'; return 10; } });
  await assert.rejects(f.adapter.request('collect', input), /запрос отменён/);
  assert.equal(f.calls.length, 0); assert.equal(f.adapter.active, null);
});
