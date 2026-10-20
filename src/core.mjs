import { selectArticleContext } from './context.mjs';
export const STORE = 'between_lines_v1';
export const PREFERENCES = 'between_lines_preferences_v1';
export const CATEGORIES = { term: 'Термины', faction: 'Организации', place: 'Места', custom: 'Обычаи', item: 'Предметы', history: 'История', character: 'Персонажи' };
export const LANGUAGES = { ru: ['Русский', 'Russian'], en: ['English', 'English'], uk: ['Українська', 'Ukrainian'], de: ['Deutsch', 'German'], fr: ['Français', 'French'], es: ['Español', 'Spanish'], pt: ['Português', 'Portuguese'], pl: ['Polski', 'Polish'], ja: ['日本語', 'Japanese'], ko: ['한국어', 'Korean'], zh: ['中文', 'Chinese'] };

export function trimmed(value, limit = 10000) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, limit) : '';
}
export function identity(value) { return trimmed(value, 100000).normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
export function hash(value) {
  const text = String(value); let a = 2166136261;
  for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 16777619);
  return `${text.length.toString(36)}-${(a >>> 0).toString(36)}`;
}
export function preferences(raw = {}) {
  const language = Object.hasOwn(LANGUAGES, raw.language || '') || raw.language === 'custom' ? raw.language : 'ru';
  return {
    language, customLanguage: trimmed(raw.customLanguage, 80), auto: raw.auto !== false, showTerms: raw.showTerms !== false,
    autoEvery: Number.isFinite(Number(raw.autoEvery)) ? Math.max(1, Math.min(100, Math.round(Number(raw.autoEvery)))) : 1,
    window: Number.isFinite(Number(raw.window)) ? Math.max(1, Math.min(100, Math.round(Number(raw.window)))) : 12,
    canon: raw.canon === true, lorebook: raw.lorebook !== false, fandom: trimmed(raw.fandom, 200),
    spoilerBoundary: trimmed(raw.spoilerBoundary, 600), character: trimmed(raw.character, 1200),
    favorites: Array.isArray(raw.favorites) ? raw.favorites.filter(id => typeof id === 'string').slice(0, 400) : [],
    notes: raw.notes && typeof raw.notes === 'object' && !Array.isArray(raw.notes) ? Object.fromEntries(Object.entries(raw.notes).filter(([, note]) => typeof note === 'string')) : {},
  };
}
export function collectionProfile(raw) {
  const p = preferences(raw);
  return {
    outputLanguage: p.language === 'custom' ? p.customLanguage || 'Russian' : LANGUAGES[p.language][1],
    fandom: p.fandom, allowCanon: p.canon && !!p.fandom, allowLorebook: p.lorebook,
    spoilerBoundary: p.spoilerBoundary || 'Basic worldbuilding known before the main plot only. No future events, secret identities, twists, or character fates.',
    characterBackground: p.character,
  };
}
export function branchHashes(chat) {
  let previous = 'start';
  // Tavern also uses is_system to hide ordinary messages from the prompt.
  // Visibility does not change the message's text, author role, or swipe branch.
  return chat.map(message => (previous = hash(`${previous}|${message.is_user ? 'u' : 'a'}||${message.swipe_id ?? 0}|${String(message.mes || '')}`)));
}
function legacyBranchStep(previous, message, hidden) {
  return hash(`${previous}|${message.is_user ? 'u' : 'a'}|${hidden ? 's' : ''}|${message.swipe_id ?? 0}|${String(message.mes || '')}`);
}
const legacyBranchProofs = new WeakMap();
function legacyMatches(chat, hashes) {
  const matches = new Set(), unresolved = new Map(); let previous = 'start';
  for (let i = 0; i < chat.length; i++) {
    previous = legacyBranchStep(previous, chat[i], chat[i].is_system);
    const record = messageRecord(chat[i]);
    if (!record || record.branchFormat === 2 || record.swipe !== (chat[i].swipe_id ?? 0)) continue;
    if (record.branch === hashes[i] || record.branch === previous) { matches.add(i); continue; }
    const cached = legacyBranchProofs.get(record);
    if (cached?.branch === record.branch && cached.content === hashes[i]) { if (cached.valid) matches.add(i); }
    else unresolved.set(i, record);
  }
  if (!unresolved.size) return matches;
  // Old versions stored only a hash that included visibility. Recover records
  // made while an earlier prefix was hidden (e.g. before another /hide range).
  // Every candidate still hashes the complete current text, roles, and swipes.
  // Limit work on large legacy chats; unproven records stay invalid.
  let prefixes = ['start'], allHidden = 'start', work = 0;
  const last = Math.max(...unresolved.keys());
  for (let i = 0; i <= last; i++) {
    const message = chat[i];
    work += (String(message.mes || '').length + 40) * (prefixes.length + 1);
    if (work > 64000000 || prefixes.length > 2048) break;
    prefixes = prefixes.map(prefix => legacyBranchStep(prefix, message, false));
    allHidden = legacyBranchStep(allHidden, message, true); prefixes.push(allHidden);
    const record = unresolved.get(i);
    if (record && prefixes.includes(record.branch)) matches.add(i);
  }
  for (const [i, record] of unresolved) legacyBranchProofs.set(record, { branch: record.branch, content: hashes[i], valid: matches.has(i) });
  return matches;
}
export function messageRecord(message) {
  const swipe = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
  return message?.swipe_info?.[swipe]?.extra?.[STORE] || message?.extra?.[STORE] || null;
}
function recoverLegacySnapshot(previous, previousDeleted, record) {
  const current = structuredClone(record.articles), deleted = new Map(previousDeleted.map(entry => [entry.id, structuredClone(entry)]));
  for (const entry of record.deletedArticles || []) deleted.set(entry.id, structuredClone(entry));
  // An explicit recreation is represented by the article being present again.
  for (const article of current) deleted.delete(article.id);
  let articles = structuredClone(previous.filter(article => !deleted.has(article.id)));
  const names = article => new Set([article.name, ...(article.aliases || []), ...(article.identityNames || [])].map(identity));
  for (const update of current) {
    if (deleted.has(update.id)) continue;
    const incomingNames = names(update);
    const exact = articles.find(article => article.id === update.id);
    const matches = exact ? [exact] : articles.filter(article => [...names(article)].some(name => incomingNames.has(name)));
    if (!matches.length) { articles.push(update); continue; }
    if (matches.length > 1) {
      // Keep the latest interpretation of an ambiguous legacy entity; never
      // invent a merge between several distinct older entities.
      articles = articles.filter(article => !matches.includes(article)); articles.push(update); continue;
    }
    const article = matches[0];
    const result = article.manual && !update.manual ? { ...article, ...(Object.hasOwn(update, 'pages') ? { pages: update.pages } : {}) } : { ...update };
    result.id = article.id;
    if (!Object.hasOwn(result, 'pages') && article.pages) result.pages = structuredClone(article.pages);
    const recoveredIds = [...new Set([...(article.recoveredIds || []), ...(update.recoveredIds || []), ...(update.id !== article.id ? [update.id] : [])])];
    if (recoveredIds.length) result.recoveredIds = recoveredIds;
    result.aliases = [...new Set([...(article.aliases || []), ...(update.aliases || []), article.name, update.name])].filter(name => identity(name) !== identity(result.name));
    if (!result.manual && Array.isArray(article.facts) && Array.isArray(result.facts)) {
      const facts = new Map(article.facts.map(fact => [identity(fact.text), fact]));
      for (const fact of result.facts) facts.set(identity(fact.text), fact);
      result.facts = [...facts.values()];
    }
    articles[articles.indexOf(article)] = result;
  }
  return { articles, deletedArticles: [...deleted.values()] };
}
export function readCodex(chat, until = chat.length - 1) {
  const hashes = branchHashes(chat); let articles = [], deletedArticles = []; const scenes = new Map();
  const legacy = chat.some(message => { const record = messageRecord(message); return record?.format === 1 && record.branchFormat !== 2; }) ? legacyMatches(chat, hashes) : new Set();
  const upgrades = [];
  for (let i = 0; i <= Math.min(until, chat.length - 1); i++) {
    const record = messageRecord(chat[i]);
    if (!record || record.format !== 1 || !Array.isArray(record.articles) || record.swipe !== (chat[i].swipe_id ?? 0)) continue;
    if (record.branchFormat === 2 ? (record.contentBranch || record.branch) !== hashes[i] : !legacy.has(i)) continue;
    if (record.branchFormat !== 2) {
      // The old visibility bug could make a later collection start from an empty
      // ledger. Carry forward proven earlier entries, respecting explicit deletes.
      const recovered = recoverLegacySnapshot(articles, deletedArticles, record);
      articles = recovered.articles; deletedArticles = recovered.deletedArticles;
      upgrades.push({ id: i, branch: hashes[i], legacyBranch: record.branch, articles, deletedArticles });
    } else {
      articles = record.articles;
      deletedArticles = Array.isArray(record.deletedArticles) ? record.deletedArticles : [];
    }
    scenes.set(i, Array.isArray(record.terms) ? record.terms : []);
    for (const [id, terms] of Object.entries(record.sceneTerms || {})) {
      if (Number.isInteger(Number(id)) && Number(id) >= 0 && Number(id) <= i && Array.isArray(terms)) scenes.set(Number(id), terms);
    }
  }
  const recoveredIds = new Map(articles.flatMap(article => (article.recoveredIds || []).map(id => [id, article.id])));
  if (recoveredIds.size) for (const [id, terms] of scenes) scenes.set(id, [...new Set(terms.map(term => recoveredIds.get(term) || term))]);
  return { articles, deletedArticles, scenes, hashes, upgrades };
}
export function upgradeCodexRecords(chat) {
  const { upgrades } = readCodex(chat);
  for (const upgrade of upgrades) {
    const message = chat[upgrade.id];
    for (const record of new Set([message.extra?.[STORE], message.swipe_info?.[message.swipe_id ?? 0]?.extra?.[STORE]])) {
      if (record?.branch === upgrade.legacyBranch && record.swipe === (message.swipe_id ?? 0)) {
        record.contentBranch = upgrade.branch; record.branchFormat = 2;
        record.articles = structuredClone(upgrade.articles); record.deletedArticles = structuredClone(upgrade.deletedArticles);
      }
    }
  }
  return upgrades.length;
}
export function storeRecord(message, record) {
  const saved = { ...structuredClone(record), contentBranch: record.branch, branchFormat: 2 };
  message.extra ||= {}; message.extra[STORE] = structuredClone(saved);
  if (Array.isArray(message.swipes)) {
    const swipe = message.swipe_id ?? 0;
    message.swipe_info ||= [];
    message.swipe_info[swipe] ||= { extra: {} };
    message.swipe_info[swipe].extra ||= {};
    message.swipe_info[swipe].extra[STORE] = structuredClone(saved);
  }
}
export function collectionInput(chat, target, known, rawPreferences, focus = '') {
  const settings = preferences(rawPreferences); const messages = [];
  for (let id = target; id >= 0 && messages.length < settings.window; id--) {
    const message = chat[id];
    if (message.is_system || !String(message.mes || '').trim()) continue;
    messages.unshift({ id, role: message.is_user ? 'player' : 'character', name: trimmed(message.name, 120), text: String(message.mes) });
  }
  return { targetMessageId: target, profile: collectionProfile(settings), messages, ...selectArticleContext(known, messages, focus) };
}
function field(value, label, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw Error(`Неверное поле «${label}» в ответе сборщика.`);
  return trimmed(value, max);
}
export function decodeCollection(raw, input) {
  let object;
  try { object = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw Error('Сборщик вернул некорректный JSON. Сохранённый кодекс не изменён.'); }
  if (!object || !Array.isArray(object.articles) || object.articles.length > 12 || !Array.isArray(object.terms) || object.terms.length > 8) throw Error('Ответ должен содержать articles (до 12) и terms (до 8).');
  const sourceIds = new Set(input.requestMessageIds ?? input.messages.map(message => message.id));
  const articles = object.articles.map(row => {
    if (!row || !Object.hasOwn(CATEGORIES, row.category)) throw Error('Неизвестная категория записи.');
    if (!Array.isArray(row.facts) || row.facts.length < 1 || row.facts.length > 10) throw Error('В статье должны быть 1–10 подтверждающих сведений.');
    const facts = row.facts.map(fact => {
      if (!fact || !['chat', 'lorebook', 'canon', 'inference'].includes(fact.kind)) throw Error('Неверный тип источника.');
      if (fact.kind === 'canon' && !input.profile.allowCanon) throw Error('Дополнение каноном не разрешено в настройках.');
      if (fact.kind === 'lorebook' && (!input.profile.allowLorebook || input.requestHasLorebook === false)) throw Error('Сведения лорбука отсутствуют в запросе или не разрешены в настройках.');
      if (fact.kind === 'chat' && (!Number.isInteger(fact.source) || !sourceIds.has(fact.source))) throw Error('Сборщик указал несуществующее сообщение-источник.');
      return { text: field(fact.text, 'fact', 1500, true), kind: fact.kind, source: fact.kind === 'chat' ? fact.source : null };
    });
    if (row.aliases !== undefined && (!Array.isArray(row.aliases) || row.aliases.length > 12)) throw Error('Некорректные псевдонимы.');
    if (row.related !== undefined && (!Array.isArray(row.related) || row.related.length > 8)) throw Error('Некорректные связанные статьи.');
    return { name: field(row.name, 'name', 120, true), category: row.category, aliases: (row.aliases || []).map(name => field(name, 'alias', 120, true)), definition: field(row.definition, 'definition', 500, true), details: field(row.details, 'details', 6000, true), knowledge: field(row.knowledge || '', 'knowledge', 1000), facts, related: (row.related || []).map(name => field(name, 'related', 120, true)) };
  });
  return { articles, terms: object.terms.map(name => field(name, 'term', 120, true)) };
}
export function integrate(known, result, messageId, deletedArticles = []) {
  const articles = structuredClone(known); let added = 0;
  for (const incoming of result.articles) {
    const names = new Set([incoming.name, ...incoming.aliases].map(identity));
    if (deletedArticles.some(entry => entry.names.some(name => names.has(identity(name))))) continue;
    const matches = articles.filter(article => [article.name, ...article.aliases, ...(article.identityNames || [])].some(name => names.has(identity(name))));
    if (matches.length > 1) throw Error('Сборщик смешал разные статьи. Обновление не сохранено.');
    let article = matches[0];
    if (article?.manual) continue;
    if (!article) {
      if (articles.length >= 300) throw Error('В кодексе уже 300 статей. Экспортируйте его перед дальнейшим расширением.');
      let id = `bl-${hash(identity(incoming.name))}`;
      while (articles.some(entry => entry.id === id)) id += '-2';
      article = { id, name: incoming.name, category: incoming.category, aliases: [], definition: '', details: '', knowledge: '', facts: [], related: [], firstSeen: messageId, updated: messageId };
      articles.push(article); added++;
    }
    article.aliases = [...new Set([...article.aliases, ...incoming.aliases, ...(article.name !== incoming.name ? [incoming.name] : [])])].filter(name => identity(name) !== identity(article.name)).slice(0, 24);
    article.definition = incoming.definition; article.details = incoming.details; article.knowledge = incoming.knowledge; article.updated = messageId;
    for (const fact of incoming.facts) {
      const existing = article.facts.find(item => identity(item.text) === identity(fact.text));
      if (existing) { if (existing.kind !== 'chat' && fact.kind === 'chat') Object.assign(existing, fact); continue; }
      if (article.facts.length >= 80) throw Error('Достигнут лимит сведений статьи. Предыдущие данные сохранены.');
      article.facts.push(fact);
    }
    article.related = [...new Set([...article.related, ...incoming.related])].slice(0, 24);
  }
  const mentioned = new Set(result.terms.map(identity));
  const terms = articles.filter(article => [article.name, ...article.aliases, ...(article.identityNames || [])].some(name => mentioned.has(identity(name)))).map(article => article.id);
  return { articles, terms, added };
}
