class BetweenLinesApp {
  constructor(environment, core, style) {
    this.env = environment; this.core = core; this.style = style; this.version = '2.1.0';
    this.search = ''; this.scope = 'all'; this.category = 'all'; this.selected = null;
    this.expanded = new Map(); this.epoch = 0; this.status = 'Справочник по вашему миру';
  }
  context() { return this.env.context(); }
  chatKey() { const c = this.context(); return `${c.groupId || c.characterId || 0}:${c.getCurrentChatId?.() || c.chatId || ''}`; }
  hasChat() { const c = this.context(); return Array.isArray(c.chat) && c.chat.length > 0 && !!(c.getCurrentChatId?.() || c.chatId); }
  enabled() { return this.env.isEnabled(); }
  settings() { return this.core.preferences(this.context().chatMetadata?.[this.core.PREFERENCES]); }
  saveSettings(settings) {
    if (!this.hasChat()) return;
    const previous = this.settings();
    this.context().chatMetadata[this.core.PREFERENCES] = this.core.preferences(settings);
    const next = this.settings();
    if (previous.autoEvery !== next.autoEvery || previous.auto !== next.auto) this.env.resetAutoCollection?.();
    this.context().saveMetadataDebounced?.();
  }
  escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  icon(name) {
    const paths = { book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>', compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/>', chevron: '<path d="m9 5 7 7-7 7"/>', settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>', refresh: '<path d="M20 7V3l-3 3a8 8 0 1 0 3 9M20 7h-5"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.book}</svg>`;
  }
  notify(message, error = false) {
    this.status = message;
    globalThis.toastr?.[error ? 'warning' : 'info'](message, 'Между строк');
    this.paintStatus();
  }
  mount() {
    let style = document.getElementById('bl-block-style');
    if (!style) { style = document.createElement('style'); style.id = 'bl-block-style'; document.head.append(style); }
    if (style.textContent !== this.style) style.textContent = this.style;
    if (!this.dialog) this.makeDialog();
    if (!this.menu) {
      const parent = document.createElement('div'); parent.id = 'bl-menu'; parent.className = 'extension_container';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'list-group-item flex-container flexGap5';
      button.innerHTML = `${this.icon('compass')}<span>Между строк · Кодекс</span>`;
      button.addEventListener('click', () => this.open()); parent.append(button);
      (document.getElementById('extensionsMenu') || document.body).append(parent); this.menu = parent;
    }
    if (!this.subscribed) {
      this.subscribed = true;
      const c = this.context(), events = c.eventTypes || c.event_types;
      if (events.CHAT_CHANGED) c.eventSource.on(events.CHAT_CHANGED, () => {
        this.epoch++; this.expanded.clear(); this.selected = null; this.search = ''; this.scope = 'all'; this.category = 'all';
        this.settingsDialog?.close(); this.sourceDialog?.close(); this.writingDialog?.close(); this.pageEditor?.close(); this.pageDelete?.close(); this.openPage = null; this.refresh();
        ['bl-article-editor', 'bl-article-delete', 'bl-question'].forEach(id => document.getElementById(id)?.close());
      });
      for (const name of ['MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'CHARACTER_MESSAGE_RENDERED']) {
        if (events[name]) c.eventSource.on(events[name], () => this.schedulePaint());
      }
      document.addEventListener('click', event => {
        const button = event.target.closest?.('.bl-terms button'); if (button) this.termClick(button);
      });
      if (c.SlashCommandParser && c.SlashCommand) {
        c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({ name: 'between-lines', helpString: 'Открывает новый кодекс «Между строк».', callback: async () => { this.open(); return ''; } }));
      }
    }
    const root = document.getElementById('chat');
    if (root !== this.chatRoot) {
      this.observer?.disconnect(); this.chatRoot = root;
      if (root) {
        this.observer = new MutationObserver(changes => {
          if (changes.some(change => {
            if (change.target.closest?.('.bl-terms')) return false;
            return [...change.addedNodes, ...change.removedNodes].some(node => !node.matches?.('.bl-terms'));
          })) this.schedulePaint();
        });
        this.observer.observe(root, { childList: true, subtree: true });
      }
    }
    this.refresh();
    return this;
  }
  schedulePaint() { clearTimeout(this.paintTimer); this.paintTimer = setTimeout(() => this.refresh(), 90); }
  refresh() {
    const c = this.context(); this.ledger = this.core.readCodex(c.chat || []); this.prefs = this.settings();
    if (!this.ledger.articles.some(article => article.id === this.selected)) this.selected = this.ledger.articles[0]?.id || null;
    if (this.menu) this.menu.hidden = !this.enabled();
    if (this.dialog) {
      this.dialog.querySelector('#bl-world').textContent = this.prefs.fandom || c.name2 || 'Ваш мир';
      this.dialog.querySelector('#bl-search').value = this.search;
      this.dialog.querySelector('#bl-category').value = this.category;
      this.drawList(); this.drawArticle(); this.paintStatus();
    }
    this.drawTerms();
  }
  makeDialog() {
    const dialog = document.createElement('dialog'); dialog.id = 'bl-codex'; dialog.setAttribute('aria-label', 'Между строк — кодекс мира');
    dialog.innerHTML = `<header class="bl-top"><div class="bl-brand">${this.icon('compass')}<span>между строк<small id="bl-world"></small></span></div><div class="bl-tools"><button type="button" data-action="settings" title="Настройки кодекса" aria-label="Настройки кодекса">${this.icon('settings')}<span>Настройки</span></button><button type="button" data-action="collect" title="Собрать сведения из последних сообщений">${this.icon('refresh')}<span>Обновить</span></button><button type="button" data-action="close" title="Закрыть" aria-label="Закрыть кодекс">${this.icon('close')}</button></div></header><div class="bl-layout"><aside class="bl-sidebar"><div class="bl-eyebrow">ВАШ СПРАВОЧНИК</div><h1>Кодекс мира</h1><p class="bl-caption">Всё, что встретилось на пути.</p><label class="bl-search">${this.icon('search')}<input type="search" id="bl-search" placeholder="Термин, место, организация…" aria-label="Поиск по кодексу"></label><div class="bl-filters"><button type="button" data-scope="all">Все</button><button type="button" data-scope="scene">В сцене</button><button type="button" data-scope="favorites">${this.icon('star')}Избранное</button></div><label class="bl-category">Категория<select id="bl-category" aria-label="Категория"><option value="all">Все категории</option>${Object.entries(this.core.CATEGORIES).map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></label><div id="bl-list"></div></aside><article id="bl-reader" class="bl-reader" aria-label="Статья кодекса"></article></div><footer class="bl-status"><span id="bl-status-text"></span><button type="button" data-action="export">Экспорт JSON</button></footer>`;
    document.body.append(dialog); this.dialog = dialog;
    const ask = document.createElement('button'); ask.type = 'button'; ask.className = 'bl-ask-button'; ask.dataset.action = 'ask'; ask.textContent = 'Что такое…?';
    dialog.querySelector('.bl-search').after(ask);
    dialog.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.article) { this.select(button.dataset.article); return; }
      if (button.dataset.scope) { this.scope = button.dataset.scope; this.drawList(); return; }
      const action = button.dataset.action;
      if (action === 'close') dialog.close();
      if (action === 'settings') this.openSettings();
      if (action === 'collect') void this.collect(this.lastAssistant(), true);
      if (action === 'favorite') this.toggleFavorite();
      if (action === 'list') this.dialog.classList.remove('bl-reading');
      if (action === 'export') this.exportJSON();
      if (action === 'source') this.showSource(Number(button.dataset.source));
      if (action === 'write') this.askWriting();
      if (action === 'ask') this.askCodexQuestion();
      if (action === 'edit-article') this.editCodexArticle();
      if (action === 'delete-article') this.deleteCodexArticle();
      if (action === 'edit-page') this.editPage(button.dataset.pageArticle, button.dataset.pageId);
      if (action === 'delete-page') this.deletePage(button.dataset.pageArticle, button.dataset.pageId);
      if (action === 'reset') { this.search = ''; this.scope = 'all'; this.category = 'all'; this.dialog.querySelector('#bl-search').value = ''; this.dialog.querySelector('#bl-category').value = 'all'; this.drawList(); }
    });
    dialog.querySelector('#bl-search').addEventListener('input', event => { this.search = event.target.value; this.drawList(); });
    dialog.querySelector('#bl-category').addEventListener('change', event => { this.category = event.target.value; this.drawList(); });
    dialog.addEventListener('input', event => {
      if (event.target.id !== 'bl-note' || !this.selected) return;
      const prefs = this.settings(); prefs.notes[this.selected] = event.target.value; this.saveSettings(prefs);
      this.dialog.querySelector('#bl-note-status').textContent = 'Сохранено в этом чате';
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === '/' && !event.target.matches('input,textarea,select')) { event.preventDefault(); this.dialog.classList.remove('bl-reading'); this.dialog.querySelector('#bl-search').focus(); }
    });
  }
  open(articleId) { this.mount(); if (!this.dialog.open) this.dialog.showModal(); if (articleId) this.select(articleId); }
  select(articleId) {
    if (!this.ledger.articles.some(article => article.id === articleId)) return;
    this.selected = articleId; this.drawList(); this.drawArticle(); this.dialog.classList.add('bl-reading');
    const reader = this.dialog.querySelector('#bl-reader'); reader.scrollTop = 0;
    reader.querySelector('h2')?.focus({ preventScroll: true });
  }
  drawList() {
    const core = this.core, query = core.identity(this.search);
    const sceneIds = this.ledger.scenes.get(this.lastAssistant()) || [];
    const filtered = this.ledger.articles.filter(article => {
      if (this.category !== 'all' && article.category !== this.category) return false;
      if (this.scope === 'favorites' && !this.prefs.favorites.includes(article.id)) return false;
      if (this.scope === 'scene' && !sceneIds.includes(article.id)) return false;
      return !query || core.identity([article.name, ...article.aliases, article.definition, article.details, ...article.facts.map(fact => fact.text), ...(article.pages || []).flatMap(page => [page.title, page.byline, page.body])].join(' ')).includes(query);
    });
    this.dialog.querySelectorAll('[data-scope]').forEach(button => { button.classList.toggle('active', button.dataset.scope === this.scope); button.setAttribute('aria-pressed', String(button.dataset.scope === this.scope)); });
    this.dialog.querySelector('#bl-list').innerHTML = filtered.length ? filtered.map(article => `<button type="button" class="bl-entry${article.id === this.selected ? ' active' : ''}" data-article="${this.escape(article.id)}" aria-pressed="${article.id === this.selected}"><span class="bl-category-symbol" data-category="${article.category}">◇</span><span><strong>${this.escape(article.name)}</strong><small>${core.CATEGORIES[article.category]} · ${this.escape(article.definition)}</small></span>${this.icon(this.prefs.favorites.includes(article.id) ? 'star' : 'chevron')}</button>`).join('') : `<div class="bl-empty"><strong>${this.ledger.articles.length ? 'Здесь пока пусто' : 'Первые страницы ещё впереди'}</strong><p>${this.ledger.articles.length ? 'Измените поиск или фильтры.' : 'После ответа персонажа сборщик добавит пояснения. Можно собрать сведения из истории кнопкой «Обновить».'}</p>${this.ledger.articles.length ? '<button type="button" data-action="reset">Показать все записи</button>' : ''}</div>`;
  }
  drawArticle() {
    const root = this.dialog.querySelector('#bl-reader'), article = this.ledger.articles.find(item => item.id === this.selected);
    if (!article) { root.innerHTML = `<div class="bl-welcome">${this.icon('book')}<h2>Мир становится понятнее</h2><p>Здесь будут определения, подробные пояснения и ваши заметки.</p><button type="button" data-action="settings">Выбрать язык и настроить сбор ${this.icon('arrow')}</button></div>`; return; }
    const favorite = this.prefs.favorites.includes(article.id);
    const related = this.ledger.articles.filter(other => other.id !== article.id && article.related.some(name => [other.name, ...other.aliases].some(alias => this.core.identity(name) === this.core.identity(alias))));
    const kinds = { chat: 'Из переписки', lorebook: 'Лорбук', canon: 'Общий канон', inference: 'Предположение', manual: 'Ваша правка' };
    root.innerHTML = `<button type="button" class="bl-mobile-back" data-action="list">← Все записи</button><div class="bl-reader-tools"><span>Кодекс <span>›</span> ${this.core.CATEGORIES[article.category]}</span><button type="button" class="bl-favorite" data-action="favorite" aria-pressed="${favorite}">${this.icon('star')}${favorite ? 'В избранном' : 'В избранное'}</button></div><header class="bl-article-header"><div class="bl-eyebrow">${this.core.CATEGORIES[article.category].toUpperCase()}</div><h2 tabindex="-1">${this.escape(article.name)}</h2><p>${this.escape(article.definition)}</p><span class="bl-seal" aria-hidden="true">✧</span></header><div class="bl-prose">${article.details.split(/\n+/).filter(Boolean).map(paragraph => `<p>${this.escape(paragraph)}</p>`).join('')}</div>${article.knowledge ? `<section class="bl-knowledge"><div>${this.icon('eye')}Что может знать персонаж</div><p>${this.escape(article.knowledge)}</p></section>` : ''}<details class="bl-sources"><summary>Источники и сведения · ${article.facts.length}</summary>${article.facts.map(fact => `<div class="bl-fact"><p>${this.escape(fact.text)}</p>${fact.kind === 'chat' ? `<button type="button" data-action="source" data-source="${fact.source}">Сообщение #${fact.source} ${this.icon('arrow')}</button>` : `<span>${kinds[fact.kind]}</span>`}</div>`).join('')}</details><div class="bl-note-heading"><label for="bl-note">ЛИЧНАЯ ЗАМЕТКА</label><span id="bl-note-status">Только для вас</span></div><textarea id="bl-note" placeholder="Что хочется запомнить об этом…">${this.escape(this.prefs.notes[article.id] || '')}</textarea>${related.length ? `<div class="bl-related"><div class="bl-eyebrow">СВЯЗАННЫЕ ЗАПИСИ</div>${related.map(other => `<button type="button" data-article="${this.escape(other.id)}">${this.escape(other.name)} ${this.icon('arrow')}</button>`).join('')}</div>` : ''}`;
    const actions = document.createElement('div'); actions.className = 'bl-article-actions';
    actions.innerHTML = `<span>${article.manual ? 'Изменено вручную · защита от автоправок' : 'Статья кодекса'}</span><button type="button" data-action="edit-article">Редактировать</button><button type="button" class="bl-danger" data-action="delete-article">Удалить</button>`;
    root.querySelector('.bl-article-header').before(actions);
    const pages = [...(article.pages || [])].reverse();
    const writing = document.createElement('section'); writing.className = 'bl-writing-section';
    writing.innerHTML = `<div class="bl-writing-head"><div><div class="bl-eyebrow">ГОЛОСА МИРА</div><p>История за строками справочника</p></div><button type="button" data-action="write">Создать запись ${this.icon('arrow')}</button></div>${pages.length ? this.drawWriting(pages[0]) + (pages.length > 1 ? `<details class="bl-older-pages"><summary>Другие записи · ${pages.length - 1}</summary>${pages.slice(1).map(page => this.drawWriting(page)).join('')}</details>` : '') : '<p class="bl-writing-empty">Письмо, дневник или подслушанный разговор — о предмете этой статьи.</p>'}`;
    root.querySelector('.bl-sources').before(writing);
    if (this.openPage) {
      const page = [...writing.querySelectorAll('.bl-world-page')].find(node => node.dataset.pageId === this.openPage);
      const older = page?.closest('details'); if (older) older.open = true;
    }
    this.paintStatus();
  }
  drawWriting(page) {
    return `<section class="bl-world-page" data-page-id="${this.escape(page.id)}"><div class="bl-page-form">${this.escape(this.core.WRITING_FORMS[page.form] || 'Запись')}</div><h3>${this.escape(page.title)}</h3>${page.byline ? `<p class="bl-page-byline">${this.escape(page.byline)}</p>` : ''}<div class="bl-page-prose">${page.body.split(/\n\s*\n/).map(paragraph => `<p>${this.escape(paragraph).replace(/\n/g, '<br>')}</p>`).join('')}</div><footer class="bl-page-footer"><span class="bl-page-origin">Художественная запись · ${this.escape(page.language)}${page.manual ? ' · изменено вручную' : ''}</span><span class="bl-page-actions"><button type="button" data-action="edit-page" data-page-article="${this.escape(this.selected)}" data-page-id="${this.escape(page.id)}">Редактировать</button><button type="button" class="bl-danger" data-action="delete-page" data-page-article="${this.escape(this.selected)}" data-page-id="${this.escape(page.id)}">Удалить</button></span></footer></section>`;
  }
  pageSession(articleId, pageId) {
    const c = this.context(), anchor = c.chat.length - 1;
    const page = this.core.readCodex(c.chat).articles.find(item => item.id === articleId)?.pages?.find(item => item.id === pageId);
    return page ? { articleId, pageId, page: structuredClone(page), token: this.core.hash(JSON.stringify(page)), key: this.chatKey(), epoch: this.epoch, anchor, message: c.chat[anchor], branch: this.core.branchHashes(c.chat)[anchor] } : null;
  }
  validPageSession(session) {
    if (!session || !this.hasChat()) return false;
    const c = this.context(), page = this.core.readCodex(c.chat).articles.find(item => item.id === session.articleId)?.pages?.find(item => item.id === session.pageId);
    return session.key === this.chatKey() && session.epoch === this.epoch && c.chat.length - 1 === session.anchor && c.chat[session.anchor] === session.message && this.core.branchHashes(c.chat)[session.anchor] === session.branch && !!page && this.core.hash(JSON.stringify(page)) === session.token;
  }
  async changePage(session, values) {
    if (this.working) { this.notify('Дождитесь завершения текущей операции.'); return false; }
    if (!this.validPageSession(session)) { this.notify('История или запись изменилась. Откройте форму заново.', true); return false; }
    const c = this.context(), core = this.core, ledger = core.readCodex(c.chat), message = session.message;
    this.working = true; this.workingKind = 'editing'; this.paintStatus();
    try {
      const articles = values ? core.editWriting(ledger.articles, session.articleId, session.pageId, values) : core.removeWriting(ledger.articles, session.articleId, session.pageId);
      const previous = core.messageRecord(message);
      const record = { ...(previous?.branch === session.branch ? structuredClone(previous) : {}), format: 1, branch: session.branch, swipe: message.swipe_id ?? 0, articles, deletedArticles: ledger.deletedArticles, sceneTerms: Object.fromEntries(ledger.scenes), terms: ledger.scenes.get(session.anchor) || [], savedAt: new Date().toISOString() };
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
      this.openPage = values ? session.pageId : null;
      this.status = values ? 'Запись изменена' : 'Запись удалена';
      return true;
    } catch (error) { this.notify(error.message || 'Не удалось сохранить изменение.', true); return false; }
    finally {
      this.working = false; this.workingKind = null; this.refresh();
      const pending = this.pending; this.pending = null;
      if (pending && pending.key === this.chatKey()) queueMicrotask(() => { void this.collect(pending.target); });
    }
  }
  editPage(articleId, pageId) {
    if (this.working || !this.hasChat()) return;
    const session = this.pageSession(articleId, pageId); if (!session) return;
    if (!this.pageEditor) { this.pageEditor = document.createElement('dialog'); this.pageEditor.id = 'bl-page-editor'; this.pageEditor.setAttribute('aria-label', 'Редактировать литературную запись'); document.body.append(this.pageEditor); }
    const dialog = this.pageEditor, page = session.page;
    dialog.innerHTML = `<form><header><div><div class="bl-eyebrow">ГОЛОСА МИРА</div><h2>Редактировать запись</h2></div><button type="button" data-cancel aria-label="Закрыть">${this.icon('close')}</button></header><label>Название<input name="title" maxlength="200" required value="${this.escape(page.title)}"></label><label>Форма<select name="form">${Object.entries(this.core.WRITING_FORMS).filter(([code]) => code !== 'auto').map(([code, label]) => `<option value="${code}"${page.form === code ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label>Автор / подпись <span class="bl-optional">необязательно</span><input name="byline" maxlength="300" value="${this.escape(page.byline)}"></label><label>Текст<textarea name="body" maxlength="18000" rows="12" required>${this.escape(page.body)}</textarea></label><p class="bl-help">Правка сохранится в этой статье. Запрос к модели не выполняется.</p><footer><button type="button" data-cancel>Отмена</button><button type="submit" class="bl-primary">Сохранить</button></footer></form>`;
    dialog.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); if (!event.target.reportValidity()) return;
      const data = new FormData(event.target), values = Object.fromEntries(['title', 'form', 'byline', 'body'].map(key => [key, String(data.get(key) || '')]));
      if (await this.changePage(session, values)) dialog.close();
    });
    dialog.showModal(); dialog.querySelector('input').focus();
  }
  deletePage(articleId, pageId) {
    if (this.working || !this.hasChat()) return;
    const session = this.pageSession(articleId, pageId); if (!session) return;
    if (!this.pageDelete) { this.pageDelete = document.createElement('dialog'); this.pageDelete.id = 'bl-page-delete'; this.pageDelete.setAttribute('aria-label', 'Удалить литературную запись'); document.body.append(this.pageDelete); }
    const dialog = this.pageDelete;
    dialog.innerHTML = `<form><header><div><div class="bl-eyebrow">ГОЛОСА МИРА</div><h2>Удалить запись?</h2></div><button type="button" data-cancel aria-label="Закрыть">${this.icon('close')}</button></header><p class="bl-delete-title">${this.escape(session.page.title)}</p><p class="bl-help">Эта литературная запись будет удалена из текущей ветки кодекса. Статья, справочные факты и другие записи сохранятся.</p><footer><button type="button" data-cancel>Отмена</button><button type="submit" class="bl-danger">Удалить запись</button></footer></form>`;
    dialog.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.querySelector('form').addEventListener('submit', async event => { event.preventDefault(); if (await this.changePage(session, null)) dialog.close(); });
    dialog.showModal(); dialog.querySelector('footer [data-cancel]').focus();
  }
  askWriting() {
    if (this.working || !this.enabled() || !this.hasChat()) return;
    const article = this.ledger.articles.find(item => item.id === this.selected);
    if (!article) return;
    if ((article.pages || []).length >= 12) { this.notify('В этой статье уже 12 литературных записей.'); return; }
    const key = this.chatKey(), epoch = this.epoch, branch = this.core.branchHashes(this.context().chat).at(-1);
    if (!this.writingDialog) { this.writingDialog = document.createElement('dialog'); this.writingDialog.id = 'bl-writing-dialog'; this.writingDialog.setAttribute('aria-label', 'Создать запись из мира'); document.body.append(this.writingDialog); }
    const dialog = this.writingDialog;
    dialog.innerHTML = `<form><header><div><div class="bl-eyebrow">ГОЛОСА МИРА</div><h2>Запись о «${this.escape(article.name)}»</h2></div><button type="button" data-cancel aria-label="Закрыть">${this.icon('close')}</button></header><p class="bl-help">Тема статьи через чей-то голос: письмо, дневник, разговор или другой текст. Язык: ${this.escape(this.core.collectionProfile(this.settings()).outputLanguage)}.</p><label>Форма записи<select name="form">${Object.entries(this.core.WRITING_FORMS).map(([code, label]) => `<option value="${code}">${label}</option>`).join('')}</select></label><label>Голос и пожелания <span class="bl-optional">необязательно</span><textarea name="request" maxlength="1200" rows="4" placeholder="Например: письмо домой от уставшего дозорного; сдержанный юмор и бытовые детали."></textarea></label><p class="bl-help">Один запрос к отдельному генератору. Запись сохранится в этой статье.</p><footer><button type="button" data-cancel>Отмена</button><button type="submit" class="bl-primary">Написать запись</button></footer></form>`;
    dialog.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      if (key !== this.chatKey() || epoch !== this.epoch || branch !== this.core.branchHashes(this.context().chat).at(-1)) { dialog.close(); this.notify('История изменилась. Откройте форму заново.'); return; }
      const data = new FormData(event.target); dialog.close();
      void this.generateWriting(article.id, { form: String(data.get('form')), request: String(data.get('request') || '') });
    });
    dialog.showModal(); dialog.querySelector('select').focus();
  }
  async generateWriting(articleId, options = {}) {
    if (this.working || !this.enabled() || !this.hasChat()) return false;
    const c = this.context(), core = this.core, anchor = c.chat.length - 1, message = c.chat[anchor];
    const ledger = core.readCodex(c.chat), article = ledger.articles.find(item => item.id === articleId);
    if (!article) { this.notify('Статья больше недоступна.'); return false; }
    if ((article.pages || []).length >= 12) { this.notify('В статье уже 12 литературных записей.'); return false; }
    const settings = this.settings(), input = core.writingInput(c.chat, anchor, article, settings, options);
    const key = this.chatKey(), epoch = this.epoch, branch = ledger.hashes[anchor], profileKey = JSON.stringify(input.profile);
    this.working = true; this.workingKind = 'writing'; this.paintStatus();
    try {
      const raw = await this.env.request('write', input);
      const latest = this.context();
      if (key !== this.chatKey() || epoch !== this.epoch || latest.chat.length - 1 !== anchor || latest.chat[anchor] !== message || core.branchHashes(latest.chat)[anchor] !== branch) { this.status = 'История изменилась: литературная запись пропущена.'; return false; }
      if (!this.enabled() || JSON.stringify(core.collectionProfile(this.settings())) !== profileKey) { this.status = 'Настройки изменились: запись не сохранена.'; return false; }
      const decoded = core.decodeWriting(raw, input);
      if (decoded.skip) { this.notify(decoded.reason); return false; }
      const result = core.addWriting(ledger.articles, articleId, decoded, anchor);
      if (!result.added) { this.notify('Такая запись уже есть в статье.'); return false; }
      const previous = core.messageRecord(message);
      const record = { ...(previous?.branch === branch ? structuredClone(previous) : {}), format: 1, branch, swipe: message.swipe_id ?? 0, articles: result.articles, deletedArticles: ledger.deletedArticles, sceneTerms: Object.fromEntries(ledger.scenes), terms: ledger.scenes.get(anchor) || [], savedAt: new Date().toISOString() };
      const old = message.extra?.[core.STORE] ? structuredClone(message.extra[core.STORE]) : undefined;
      const swipe = message.swipe_id ?? 0, oldSwipe = message.swipe_info?.[swipe]?.extra?.[core.STORE] ? structuredClone(message.swipe_info[swipe].extra[core.STORE]) : undefined;
      core.storeRecord(message, record);
      try { await latest.saveChat(); }
      catch (error) {
        if (old) message.extra[core.STORE] = old; else delete message.extra[core.STORE];
        const extra = message.swipe_info?.[swipe]?.extra;
        if (extra) { if (oldSwipe) extra[core.STORE] = oldSwipe; else delete extra[core.STORE]; }
        throw error;
      }
      this.selected = articleId; this.status = `Добавлена запись «${decoded.title}»`;
      this.revealWriting = true;
      return true;
    } catch (error) { this.notify(error.message || 'Не удалось написать запись.', true); return false; }
    finally {
      this.working = false; this.workingKind = null; this.refresh();
      if (this.revealWriting && this.dialog.open) { this.dialog.querySelector('.bl-writing-section')?.scrollIntoView({ block: 'start', behavior: 'instant' }); this.revealWriting = false; }
      const pending = this.pending; this.pending = null;
      if (pending && pending.key === this.chatKey()) queueMicrotask(() => { void this.collect(pending.target); });
    }
  }
  paintStatus() {
    if (!this.dialog) return;
    const prefs = this.settings(), profile = this.core.collectionProfile(prefs);
    const label = prefs.language === 'custom' ? profile.outputLanguage : this.core.LANGUAGES[prefs.language][0];
    this.dialog.querySelector('#bl-status-text').textContent = this.working ? (this.workingKind === 'editing' ? 'Сохраняю изменение…' : this.workingKind === 'writing' ? 'Пишу запись из мира…' : 'Собираю сведения о мире…') : `${this.status} · ${label}`;
    this.dialog.querySelector('[data-action=collect]').disabled = !!this.working || !this.hasChat() || !this.enabled();
    this.dialog.querySelectorAll('[data-action=write]').forEach(button => { button.disabled = !!this.working || !this.hasChat() || !this.enabled(); });
    document.querySelectorAll('#bl-codex [data-action=edit-page],#bl-codex [data-action=delete-page],#bl-page-editor [type=submit],#bl-page-delete [type=submit]').forEach(button => { button.disabled = !!this.working || !this.hasChat(); });
    document.querySelectorAll('#bl-codex [data-action=edit-article],#bl-codex [data-action=delete-article],#bl-article-editor [type=submit],#bl-article-delete [type=submit]').forEach(button => { button.disabled = !!this.working || !this.hasChat(); });
    document.querySelectorAll('#bl-codex [data-action=ask],#bl-question [type=submit]').forEach(button => { button.disabled = !!this.working || !this.hasChat() || !this.enabled(); });
    if (this.workingKind === 'question') this.dialog.querySelector('#bl-status-text').textContent = 'Ищу ответ и составляю статью…';
  }
  toggleFavorite() {
    const prefs = this.settings();
    prefs.favorites = prefs.favorites.includes(this.selected) ? prefs.favorites.filter(id => id !== this.selected) : [...prefs.favorites, this.selected];
    this.saveSettings(prefs); this.prefs = prefs; this.drawList(); this.drawArticle();
  }
  openSettings() {
    if (!this.hasChat()) { this.openConnectionDialog(); return; }
    const key = this.chatKey(), epoch = this.epoch, prefs = this.settings(), core = this.core;
    if (!this.settingsDialog) { this.settingsDialog = document.createElement('dialog'); this.settingsDialog.id = 'bl-settings'; this.settingsDialog.setAttribute('aria-label', 'Настройки кодекса Между строк'); document.body.append(this.settingsDialog); }
    const dialog = this.settingsDialog;
    dialog.innerHTML = `<form><header><div><div class="bl-eyebrow">МЕЖДУ СТРОК</div><h2>Настройки кодекса</h2></div><button type="button" data-cancel aria-label="Закрыть">${this.icon('close')}</button></header><label>Язык сбора<select name="language" id="bl-language">${Object.entries(core.LANGUAGES).map(([id, labels]) => `<option value="${id}"${prefs.language === id ? ' selected' : ''}>${labels[0]}</option>`).join('')}<option value="custom"${prefs.language === 'custom' ? ' selected' : ''}>Другой язык…</option></select></label><label id="bl-custom-label">Название языка<input name="customLanguage" maxlength="80" value="${this.escape(prefs.customLanguage)}" placeholder="Например: Turkish"></label><p class="bl-help">Промпт заполнения — на английском. Выбранный язык используется для новых описаний и сведений. Старые статьи автоматически не переводятся.</p><div class="bl-two-fields"><label>Окно сбора, сообщений<input name="window" type="number" min="1" max="100" required value="${prefs.window}"></label><label>Фандом / версия<input name="fandom" maxlength="200" value="${this.escape(prefs.fandom)}" placeholder="Книга, игра, редакция…"></label></div><label class="bl-toggle"><input type="checkbox" name="auto"${prefs.auto ? ' checked' : ''}>Собирать после ответа персонажа</label><label class="bl-toggle"><input type="checkbox" name="showTerms"${prefs.showTerms ? ' checked' : ''}>Показывать термины под сообщениями</label><label class="bl-toggle"><input type="checkbox" name="lorebook"${prefs.lorebook ? ' checked' : ''}>Использовать активированные записи лорбука</label><label class="bl-toggle"><input type="checkbox" name="canon"${prefs.canon ? ' checked' : ''}>Дополнять базовым каноном указанного фандома</label><p class="bl-help">Канонические пояснения берутся из знаний модели и помечаются отдельно. Без названия фандома используются только разрешённые источники переписки и лорбука.</p><label>Граница спойлеров<textarea name="spoilerBoundary" maxlength="600" rows="2" placeholder="Например: только пролог, без будущих событий">${this.escape(prefs.spoilerBoundary)}</textarea></label><label>Что известно о вашем персонаже<textarea name="character" maxlength="1200" rows="2" placeholder="Происхождение, профессия и знакомство с миром">${this.escape(prefs.character)}</textarea></label><footer><button type="button" data-cancel>Отмена</button><button type="submit" class="bl-primary">Сохранить</button></footer></form>`;
    const language = dialog.querySelector('#bl-language'), custom = dialog.querySelector('[name=customLanguage]');
    const connectionSection = document.createElement('section'); connectionSection.className = 'bl-connection-section';
    connectionSection.innerHTML = this.connectionControlsHTML(); dialog.querySelector('header').after(connectionSection);
    const cadence = document.createElement('label'); cadence.className = 'bl-auto-every';
    cadence.innerHTML = `Собирать каждые N ответов персонажа<input name="autoEvery" type="number" min="1" max="100" step="1" required value="${prefs.autoEvery}"><span class="bl-help">1 — после каждого ответа, 3 — после каждого третьего. Счётчик отдельный для этого чата. Кнопка «Обновить» запускает сбор сразу. Объём прочитанной истории задаёт «Окно сбора».</span>`;
    const autoToggle = dialog.querySelector('[name=auto]'); autoToggle.closest('label').after(cadence);
    const syncAuto = () => { cadence.querySelector('input').disabled = !autoToggle.checked; };
    autoToggle.addEventListener('change', syncAuto); syncAuto();
    const sync = () => { const visible = language.value === 'custom'; dialog.querySelector('#bl-custom-label').hidden = !visible; custom.disabled = !visible; custom.required = visible; custom.setCustomValidity(''); };
    language.addEventListener('change', sync); custom.addEventListener('input', () => custom.setCustomValidity('')); sync();
    dialog.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      if (key !== this.chatKey() || epoch !== this.epoch || !this.hasChat()) { dialog.close(); return; }
      if (language.value === 'custom' && !custom.value.trim()) { custom.setCustomValidity('Укажите название языка.'); custom.reportValidity(); return; }
      if (!this.saveConnectionForm(dialog.querySelector('form'))) return;
      const data = new FormData(event.target), next = this.settings();
      for (const name of ['language', 'fandom', 'spoilerBoundary', 'character']) next[name] = String(data.get(name) || '');
      if (language.value === 'custom') next.customLanguage = String(data.get('customLanguage') || '');
      next.window = Number(data.get('window'));
      next.autoEvery = Number(dialog.querySelector('[name=autoEvery]').value);
      for (const name of ['auto', 'showTerms', 'lorebook', 'canon']) next[name] = data.has(name);
      this.saveSettings(next); dialog.close(); this.refresh();
    });
    dialog.showModal(); language.focus();
  }
  lastAssistant() { return (this.context().chat || []).findLastIndex(message => !message.is_user && !message.is_system && String(message.mes || '').trim()); }
  async collect(target, manual = false) {
    this.mount();
    if (!this.enabled() || !this.hasChat() || (!manual && !this.settings().auto)) return false;
    const c = this.context(), message = c.chat[target];
    if (!message || message.is_user || message.is_system || ['...', '…', ''].includes(String(message.mes || '').trim()) || String(message.mes).includes('Proxy error')) { if (manual) this.notify('Для сбора нужен ответ персонажа.'); return false; }
    if (this.working) { if (!manual) this.pending = { target, key: this.chatKey() }; return false; }
    const core = this.core, settings = this.settings(), branch = core.branchHashes(c.chat)[target], profileKey = core.hash(JSON.stringify({ profile: core.collectionProfile(settings), window: settings.window }));
    const previous = core.messageRecord(message);
    if (!manual && previous?.branch === branch && previous.profileKey === profileKey) return false;
    const ledger = core.readCodex(c.chat), session = this.articleSession(), known = ledger.articles, input = core.collectionInput(c.chat, target, known, settings);
    const key = this.chatKey(), epoch = this.epoch; this.working = true; this.paintStatus();
    try {
      const raw = await this.env.request('collect', input);
      const latest = this.context();
      if (key !== this.chatKey() || epoch !== this.epoch || latest.chat[target] !== message || core.branchHashes(latest.chat)[target] !== branch) { this.status = 'История изменилась: устаревший результат пропущен.'; return false; }
      const currentPrefs = this.settings();
      if (!this.enabled() || (!manual && !currentPrefs.auto) || profileKey !== core.hash(JSON.stringify({ profile: core.collectionProfile(currentPrefs), window: currentPrefs.window }))) { this.status = 'Настройки изменились: обновите кодекс с выбранным языком.'; return false; }
      const result = core.integrate(known, core.decodeCollection(raw, input), target, ledger.deletedArticles);
      await this.commitArticles(session, { articles: result.articles, deletedArticles: ledger.deletedArticles }, { scene: target, terms: result.terms, profileKey, language: input.profile.outputLanguage });
      if (key === this.chatKey() && epoch === this.epoch) this.env.collectionSaved?.(target);
      this.status = result.added ? `Новых статей: ${result.added}` : 'Справка к сцене обновлена';
      return true;
    } catch (error) { this.notify(error.message || 'Не удалось собрать сведения.', true); return false; }
    finally {
      this.working = false; this.refresh(); const pending = this.pending; this.pending = null;
      if (pending && pending.key === this.chatKey()) queueMicrotask(() => { void this.collect(pending.target); });
    }
  }
  drawTerms() {
    const root = document.getElementById('chat'); if (!root) return;
    const allowed = this.enabled() && this.prefs.showTerms;
    if (!allowed) { root.querySelectorAll('.bl-terms').forEach(block => block.remove()); return; }
    const chat = this.context().chat || [], articles = this.ledger.articles;
    root.querySelectorAll('.mes[mesid]').forEach(element => {
      const id = Number(element.getAttribute('mesid')), message = chat[id]; let block = element.querySelector('.bl-terms');
      if (!message || message.is_user || message.is_system || element.querySelector('.edit_textarea')) { block?.remove(); return; }
      const termIds = this.ledger.scenes.get(id);
      const sentence = ` ${this.core.identity(message.mes)} `;
      const entries = articles.filter(article => termIds ? termIds.includes(article.id) : article.firstSeen <= id && [article.name, ...article.aliases, ...(article.identityNames || [])].some(name => sentence.includes(` ${this.core.identity(name)} `))).slice(0, 8);
      if (!entries.length) { block?.remove(); return; }
      const key = `${this.chatKey()}/${id}/${this.ledger.hashes[id]}`, choice = this.expanded.get(key) || {};
      const active = entries.find(article => article.id === choice.id), visible = choice.more ? entries : entries.slice(0, 4);
      const signature = this.core.hash(JSON.stringify({ key, choice, entries: entries.map(article => [article.id, article.name, article.category, article.definition]) }));
      if (block?.dataset.signature === signature) return;
      if (!block) { block = document.createElement('section'); block.className = 'bl-terms'; block.setAttribute('aria-label', 'Пояснения к сцене'); const text = element.querySelector('.mes_text'); if (text) text.after(block); else (element.querySelector('.mes_block') || element).append(block); }
      block.dataset.key = key; block.dataset.signature = signature;
      block.innerHTML = `<header><span>${this.icon('compass')}На полях <small>${entries.length}</small></span><button type="button" data-term-action="codex">В кодекс ${this.icon('arrow')}</button></header><div class="bl-term-chips">${visible.map(article => `<button type="button" data-term-id="${this.escape(article.id)}" class="${article.id === active?.id ? 'active' : ''}" aria-expanded="${article.id === active?.id}" aria-controls="bl-definition-${id}"><span class="bl-dot" data-category="${article.category}"></span>${this.escape(article.name)}${this.icon('chevron')}</button>`).join('')}${entries.length > 4 ? `<button type="button" data-term-action="more" class="bl-more">${choice.more ? 'Свернуть' : `Ещё ${entries.length - 4}`}</button>` : ''}</div><div class="bl-definition" id="bl-definition-${id}"${active ? '' : ' hidden'}>${active ? `<div><strong>${this.escape(active.name)}</strong><button type="button" data-term-action="collapse" aria-label="Свернуть пояснение">${this.icon('close')}</button></div><p>${this.escape(active.definition)}</p><footer><span>${this.core.CATEGORIES[active.category]} · Кодекс мира</span><button type="button" data-term-article="${this.escape(active.id)}">Читать в кодексе ${this.icon('arrow')}</button></footer>` : ''}</div>`;
    });
  }
  termClick(button) {
    if (!this.enabled()) return;
    const block = button.closest('.bl-terms'), key = block.dataset.key, choice = { ...(this.expanded.get(key) || {}) };
    if (button.dataset.termArticle) { this.open(button.dataset.termArticle); return; }
    if (button.dataset.termAction === 'codex') { this.open(); return; }
    const focusId = button.dataset.termId || choice.id;
    if (button.dataset.termId) choice.id = choice.id === button.dataset.termId ? null : button.dataset.termId;
    if (button.dataset.termAction === 'collapse') choice.id = null;
    if (button.dataset.termAction === 'more') choice.more = !choice.more;
    this.expanded.set(key, choice); this.drawTerms();
    [...block.querySelectorAll('[data-term-id]')].find(item => item.dataset.termId === focusId)?.focus({ preventScroll: true });
  }
  showSource(id) {
    const message = this.context().chat[id]; if (!message) return;
    if (!this.sourceDialog) { this.sourceDialog = document.createElement('dialog'); this.sourceDialog.id = 'bl-source'; document.body.append(this.sourceDialog); }
    this.sourceDialog.setAttribute('aria-label', `Источник, сообщение ${id}`);
    this.sourceDialog.innerHTML = `<header><h2>Сообщение #${id}</h2><button type="button" aria-label="Закрыть">${this.icon('close')}</button></header><div class="bl-source-text"></div>`;
    this.sourceDialog.querySelector('.bl-source-text').textContent = String(message.mes);
    this.sourceDialog.querySelector('button').onclick = () => this.sourceDialog.close(); this.sourceDialog.showModal();
  }
  exportJSON() {
    const data = { format: 'between-lines-codex', version: 1, articles: this.ledger.articles, favorites: this.settings().favorites, notes: this.settings().notes };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'between-lines-codex.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
