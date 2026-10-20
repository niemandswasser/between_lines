const LEGACY_BLOCK_IDS = new Set(['bb06232f-d495-4a64-a363-206b2f051978', '6f866e67-4000-4fad-b7bd-1999b0d511c8', 'ec6a4b9f-af9c-4551-8b6b-14619502102e', 'f7e6889d-40e1-4b6d-8a3f-9cf866840841', '452f3658-7c0b-4fa5-9474-9649c27e641b']);

export function migrateLegacy(context) {
  const before = JSON.stringify(context.extensionSettings), settings = context.extensionSettings;
  const config = connectionSettings(settings[EXTENSION_KEY]);
  if (!config.migrated) {
    const legacy = settings.ExtBlocks;
    const active = legacy?.sets?.[legacy.active_set_idx];
    const collector = active?.global_blocks?.find(block => block.id === 'ec6a4b9f-af9c-4551-8b6b-14619502102e');
    const preset = legacy?.api_presets?.[collector?.api_preset || 'medium'];
    const profile = settings.connectionManager?.profiles?.find(item => item.name === preset?.connection_profile);
    if (!config.profileId && profile) config.profileId = profile.id;
    config.migrated = true;
  }
  settings[EXTENSION_KEY] = config;
  for (const set of settings.ExtBlocks?.sets || []) for (const block of set.global_blocks || []) if (LEGACY_BLOCK_IDS.has(block.id)) block.disabled = true;
  // Character-scoped copies take priority over global blocks in the previous extension.
  for (const character of context.characters || []) {
    const scoped = character?.data?.extensions?.ExtBlocks;
    if (Array.isArray(scoped)) for (const block of scoped) if (LEGACY_BLOCK_IDS.has(block.id)) block.disabled = true;
  }
  settings.disabledExtensions ||= [];
  for (const name of ['third-party/between-lines-loader', 'third-party/codex-blocks-loader']) if (!settings.disabledExtensions.includes(name)) settings.disabledExtensions.push(name);
  if (JSON.stringify(settings) !== before) context.saveSettingsDebounced?.();
  return config;
}

export function startBetweenLines({ context, service }) {
  if (globalThis.__betweenLinesApp?.nativeExtension) return globalThis.__betweenLinesApp;
  const c = context(), events = c.eventTypes || c.event_types;
  migrateLegacy(c);
  const connection = new CodexConnection(context, service, PROMPTS);
  const saveAutoState = state => { context().chatMetadata[CORE.AUTO_STATE] = state; context().saveMetadataDebounced?.(); };
  const env = { context, connection, request: (operation, input) => connection.request(operation, input), isEnabled: () => connection.settings().enabled,
    resetAutoCollection: () => saveAutoState({ every: CORE.preferences(context().chatMetadata?.[CORE.PREFERENCES]).autoEvery, frames: [] }),
    collectionSaved: target => saveAutoState(CORE.markAutoCollected(context().chat, target, context().chatMetadata?.[CORE.AUTO_STATE], CORE.preferences(context().chatMetadata?.[CORE.PREFERENCES]).autoEvery)),
    recordsUpgraded: () => { void context().saveChat().catch(error => globalThis.toastr?.warning('Не удалось сохранить совместимость старых записей: ' + error.message, 'Между строк')); },
  };
  const app = new BetweenLinesApp(env, CORE, STYLES); app.nativeExtension = true;
  globalThis.__betweenLinesApp = app; app.mount(); app.setupExtensionSettings();
  if (!connection.settings().profileId) app.notify('Выберите профиль подключения в настройках кодекса.');
  let pending = null, generationActive = false;
  const flush = () => {
    if (!pending || generationActive) return;
    const next = pending; pending = null;
    const chat = context().chat || [], message = chat[next.id];
    if (next.key !== app.chatKey() || message !== next.message || message?.mes !== next.text || message?.is_user || message?.is_system) return;
    if (!app.enabled() || !app.settings().auto || !connection.settings().profileId) return;
    const plan = CORE.planAutoCollection(chat, next.id, context().chatMetadata?.[CORE.AUTO_STATE], app.settings().autoEvery);
    if (plan.counted) saveAutoState(plan.state);
    if (!plan.due) return;
    void app.collect(next.id);
  };
  if (events.GENERATION_STARTED) c.eventSource.on(events.GENERATION_STARTED, () => { generationActive = true; });
  if (events.CHARACTER_MESSAGE_RENDERED) c.eventSource.on(events.CHARACTER_MESSAGE_RENDERED, (id, type) => {
    if (['first_message', 'impersonate', 'quiet'].includes(type)) return;
    const message = context().chat?.[id]; if (!message || message.is_user || message.is_system) return;
    pending = { id, message, text: message.mes, key: app.chatKey() };
    if (!generationActive) queueMicrotask(flush);
  });
  if (events.GENERATION_ENDED) c.eventSource.on(events.GENERATION_ENDED, () => { generationActive = false; flush(); });
  if (events.GENERATION_STOPPED) c.eventSource.on(events.GENERATION_STOPPED, () => { generationActive = false; pending = null; });
  if (events.CHAT_CHANGED) c.eventSource.on(events.CHAT_CHANGED, () => { pending = null; generationActive = false; connection.cancel(); migrateLegacy(context()); });
  for (const name of ['MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED']) if (events[name]) c.eventSource.on(events[name], () => { pending = null; connection.cancel(); });
  for (const name of ['CONNECTION_PROFILE_CREATED', 'CONNECTION_PROFILE_UPDATED', 'CONNECTION_PROFILE_DELETED', 'CONNECTION_PROFILE_LOADED']) if (events[name]) c.eventSource.on(events[name], () => { app.refreshConnectionControls(); });
  return app;
}
