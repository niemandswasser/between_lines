import { trimmed, hash, collectionInput, collectionProfile } from './core.mjs';
import { compactWritingTopic } from './context.mjs';

export const WRITING_FORMS = { auto: 'Подобрать по теме', diary: 'Страница дневника', letter: 'Письмо', article: 'Статья / трактат', overheard: 'Подслушанный разговор', chronicle: 'Хроника', report: 'Донесение', legend: 'Легенда / предание', book: 'Книжный отрывок' };

export function writingInput(chat, anchor, topic, settings, { form = 'auto', request = '' } = {}) {
  return {
    profile: collectionProfile(settings),
    topic: compactWritingTopic(topic, request),
    form: Object.hasOwn(WRITING_FORMS, form) ? form : 'auto', request: trimmed(request, 1200),
    messages: collectionInput(chat, anchor, [], { ...settings, window: Math.min(settings.window || 12, 8) }).messages,
  };
}

export function decodeWriting(raw, input) {
  let data;
  try { data = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw Error('Генератор записи вернул некорректный JSON. Статьи остались на месте.'); }
  if (data?.skip === true) return { skip: true, reason: trimmed(data.reason, 500) || 'Недостаточно сведений для такой записи.' };
  if (!data || data.articleId !== input.topic.id) throw Error('Генератор выбрал другую статью. Запись не сохранена.');
  if (data.form === 'auto' || !Object.hasOwn(WRITING_FORMS, data.form)) throw Error('Неизвестная форма записи.');
  if (input.form !== 'auto' && data.form !== input.form) throw Error('Генератор не соблюл выбранную форму записи.');
  for (const [key, max] of [['title', 200], ['byline', 300], ['body', 18000]]) {
    if (typeof data[key] !== 'string' || !data[key].trim() || data[key].trim().length > max) throw Error(`Неверное поле ${key} в литературной записи.`);
  }
  if (data.body.trim().length < 80) throw Error('Генератор вернул слишком короткую запись.');
  return { articleId: input.topic.id, form: data.form, title: trimmed(data.title, 200), byline: trimmed(data.byline, 300), body: trimmed(data.body, 18000), language: input.profile.outputLanguage };
}

export function addWriting(articles, articleId, document, source) {
  const next = structuredClone(articles), article = next.find(item => item.id === articleId);
  if (!article) throw Error('Статья больше недоступна.');
  const pages = article.pages || [];
  if (pages.some(page => page.body === document.body && page.form === document.form)) return { articles: next, added: false };
  if (pages.length >= 12) throw Error('В статье уже 12 литературных записей. Прежние страницы сохранены.');
  const baseId = `page-${hash(document.form + '\n' + document.body)}`;
  let id = baseId, suffix = 2;
  while (pages.some(page => page.id === id)) id = `${baseId}-${suffix++}`;
  article.pages = [...pages, { ...document, id, source, createdAt: new Date().toISOString() }];
  return { articles: next, added: true };
}

export function editWriting(articles, articleId, pageId, values) {
  const next = structuredClone(articles), article = next.find(item => item.id === articleId);
  const page = article?.pages?.find(item => item.id === pageId);
  if (!page) throw Error('Запись больше недоступна. Откройте статью заново.');
  if (values.form === 'auto' || !Object.hasOwn(WRITING_FORMS, values.form)) throw Error('Выберите форму записи.');
  for (const [key, max, required] of [['title', 200, true], ['byline', 300, false], ['body', 18000, true]]) {
    if (typeof values[key] !== 'string' || values[key].trim().length > max || (required && !values[key].trim())) throw Error(`Проверьте поле ${key}: оно пустое или слишком длинное.`);
  }
  const edited = { form: values.form, title: trimmed(values.title, 200), byline: trimmed(values.byline, 300), body: trimmed(values.body, 18000) };
  if (article.pages.some(other => other.id !== pageId && other.form === edited.form && other.body === edited.body)) throw Error('Такая запись уже есть в статье.');
  Object.assign(page, edited, { manual: true, editedAt: new Date().toISOString() });
  return next;
}

export function removeWriting(articles, articleId, pageId) {
  const next = structuredClone(articles), article = next.find(item => item.id === articleId);
  if (!article?.pages?.some(page => page.id === pageId)) throw Error('Запись больше недоступна.');
  article.pages = article.pages.filter(page => page.id !== pageId);
  return next;
}
