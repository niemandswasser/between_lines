ctx.extensionSettings.ExtBlocks = { extblocks_is_enabled: false, active_set_idx: 0, sets: [{ name: 'Default', global_blocks: legacyBlocks }], api_presets: { medium: { connection_profile: 'Codex profile' } } };
ctx.extensionSettings.connectionManager = { selectedProfile: 'main', profiles: [{ id: 'main', name: 'Main chat', api: 'custom' }, { id: 'codex', name: 'Codex profile', api: 'custom' }] };
ctx.extensionSettings.disabledExtensions = [];
ctx.saveSettingsDebounced = () => fixture.settingsSaves = (fixture.settingsSaves || 0) + 1;
const { startBetweenLines, CORE } = await import('/runtime.js');
if (new URL(location.href).searchParams.has('seed')) {
  const result = CORE.integrate([], CORE.decodeCollection(JSON.stringify(sample), CORE.collectionInput(ctx.chat, 2, [], {})), 2);
  CORE.storeRecord(ctx.chat[2], { format: 1, branch: CORE.branchHashes(ctx.chat)[2], swipe: 0, articles: result.articles, terms: result.terms });
  ctx.chatMetadata.between_lines_preferences_v1 = { language: 'ru', notes: { [result.articles[0].id]: 'Saved private note' }, favorites: [result.articles[0].id] };
}
window.service = {
  getSupportedProfiles: () => ctx.extensionSettings.connectionManager.profiles,
  constructPrompt: (messages, id) => { fixture.formattedFor = id; return messages; },
  sendRequest: async (id, messages, tokens, options) => {
    fixture.requestProfile = id; fixture.requestTokens = tokens; fixture.requestSignal = options.signal;
    const input = JSON.parse(messages[1].content), operation = input.question ? 'ask' : input.topic ? 'write' : 'collect';
    const macro = operation === 'ask' ? 'betweenLinesQuestionInput' : operation === 'write' ? 'betweenLinesWritingInput' : 'betweenLinesInput';
    return { content: await GeneratedPlugin.generateBlockContent([{ name: operation, prompt: messages[0].content }], input.targetMessageId ?? ctx.chat.length - 1, [], { [macro]: messages[1].content }) };
  },
};
window.nativeOptions = { context: () => ctx, service };
window.app = startBetweenLines(nativeOptions);
fixture.ready = true;
