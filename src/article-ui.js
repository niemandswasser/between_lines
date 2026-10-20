Object.assign(BetweenLinesApp.prototype, {
  articleSession() {
    if (!this.hasChat()) return null;
    const c = this.context(), ledger = this.core.readCodex(c.chat), anchor = c.chat.length - 1;
    return { key: this.chatKey(), epoch: this.epoch, anchor, message: c.chat[anchor], branch: ledger.hashes[anchor], token: this.core.hash(JSON.stringify([ledger.articles, ledger.deletedArticles])) };
  },
  validArticleSession(session) {
    const fresh = this.articleSession();
    return fresh && session && ['key', 'epoch', 'anchor', 'message', 'branch', 'token'].every(key => fresh[key] === session[key]);
  },
  async commitArticles(session, result, extra = {}) {
    if (!this.validArticleSession(session)) throw Error('История или кодекс изменились. Откройте форму заново.');
    const c = this.context(), core = this.core, ledger = core.readCodex(c.chat), message = session.message;
    const previous = core.messageRecord(message), sceneTerms = Object.fromEntries(ledger.scenes);
    if (Number.isInteger(extra.scene)) sceneTerms[extra.scene] = extra.terms;
    const ids = new Set(result.articles.map(article => article.id));
    for (const id of Object.keys(sceneTerms)) sceneTerms[id] = sceneTerms[id].filter(value => ids.has(value));
    const record = { ...(previous?.branch === session.branch ? structuredClone(previous) : {}), format: 1, branch: session.branch, swipe: message.swipe_id ?? 0,
      articles: result.articles, deletedArticles: result.deletedArticles, sceneTerms, terms: sceneTerms[session.anchor] || [], savedAt: new Date().toISOString() };
    if (extra.profileKey) Object.assign(record, { profileKey: extra.profileKey, language: extra.language });
    const old = message.extra?.[core.STORE] ? structuredClone(message.extra[core.STORE]) : undefined;
    const swipe = message.swipe_id ?? 0, oldSwipe = message.swipe_info?.[swipe]?.extra?.[core.STORE] ? structuredClone(message.swipe_info[swipe].extra[core.STORE]) : undefined;
    core.storeRecord(message, record);
    try { await c.saveChat(); }
    catch (error) {
      if (old) message.extra[core.STORE] = old; else delete message.extra[core.STORE];
      const extra = message.swipe_info?.[swipe]?.extra;
      if (extra) { if (oldSwipe) extra[core.STORE] = oldSwipe; else delete extra[core.STORE]; }
      throw error;
    }
  },
  finishArticleWork() {
    this.working = false; this.workingKind = null; this.refresh();
    const pending = this.pending; this.pending = null;
    if (pending && pending.key === this.chatKey()) queueMicrotask(() => { void this.collect(pending.target); });
  },
  articleDialog(id, title) {
    let dialog = document.getElementById(id);
    if (!dialog) { dialog = document.createElement('dialog'); dialog.id = id; document.body.append(dialog); }
    dialog.setAttribute('aria-label', title); return dialog;
  },
  editCodexArticle() {
    if (this.working || !this.hasChat()) return;
    const article = this.ledger.articles.find(item => item.id === this.selected); if (!article) return;
    const session = this.articleSession(), dialog = this.articleDialog('bl-article-editor', 'Редактировать статью кодекса');
    const field = (key, label, limit, rows, required = false) => `<label>${label}${rows ? `<textarea name="${key}" maxlength="${limit}" rows="${rows}"${required ? ' required' : ''}>${this.escape(article[key] || '')}</textarea>` : `<input name="${key}" maxlength="${limit}"${required ? ' required' : ''} value="${this.escape(article[key] || '')}">`}</label>`;
    dialog.innerHTML = `<form><header><div><div class="bl-eyebrow">КОДЕКС МИРА</div><h2>Редактировать статью</h2></div><button type="button" data-cancel aria-label="Закрыть">${this.icon('close')}</button></header>${field('name', 'Название', 120, 0, true)}<label>Категория<select name="category">${Object.entries(this.core.CATEGORIES).map(([key, name]) => `<option value="${key}"${key === article.category ? ' selected' : ''}>${name}</option>`).join('')}</select></label>${field('definition', 'Краткое определение', 500, 3, true)}${field('details', 'Текст статьи', 6000, 10, true)}${field('knowledge', 'Что может знать персонаж', 1000, 3)}<label>Другие названия — по одному в строке<textarea name="aliases" rows="2">${this.escape(article.aliases.join('\n'))}</textarea></label><label>Сведения — по одному в строке<textarea name="facts" rows="5">${this.escape(article.facts.map(fact => fact.text).join('\n'))}</textarea></label><label>Связанные статьи — по одному названию в строке<textarea name="related" rows="2">${this.escape(article.related.join('\n'))}</textarea></label><p class="bl-help">После сохранения сборщик не будет менять эту статью. Новые или изменённые сведения будут отмечены как ваши правки. Художественные записи сохранятся.</p><p class="bl-form-error" role="alert" hidden></p><footer><button type="button" data-cancel>Отмена</button><button type="submit" class="bl-primary">Сохранить статью</button></footer></form>`;
    this.bindArticleForm(dialog, session, () => {
      const values = Object.fromEntries(new FormData(dialog.querySelector('form')));
      return this.core.editArticle(this.core.readCodex(this.context().chat), article.id, values);
    }, 'Статья изменена');
    dialog.showModal(); dialog.querySelector('input').focus();
  },
  deleteCodexArticle() {
    if (this.working || !this.hasChat()) return;
    const article = this.ledger.articles.find(item => item.id === this.selected); if (!article) return;
    const session = this.articleSession(), dialog = this.articleDialog('bl-article-delete', 'Удалить статью кодекса');
    dialog.innerHTML = `<form><header><div><div class="bl-eyebrow">КОДЕКС МИРА</div><h2>Удалить статью?</h2></div><button type="button" data-cancel aria-label="Закрыть">${this.icon('close')}</button></header><p class="bl-delete-title">${this.escape(article.name)}</p><p class="bl-help">Статья и её художественные записи (${article.pages?.length || 0}) будут удалены из текущей ветки кодекса. Сборщик не создаст эту статью заново автоматически. Создать её заново можно запросом через «Что такое…?»; прежние художественные записи при этом не восстанавливаются.</p><p class="bl-form-error" role="alert" hidden></p><footer><button type="button" data-cancel>Отмена</button><button type="submit" class="bl-danger">Удалить статью</button></footer></form>`;
    this.bindArticleForm(dialog, session, () => this.core.removeArticle(this.core.readCodex(this.context().chat), article.id), 'Статья удалена');
    dialog.showModal(); dialog.querySelector('footer [data-cancel]').focus();
  },
  bindArticleForm(dialog, session, makeResult, status) {
    dialog.querySelectorAll('[data-cancel]').forEach(button => button.onclick = () => dialog.close());
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault(); if (this.working || !event.target.reportValidity()) return;
      const errorLabel = dialog.querySelector('.bl-form-error'); errorLabel.hidden = true;
      this.working = true; this.workingKind = 'editing'; this.paintStatus();
      try { await this.commitArticles(session, makeResult()); this.status = status; dialog.close(); }
      catch (error) { errorLabel.textContent = error.message; errorLabel.hidden = false; }
      finally { this.finishArticleWork(); }
    };
  },
  askCodexQuestion() {
    if (this.working || !this.enabled() || !this.hasChat()) return;
    const session = this.articleSession(), dialog = this.articleDialog('bl-question', 'Что такое…?');
    dialog.innerHTML = `<form><header><div><div class="bl-eyebrow">СПРОСИТЬ У КОДЕКСА</div><h2>Что такое…?</h2></div><button type="button" data-cancel aria-label="Закрыть">${this.icon('close')}</button></header><label>Термин или вопрос<input name="question" maxlength="300" required placeholder="Например: что такое Тень?"></label><p class="bl-help">Если статья уже есть, она откроется сразу. Для нового ответа используются переписка и разрешённые источники. Для знаний о фандоме включите общий канон и укажите фандом в настройках. Язык ответа берётся из настроек кодекса.</p><p class="bl-form-error" role="alert" hidden></p><footer><button type="button" data-cancel>Отмена</button><button type="submit" class="bl-primary">Получить статью</button></footer></form>`;
    dialog.querySelectorAll('[data-cancel]').forEach(button => button.onclick = () => dialog.close());
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault(); if (this.working || !event.target.reportValidity()) return;
      const errorLabel = dialog.querySelector('.bl-form-error'); errorLabel.hidden = true;
      if (!this.validArticleSession(session)) { errorLabel.textContent = 'История или кодекс изменились. Откройте форму заново.'; errorLabel.hidden = false; return; }
      const success = await this.answerCodexQuestion(dialog.querySelector('input').value);
      if (success) dialog.close();
      else { errorLabel.textContent = this.status; errorLabel.hidden = false; }
    };
    dialog.showModal(); dialog.querySelector('input').focus();
  },
  async answerCodexQuestion(question) {
    if (this.working || !this.enabled() || !this.hasChat()) return false;
    const core = this.core, c = this.context(), ledger = core.readCodex(c.chat), session = this.articleSession(), settings = this.settings();
    let input;
    try { input = core.questionInput(c.chat, session.anchor, ledger.articles, settings, question); }
    catch (error) { this.notify(error.message, true); return false; }
    const existing = ledger.articles.find(article => [article.name, ...article.aliases, ...(article.identityNames || [])].some(name => core.identity(name) === core.identity(input.topic)));
    if (existing) { this.search = ''; this.scope = 'all'; this.category = 'all'; this.refresh(); this.select(existing.id); this.status = 'Статья уже есть в кодексе'; this.paintStatus(); return true; }
    this.working = true; this.workingKind = 'question'; this.paintStatus();
    try {
      const raw = await this.env.request('ask', input);
      if (!this.enabled() || JSON.stringify(core.collectionProfile(this.settings())) !== JSON.stringify(input.profile)) throw Error('Настройки изменились. Повторите вопрос с выбранным языком и источниками.');
      if (!this.validArticleSession(session)) throw Error('История или кодекс изменились: ответ не сохранён.');
      const decoded = core.decodeQuestion(raw, input);
      if (decoded.unavailable) { this.status = decoded.reason; return false; }
      // Only an explicit question can lift a deletion; automatic collection never does.
      const incoming = decoded.articles[0], names = new Set([incoming.name, ...incoming.aliases, input.topic].map(core.identity));
      const deletedArticles = ledger.deletedArticles.filter(entry => !entry.names.some(name => names.has(core.identity(name))));
      const result = core.integrate(ledger.articles, decoded, session.anchor, deletedArticles);
      await this.commitArticles(session, { articles: result.articles, deletedArticles });
      const article = result.articles.find(article => [article.name, ...article.aliases, ...(article.identityNames || [])].some(name => names.has(core.identity(name))));
      this.search = ''; this.scope = 'all'; this.category = 'all'; this.selected = article?.id || this.selected;
      this.status = result.added ? 'Статья добавлена по вашему вопросу' : 'Открыта существующая статья';
      this.dialog.classList.add('bl-reading'); return true;
    } catch (error) { this.notify(error.message || 'Не удалось получить статью.', true); return false; }
    finally { this.finishArticleWork(); }
  },
});
