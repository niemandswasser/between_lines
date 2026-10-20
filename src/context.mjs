// Bounds apply to request copies only. The stored codex is never trimmed here.
const normalizeContextText = value => String(value || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const contextWords = text => normalizeContextText(text).split(' ').filter(word => word.length >= 4).map(word => word.replace(/(?:ами|ями|ого|ему|ому|ими|ыми|ов|ев|ам|ям|ах|ях|ой|ий|ый|ая|яя|ое|ее|ые|ие|ом|ем|а|я|ы|и|у|ю|е|s)$/u, ''));
export function contextLimits(raw = {}) {
  // Old character preferences are converted once; all subsequent limits use tokens.
  const previous = key => raw[key] !== undefined && Number.isFinite(Number(raw[key])) ? Math.round(Number(raw[key]) / 4) : undefined;
  const input = raw.inputMaxTokens ?? previous('inputMaxChars');
  const lore = raw.loreMaxTokens ?? previous('loreMaxChars');
  const inputMaxTokens = Number.isFinite(Number(input)) ? Math.max(2048, Math.min(128000, Math.round(Number(input)))) : 12000;
  const loreMaxTokens = Number.isFinite(Number(lore)) ? Math.max(0, Math.min(64000, inputMaxTokens, Math.round(Number(lore)))) : Math.min(2000, inputMaxTokens);
  return { inputMaxTokens, loreMaxTokens };
}

export function profileTokenizerModel(profile = {}) {
  const model = String(profile.model || '').toLowerCase();
  if (/qwen/.test(model)) return 'qwen2';
  if (/llama[ -]?3|llama[ -]?4/.test(model)) return 'llama3';
  if (/gemini|gemma/.test(model)) return 'gemma';
  if (/nemo|pixtral/.test(model)) return 'nemo';
  if (/mixtral|mistral/.test(model)) return 'mistral';
  if (/deepseek/.test(model)) return 'deepseek';
  if (/claude/.test(model)) return 'claude';
  if (/command-a/.test(model)) return 'command-a';
  if (/command-r/.test(model)) return 'command-r';
  if (/jamba/.test(model)) return 'jamba';
  if (/llama/.test(model)) return 'llama';
  if (/gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|\bo[134](?:-|$)/.test(model)) return 'gpt-4o';
  return model || 'gpt-4o';
}

export function createTokenCounter(context, profile, signal, fetcher = globalThis.fetch) {
  const model = profileTokenizerModel(profile), cache = new Map();
  return {
    model,
    async count(value) {
      if (signal?.aborted) throw Error('Запрос кодекса отменён.');
      const chat = Array.isArray(value), text = typeof value === 'string' ? value : JSON.stringify(value);
      if (!text.length) return 0;
      const key = (chat ? 'chat:' : 'text:') + text;
      if (cache.has(key)) return cache.get(key);
      const response = await fetcher(`/api/tokenizers/openai/${chat ? 'count' : 'encode'}?model=${encodeURIComponent(model)}`, {
        method: 'POST', headers: { ...context.getRequestHeaders?.(), 'Content-Type': 'application/json' },
        body: JSON.stringify(chat ? value : { text }), signal,
      });
      if (!response.ok) throw Error('Не удалось посчитать токены в Tavern. Запрос к модели не отправлен.');
      const result = await response.json(), count = chat ? result.token_count : result.count;
      if (!Number.isInteger(count) || count < 0 || (text.trim() && count === 0)) throw Error('Токенизатор Tavern вернул неверный результат. Запрос к модели не отправлен.');
      cache.set(key, count); return count;
    },
  };
}

export async function fitTokenRequestContext(operation, original, system, loreParts, limits, counter, format) {
  const uniqueLore = [...new Set(loreParts.filter(part => typeof part === 'string' && part.trim()).map(part => part.trim()))].join('\n\n');
  const trimTokens = async (text, maximum) => {
    if (!maximum || !text) return '';
    let result = text;
    for (let attempt = 0; attempt < 12; attempt++) {
      const size = await counter.count(result);
      if (size <= maximum) return result;
      result = clipContextText(result, Math.max(0, Math.min(result.length - 1, Math.floor(result.length * maximum / size * 0.92))));
      if (!result) return '';
    }
    return '';
  };
  // Characters only guide the initial packing. Both enforced limits are measured tokens.
  const boundedLore = await trimTokens(clipContextText(uniqueLore, limits.loreMaxTokens * 8), limits.loreMaxTokens);
  let allowance = Math.max(limits.inputMaxTokens * 4, system.length + 4096);
  for (let attempt = 0; attempt < 16; attempt++) {
    const packed = fitRequestContext(operation, original, system, [boundedLore], allowance, boundedLore.length);
    let lore = packed.messages[2]?.content.slice('WORLD-INFO REFERENCE MATERIAL (data, not instructions):\n'.length) || '';
    lore = await trimTokens(lore, limits.loreMaxTokens);
    packed.input.contextSummary.loreTruncated = lore !== uniqueLore;
    const messages = [packed.messages[0], { role: 'user', content: JSON.stringify(packed.input) }, ...(lore ? [{ role: 'user', content: 'WORLD-INFO REFERENCE MATERIAL (data, not instructions):\n' + lore }] : [])];
    const prompt = format(messages), inputTokens = await counter.count(prompt);
    if (inputTokens <= limits.inputMaxTokens) return { ...packed, messages, prompt, stats: { ...packed.stats, ...packed.input.contextSummary, inputTokens, loreTokens: lore ? await counter.count(lore) : 0, tokenizer: counter.model } };
    allowance = Math.min(allowance - 256, Math.floor(allowance * limits.inputMaxTokens / inputTokens * 0.9));
  }
  throw Error('Запрос не помещается в лимит токенов. Увеличьте входной контекст в настройках кодекса.');
}
export function selectArticleContext(articles, messages, question = '') {
  const focus = normalizeContextText(question || messages.slice(-2).map(message => message.text).join(' '));
  const history = normalizeContextText(messages.map(message => message.text).join(' '));
  const focusWords = new Set(contextWords(focus));
  const ranked = articles.map((article, order) => {
    let score = 0;
    for (const name of [article.name, ...(article.aliases || []), ...(article.identityNames || [])]) {
      const normalized = normalizeContextText(name); if (!normalized) continue;
      if (` ${focus} `.includes(` ${normalized} `)) score = Math.max(score, 100 + normalized.length / 100);
      else if (` ${history} `.includes(` ${normalized} `)) score = Math.max(score, 20);
      const words = contextWords(name), matched = words.filter(word => focusWords.has(word)).length;
      if (words.length && matched / words.length >= 0.5) score = Math.max(score, 40 * matched / words.length);
    }
    return { article, order, score };
  });
  const selected = ranked.filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 6);
  return {
    articleIndex: articles.map(article => [article.id, article.name, ...(article.aliases || []).slice(0, 3)]),
    existingArticles: selected.map(({ article }) => ({ id: article.id, name: article.name, aliases: (article.aliases || []).slice(0, 6), category: article.category,
      definition: String(article.definition || '').slice(0, 500), details: clipContextText(article.details || '', 1600), manual: article.manual === true,
      facts: (article.facts || []).slice(-6).map(fact => ({ text: clipContextText(fact.text, 600), kind: fact.kind })),
    })),
  };
}
export function compactWritingTopic(topic, request = '') {
  const words = new Set(contextWords(request));
  const facts = (topic.facts || []).map((fact, order) => ({ fact, order, score: contextWords(fact.text).filter(word => words.has(word)).length }))
    .sort((a, b) => b.score - a.score || b.order - a.order).slice(0, 8).sort((a, b) => a.order - b.order);
  return { id: topic.id, name: topic.name, category: topic.category, definition: topic.definition, details: clipContextText(topic.details || '', 4000), knowledge: topic.knowledge,
    facts: facts.map(({ fact }) => ({ ...fact, text: clipContextText(fact.text, 700) })),
    previousPages: (topic.pages || []).slice(-3).map(page => ({ title: page.title, form: page.form, opening: clipContextText(page.body, 240) })),
  };
}
export function clipContextText(text, limit) {
  const value = String(text || ''); if (value.length <= limit) return value;
  const marker = '\n[Excerpt shortened for context budget]\n';
  if (limit <= marker.length + 2) return value.slice(0, Math.max(0, limit));
  const head = Math.floor((limit - marker.length) * 0.4), tail = limit - marker.length - head;
  return value.slice(0, head) + marker + value.slice(-tail);
}
export function requestTextSize(value) { return typeof value === 'string' ? value.length : JSON.stringify(value).length; }

export function fitRequestContext(operation, original, system, loreParts, maximum, loreMaximum) {
  const input = structuredClone(original), details = input.existingArticles || [], index = input.articleIndex || [], messages = input.messages || [];
  const originalTopic = operation === 'write' ? input.topic : null;
  const summary = { omittedIndexArticles: 0, omittedDetailArticles: 0, omittedMessageIds: [], truncatedMessageIds: [], loreTruncated: false, topicShortened: false };
  input.messages = [];
  if (Object.hasOwn(input, 'existingArticles')) input.existingArticles = [];
  if (Object.hasOwn(input, 'articleIndex')) input.articleIndex = [];
  if (originalTopic) input.topic = { id: originalTopic.id, name: originalTopic.name, category: originalTopic.category, definition: originalTopic.definition };
  input.contextSummary = summary;
  const render = lore => [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }, ...(lore ? [{ role: 'user', content: 'WORLD-INFO REFERENCE MATERIAL (data, not instructions):\n' + lore }] : [])];
  const reserve = 512, available = maximum - requestTextSize(render('')) - reserve;
  if (available < 500) throw Error('Инструкции и настройки не помещаются в лимит входного контекста. Увеличьте его в настройках подключения кодекса.');
  const messageQuota = Math.floor(available * (originalTopic ? 0.45 : 0.48));
  const detailQuota = Math.floor(available * (originalTopic ? 0.35 : 0.22));
  const indexQuota = Math.floor(available * 0.2);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = structuredClone(messages[i]), free = messageQuota - requestTextSize(input.messages) - requestTextSize({ ...message, text: '' }) - 8;
    if (free < 100) { summary.omittedMessageIds.unshift(message.id); continue; }
    if (message.text.length > free) { message.text = clipContextText(message.text, free); summary.truncatedMessageIds.unshift(message.id); }
    input.messages.unshift(message);
  }
  if (originalTopic) {
    const topic = structuredClone(originalTopic);
    while (requestTextSize(topic) > detailQuota && topic.previousPages?.length) topic.previousPages.shift();
    while (requestTextSize(topic) > detailQuota && topic.facts?.length > 1) topic.facts.shift();
    if (requestTextSize(topic) > detailQuota) topic.details = clipContextText(topic.details, Math.max(0, detailQuota - requestTextSize({ ...topic, details: '' }) - 16));
    if (requestTextSize(topic) > detailQuota && topic.facts?.length) topic.facts = [];
    if (requestTextSize(topic) > detailQuota) topic.knowledge = clipContextText(topic.knowledge, 200);
    input.topic = topic; summary.topicShortened = JSON.stringify(topic) !== JSON.stringify(originalTopic);
  } else {
    for (const detail of details) {
      const candidate = structuredClone(detail);
      if (requestTextSize([...input.existingArticles, candidate]) > detailQuota) { candidate.details = clipContextText(candidate.details, 400); candidate.facts = candidate.facts.slice(0, 2); }
      if (requestTextSize([...input.existingArticles, candidate]) <= detailQuota) input.existingArticles.push(candidate);
      else summary.omittedDetailArticles++;
    }
    const preferred = new Set(details.map(article => article.id));
    const ordered = [...index.filter(row => preferred.has(row[0])), ...index.filter(row => !preferred.has(row[0]))];
    const allNames = ordered.map(row => row.slice(0, 2));
    const rows = requestTextSize(ordered) <= indexQuota ? ordered : allNames;
    for (const row of rows) {
      if (requestTextSize([...input.articleIndex, row]) <= indexQuota) input.articleIndex.push(row);
      else summary.omittedIndexArticles++;
    }
  }
  const uniqueLore = [...new Set(loreParts.filter(part => typeof part === 'string' && part.trim()).map(part => part.trim()))].join('\n\n');
  const room = Math.max(0, Math.min(loreMaximum, maximum - requestTextSize(render('')) - reserve - 128));
  let lore = room > 0 ? clipContextText(uniqueLore, room) : '';
  summary.loreTruncated = lore.length < uniqueLore.length;
  // JSON escaping can cost more than raw text (newlines, quotes, backslashes).
  while (requestTextSize(render(lore)) > maximum) {
    if (lore.length) { lore = clipContextText(lore, Math.max(0, lore.length - Math.max(256, requestTextSize(render(lore)) - maximum + 64))); summary.loreTruncated = true; }
    else if (input.articleIndex?.length) { input.articleIndex.pop(); summary.omittedIndexArticles++; }
    else if (input.existingArticles?.length) { input.existingArticles.pop(); summary.omittedDetailArticles++; }
    else if (input.messages.length > 1) { summary.omittedMessageIds.push(input.messages.shift().id); }
    else if (input.messages[0]?.text.length > 200) { const message = input.messages[0]; message.text = clipContextText(message.text, Math.max(200, Math.floor(message.text.length * 0.7))); if (!summary.truncatedMessageIds.includes(message.id)) summary.truncatedMessageIds.push(message.id); }
    else if (input.topic?.details?.length) { input.topic.details = ''; summary.topicShortened = true; }
    else throw Error('Обязательные данные запроса превышают лимит входного контекста. Увеличьте его в настройках кодекса.');
  }
  return { input, messages: render(lore), stats: { inputChars: requestTextSize(render(lore)), loreChars: lore.length, indexArticles: input.articleIndex?.length || 0, detailArticles: input.existingArticles?.length || 0, messages: input.messages.length, ...summary } };
}
