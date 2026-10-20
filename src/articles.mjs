import { CATEGORIES, identity, trimmed, collectionInput, decodeCollection } from './core.mjs';

export function editArticle(ledger, articleId, values) {
  const articles = structuredClone(ledger.articles), article = articles.find(item => item.id === articleId);
  if (!article) throw Error('Статья больше недоступна.');
  if (!Object.hasOwn(CATEGORIES, values.category)) throw Error('Выберите категорию.');
  for (const [key, limit, required] of [['name', 120, true], ['definition', 500, true], ['details', 6000, true], ['knowledge', 1000, false]]) {
    if (typeof values[key] !== 'string' || values[key].trim().length > limit || (required && !values[key].trim())) throw Error(`Проверьте поле ${key}: оно пустое или слишком длинное.`);
  }
  const lines = (value, limit, count) => {
    if (typeof value !== 'string') throw Error('Некорректный список.');
    const result = value.split(/\n+/).map(text => text.trim()).filter(Boolean);
    if (result.length > count || result.some(text => text.length > limit)) throw Error('Список слишком длинный.');
    return [...new Set(result)];
  };
  const aliases = lines(values.aliases, 120, 24), related = lines(values.related, 120, 24);
  const facts = lines(values.facts, 1500, 80);
  // Retain former names so new collection results cannot recreate the renamed article.
  const oldNames = [article.name, ...article.aliases, ...(article.identityNames || [])];
  const names = new Set([values.name, ...aliases, ...oldNames].map(identity));
  if (articles.some(other => other.id !== articleId && [other.name, ...other.aliases, ...(other.identityNames || [])].some(name => names.has(identity(name))))) throw Error('Это имя уже используется другой статьёй.');
  article.identityNames = [...new Set(oldNames)];
  for (const key of ['name', 'definition', 'details', 'knowledge']) article[key] = values[key].trim();
  article.category = values.category; article.aliases = aliases; article.related = related;
  article.facts = facts.map(text => structuredClone(article.facts.find(fact => fact.text === text) || { text, kind: 'manual', source: null }));
  article.manual = true; article.editedAt = new Date().toISOString();
  const deletedArticles = structuredClone(ledger.deletedArticles || []);
  if (deletedArticles.some(entry => entry.id !== articleId && entry.names.some(name => names.has(identity(name))))) throw Error('Это имя принадлежит удалённой статье. Восстановите её через «Что такое…?».');
  return { articles, deletedArticles };
}

export function removeArticle(ledger, articleId) {
  const article = ledger.articles.find(item => item.id === articleId);
  if (!article) throw Error('Статья больше недоступна.');
  const deletedArticles = structuredClone(ledger.deletedArticles || []);
  deletedArticles.push({ id: article.id, names: [...new Set([article.name, ...article.aliases, ...(article.identityNames || [])])] });
  return { articles: structuredClone(ledger.articles.filter(item => item.id !== articleId)), deletedArticles };
}

export function questionTopic(question) {
  return trimmed(question, 300).replace(/^(?:а\s+)?(?:что\s+такое|кто\s+так(?:ой|ая|ие)|what\s+is|who\s+is)\s+/iu, '').replace(/[?？]+$/u, '').trim();
}

export function questionInput(chat, anchor, known, settings, question) {
  if (typeof question !== 'string' || !question.trim() || question.trim().length > 300 || !questionTopic(question)) throw Error('Введите термин или вопрос, до 300 символов.');
  return { ...collectionInput(chat, anchor, known, settings, question), question: question.trim(), topic: questionTopic(question) };
}

export function decodeQuestion(raw, input) {
  let data;
  try { data = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw Error('Ответ на вопрос содержит некорректный JSON. Кодекс не изменён.'); }
  if (data?.unavailable === true) return { unavailable: true, reason: trimmed(data.reason, 600) || 'Недостаточно сведений. Уточните фандом и разрешённые источники в настройках.' };
  const decoded = decodeCollection(JSON.stringify(data), input);
  if (decoded.articles.length !== 1) throw Error('Ожидалась одна статья по вашему вопросу.');
  return decoded;
}
