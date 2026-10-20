Object.assign(BetweenLinesApp.prototype, {
  connectionControlsHTML() {
    const config = this.env.connection.settings(), profiles = this.env.connection.profiles();
    const missing = config.profileId && !profiles.some(profile => profile.id === config.profileId);
    return `<label>Профиль подключения<select name="connectionProfile" data-bl-profile><option value="">Выберите профиль…</option>${missing ? `<option value="${this.escape(config.profileId)}" selected>Профиль недоступен — выберите другой</option>` : ''}${profiles.map(profile => `<option value="${this.escape(profile.id)}"${profile.id === config.profileId ? ' selected' : ''}>${this.escape(profile.name)}</option>`).join('')}</select></label><p class="bl-help">Профили из менеджера подключений Tavern. Используются для сборщика, вопросов и «Голосов мира». Основное подключение чата остаётся выбранным как прежде.</p><div class="bl-two-fields"><label>Лимит ответа, токенов<input name="connectionMaxTokens" type="number" min="512" max="32000" step="1" required value="${config.maxTokens}"></label><label>Температура<input name="connectionTemperature" type="number" min="0" max="2" step="0.05" required value="${config.temperature}"></label></div>`;
  },
  saveConnectionForm(form) {
    if (!form.reportValidity()) return false;
    const profileId = form.querySelector('[name=connectionProfile]').value;
    if (profileId && !this.env.connection.profiles().some(profile => profile.id === profileId)) { this.notify('Выберите доступный профиль подключения.', true); return false; }
    const config = { ...this.env.connection.settings(), profileId, maxTokens: Number(form.querySelector('[name=connectionMaxTokens]').value), temperature: Number(form.querySelector('[name=connectionTemperature]').value) };
    this.saveConnectionSettings(config); return true;
  },
  saveConnectionSettings(value) {
    const before = JSON.stringify(this.env.connection.settings()), config = connectionSettings(value);
    this.context().extensionSettings[EXTENSION_KEY] = config;
    if (JSON.stringify(config) !== before) this.env.connection.cancel();
    this.context().saveSettingsDebounced?.();
    this.refreshConnectionControls(); this.refresh();
  },
  setupExtensionSettings() {
    if (document.getElementById('between-lines-extension-settings')) return;
    const root = document.createElement('div'); root.id = 'between-lines-extension-settings'; root.className = 'extension_container';
    root.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Между строк · Кодекс</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><label class="bl-native-toggle"><input type="checkbox" data-bl-enabled> Включить кодекс</label><p class="bl-native-profile" data-bl-current-profile></p><div class="bl-native-buttons"><button type="button" class="menu_button" data-bl-connect>Подключение</button><button type="button" class="menu_button" data-bl-open>Открыть кодекс</button></div><p class="bl-native-help">Статьи, пояснения под сообщениями и «Голоса мира». Язык, источники и автосбор настраиваются в кодексе.</p></div></div>`;
    (document.getElementById('extensions_settings') || document.body).append(root);
    root.querySelector('[data-bl-enabled]').onchange = event => this.saveConnectionSettings({ ...this.env.connection.settings(), enabled: event.target.checked });
    root.querySelector('[data-bl-connect]').onclick = () => this.openConnectionDialog();
    root.querySelector('[data-bl-open]').onclick = () => this.open();
    this.refreshConnectionControls();
  },
  refreshConnectionControls() {
    const config = this.env.connection.settings(), profiles = this.env.connection.profiles();
    const root = document.getElementById('between-lines-extension-settings');
    if (root) {
      root.querySelector('[data-bl-enabled]').checked = config.enabled;
      root.querySelector('[data-bl-current-profile]').textContent = 'Подключение: ' + (profiles.find(profile => profile.id === config.profileId)?.name || 'не выбрано или недоступно');
    }
    for (const select of document.querySelectorAll('[data-bl-profile]')) {
      // Keep an unsaved selection while a profile is renamed or created.
      const value = select.value || config.profileId;
      select.replaceChildren(new Option('Выберите профиль…', ''), ...profiles.map(profile => new Option(profile.name, profile.id)));
      if (value && !profiles.some(profile => profile.id === value)) select.append(new Option('Профиль недоступен — выберите другой', value));
      select.value = value;
    }
  },
  openConnectionDialog() {
    const dialog = this.articleDialog('bl-connection', 'Подключение кодекса');
    dialog.innerHTML = `<form><header><div><div class="bl-eyebrow">МЕЖДУ СТРОК</div><h2>Подключение кодекса</h2></div><button type="button" data-cancel aria-label="Закрыть">${this.icon('close')}</button></header>${this.connectionControlsHTML()}<footer><button type="button" data-cancel>Отмена</button><button type="submit" class="bl-primary">Сохранить</button></footer></form>`;
    dialog.querySelectorAll('[data-cancel]').forEach(button => button.onclick = () => dialog.close());
    dialog.querySelector('form').onsubmit = event => { event.preventDefault(); if (this.saveConnectionForm(event.target)) { dialog.close(); this.notify('Подключение кодекса сохранено'); } };
    dialog.showModal(); dialog.querySelector('select').focus();
  },
});
