import * as CONTEXT from './context.mjs';
export const EXTENSION_KEY = 'between_lines_extension';

export function connectionSettings(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    profileId: typeof raw.profileId === 'string' ? raw.profileId : '',
    maxTokens: Number.isFinite(Number(raw.maxTokens)) ? Math.max(512, Math.min(32000, Math.round(Number(raw.maxTokens)))) : 6000,
    temperature: Number.isFinite(Number(raw.temperature)) ? Math.max(0, Math.min(2, Number(raw.temperature))) : 0.35,
    migrated: raw.migrated === true,
    ...CONTEXT.contextLimits(raw),
  };
}

export class CodexConnection {
  constructor(context, service, prompts, { createTokenCounter = CONTEXT.createTokenCounter } = {}) { this.context = context; this.service = service; this.prompts = prompts; this.active = null; this.createTokenCounter = createTokenCounter; }
  settings() { return connectionSettings(this.context().extensionSettings?.[EXTENSION_KEY]); }
  profiles() {
    try { return this.service.getSupportedProfiles(); } catch { return []; }
  }
  signature() {
    const config = this.settings(), profile = this.profiles().find(item => item.id === config.profileId);
    return JSON.stringify({ config, profile });
  }
  cancel() { this.active?.abort(); }
  async request(operation, input) {
    if (this.active) throw Error('Дождитесь завершения запроса кодекса.');
    const context = this.context(), config = this.settings();
    if (!config.enabled) throw Error('Кодекс выключен.');
    if (!config.profileId) throw Error('Выберите профиль подключения в настройках кодекса.');
    if (!this.profiles().some(profile => profile.id === config.profileId)) throw Error('Профиль подключения удалён или недоступен. Выберите другой профиль.');
    if (!this.prompts[operation]) throw Error('Неизвестная операция кодекса.');
    const signature = this.signature(), controller = new AbortController(); this.active = controller;
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const system = `${this.prompts[operation]}\n\nOUTPUT LANGUAGE FOR THIS REQUEST: ${input.profile.outputLanguage}.`;
      let parts = [];
      if (config.loreMaxTokens > 0 && input.profile.allowLorebook && typeof context.getWorldInfoPrompt === 'function' && context.characterId !== undefined) {
        const scanned = await context.getWorldInfoPrompt(input.messages.map(message => message.text).reverse(), Number(context.maxContext) || 32000, true, {});
        parts = [scanned.worldInfoString,
          ...(scanned.worldInfoExamples || []).map(entry => entry.content),
          ...(scanned.worldInfoDepth || []).flatMap(entry => entry.entries || []),
          ...(scanned.anBefore || []), ...(scanned.anAfter || []),
          ...Object.values(scanned.outletEntries || {}).flat(),
        ].filter(part => typeof part === 'string' && part.trim());
      }
      if (controller.signal.aborted || signature !== this.signature()) throw Error('Подключение или настройки изменились: запрос отменён.');
      // Reused inputs can carry local validation metadata from an earlier request.
      const { requestMessageIds, requestHasLorebook, ...data } = input;
      const counter = this.createTokenCounter(context, this.profiles().find(profile => profile.id === config.profileId), controller.signal);
      const packed = await CONTEXT.fitTokenRequestContext(operation, data, system, parts, config, counter, messages => this.service.constructPrompt(messages, config.profileId));
      const prompt = packed.prompt;
      if (controller.signal.aborted || signature !== this.signature()) throw Error('Подключение или настройки изменились: запрос отменён.');
      input.requestMessageIds = packed.input.messages.map(message => message.id);
      input.requestHasLorebook = packed.stats.loreTokens > 0;
      this.lastContext = { ...packed.stats, limit: config.inputMaxTokens };
      const result = await this.service.sendRequest(config.profileId, prompt, config.maxTokens, {
        stream: false, signal: controller.signal, extractData: true, includePreset: true, includeInstruct: true,
      }, { temperature: config.temperature });
      if (controller.signal.aborted || signature !== this.signature()) throw Error('Подключение или настройки изменились: ответ не сохранён.');
      const text = typeof result === 'string' ? result : result?.content;
      if (typeof text !== 'string' || !text.trim()) throw Error('Профиль подключения вернул пустой ответ.');
      return text;
    } catch (error) {
      if (controller.signal.aborted) throw Error('Запрос кодекса отменён или превысил время ожидания.');
      if (error.message === 'API request failed') throw Error('Не удалось получить ответ через выбранный профиль: ' + (error.cause?.message || 'проверьте подключение.'));
      throw error;
    } finally { clearTimeout(timeout); if (this.active === controller) this.active = null; }
  }
}
