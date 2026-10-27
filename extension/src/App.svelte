<script lang="ts">
  import { onMount } from 'svelte';
  import { urlState } from './lib/url.svelte';
  import { profileState } from './lib/profile.svelte';
  import { messageIsMine, spacetimeChat } from './lib/spacetime.svelte';
  import { rateLimitState } from './lib/rate-limit.svelte';
  import {
    filterMessageInput,
    isUsernameReadyForCommit,
    MAX_MESSAGE_LENGTH,
    MIN_USERNAME_LENGTH,
    MAX_USERNAME_LENGTH,
    prepareMessageForSend,
    prepareUsername,
  } from './lib/message-text-policy';
  import {
    applyScrollAnchorAfterPrepend,
    hasOlderMessages,
    shouldAutoScrollToBottom,
    visibleMessagesSlice,
  } from './lib/message-history';
  import { tick } from 'svelte';
  import profileIcon from './assets/icons/profile.svg?raw';
  import infoIcon from './assets/icons/info.svg?raw';
  import trashIcon from './assets/icons/trash.svg?raw';
  import { connectionErrorMessage, locale, t, tPlural } from './lib/i18n';
  import { formatMessageAgeIso, formatMessageAgeLabel } from './lib/message-age-label';
  import {
    RATE_LIMIT_MAX_SENDS,
    RATE_LIMIT_WINDOW_MS,
  } from './lib/rate-limit.svelte';
  import { NICK_COLORS, nickColorStyles, normalizeNickColorId } from './lib/nick-colors';
  import { WEPCHAT_GREEN } from './lib/brand-colors';

  const rateLimitWindowMinutes = RATE_LIMIT_WINDOW_MS / 60_000;

  let newMessage = $state('');
  let showSettings = $state(false);
  let showInfo = $state(false);
  let messagesContainer: HTMLDivElement | null = null;
  let initialScrollDoneForUrl = $state<string | null>(null);
  let lastMessageCount = $state(0);
  let messageAgeNowMs = $state(Date.now());
  let usernameDraft = $state(profileState.current.username);
  let usernameInputFocused = $state(false);

  const chatIdentity = $derived(spacetimeChat.current.identity);
  const chatRoomName = $derived(spacetimeChat.current.roomDisplayName);

  const committedUsernameLabel = $derived(
    spacetimeChat.current.connected && spacetimeChat.current.roomDisplayName
      ? spacetimeChat.current.roomDisplayName
      : profileState.current.username
  );

  // Connect once when the side panel loads
  onMount(() => {
    spacetimeChat.connect();
    const tickId = setInterval(() => rateLimitState.bumpTick(), 1000);
    const ageTickId = setInterval(() => {
      messageAgeNowMs = Date.now();
    }, 30_000);
    return () => {
      clearInterval(tickId);
      clearInterval(ageTickId);
      spacetimeChat.disconnect();
    };
  });

  const cooldownMs = $derived(rateLimitState.cooldownRemainingMs());
  const cooldownSecs = $derived(Math.ceil(cooldownMs / 1000));
  const rateLimited = $derived(cooldownMs > 0);

  const tabChat = $derived(urlState.tab);

  $effect(() => {
    showSettings;
    committedUsernameLabel;
    if (usernameInputFocused) return;
    usernameDraft = committedUsernameLabel;
  });

  // Subscribe to room when URL, profile, and connection are ready
  $effect(() => {
    const tab = tabChat;
    const username = profileState.current.username;
    const nickColorId = profileState.current.nickColorId;
    const connected = spacetimeChat.current.connected;

    if (tab.kind === 'ready' && username && connected) {
      spacetimeChat.subscribeToUrl(tab.url, username, nickColorId);
    } else if (connected) {
      spacetimeChat.clearRoomPresence();
    }
  });

  const visibleMessages = $derived(
    visibleMessagesSlice(
      spacetimeChat.current.messages,
      spacetimeChat.current.visibleLimit
    )
  );

  const showLoadOlder = $derived(
    hasOlderMessages(
      spacetimeChat.current.messages.length,
      spacetimeChat.current.visibleLimit
    )
  );

  // Reset initial scroll when the room URL changes
  $effect(() => {
    const url = urlState.current;
    if (url !== initialScrollDoneForUrl) {
      initialScrollDoneForUrl = null;
    }
  });

  // Initial scroll and auto-scroll when the user is near the bottom
  $effect(() => {
    const url = urlState.current;
    const msgs = spacetimeChat.current.messages;
    const count = msgs.length;
    const container = messagesContainer;

    if (!url || !count || !container) {
      lastMessageCount = count;
      return;
    }

    const isInitial = initialScrollDoneForUrl !== url;
    const grew = count > lastMessageCount;
    lastMessageCount = count;

    if (isInitial || (grew && shouldAutoScrollToBottom(container))) {
      setTimeout(() => {
        if (!messagesContainer) return;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        if (isInitial) {
          initialScrollDoneForUrl = url;
        }
      }, 50);
    }
  });

  async function handleLoadOlder() {
    const container = messagesContainer;
    if (!container) return;
    const prevHeight = container.scrollHeight;
    const prevTop = container.scrollTop;
    spacetimeChat.loadOlderVisible();
    await tick();
    if (messagesContainer) {
      applyScrollAnchorAfterPrepend(messagesContainer, prevHeight, prevTop);
    }
  }

  function handleMessageInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    newMessage = filterMessageInput(el.value);
  }

  function handleMessagePaste() {
    queueMicrotask(() => {
      newMessage = filterMessageInput(newMessage);
    });
  }

  function handleUsernameFocus() {
    usernameInputFocused = true;
  }

  function handleUsernameBlur() {
    usernameInputFocused = false;
    const prepared = prepareUsername(usernameDraft);
    if (isUsernameReadyForCommit(prepared)) {
      profileState.setUsername(prepared);
    }
    usernameDraft = committedUsernameLabel;
  }

  function handleUsernameInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const filtered = filterMessageInput(el.value, MAX_USERNAME_LENGTH);
    usernameDraft = filtered;
    const prepared = prepareUsername(filtered);
    if (isUsernameReadyForCommit(prepared)) {
      profileState.setUsername(prepared);
    }
    el.value = usernameDraft;
  }

  function selectNickColor(id: number) {
    profileState.setNickColorId(id);
  }

  function handleColorSwatchKeydown(e: KeyboardEvent, index: number) {
    const cols = 3;
    let next = index;
    if (e.key === 'ArrowRight') next = Math.min(NICK_COLORS.length - 1, index + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, index - 1);
    else if (e.key === 'ArrowDown') next = Math.min(NICK_COLORS.length - 1, index + cols);
    else if (e.key === 'ArrowUp') next = Math.max(0, index - cols);
    else return;
    e.preventDefault();
    const target = NICK_COLORS[next];
    if (!target) return;
    selectNickColor(target.id);
    const el = document.getElementById(`nick-color-${target.id}`);
    el?.focus();
  }

  function handleSend() {
    const url = urlState.current;
    const username = profileState.current.username;
    const text = prepareMessageForSend(newMessage);
    if (!text || !url || !spacetimeChat.current.connected) return;
    if (!rateLimitState.canSend()) return;
    spacetimeChat.sendMessage(url, username, text);
    newMessage = '';
  }

  const canSendMessage = $derived(
    prepareMessageForSend(newMessage).length > 0 && !rateLimited
  );

</script>

<main class="chat-container" style="--wepchat-green: {WEPCHAT_GREEN}">
  <!-- Header -->
  <header>
    <div class="status">
      <span class="dot {spacetimeChat.current.connected ? 'online' : 'offline'}"></span>
      <span class="status-text">
        {#if spacetimeChat.current.error}
          <span class="err">{t('status.connectionError')}</span>
        {:else if spacetimeChat.current.connected}
          {tPlural('status.online', spacetimeChat.current.onlineCount, {
            count: spacetimeChat.current.onlineCount,
          })}
        {:else}
          {t('status.connecting')}
        {/if}
      </span>
    </div>
    <div class="header-actions">
      <button
        type="button"
        class="icon-btn"
        class:active={showInfo}
        title={t('header.infoTitle')}
        aria-label={t('header.infoAria')}
        aria-expanded={showInfo}
        onclick={() => (showInfo = !showInfo)}
      >
        {@html infoIcon}
      </button>
      <button
        type="button"
        class="icon-btn"
        class:active={showSettings}
        title={t('header.profileTitle')}
        aria-label={t('header.profileAria')}
        aria-expanded={showSettings}
        onclick={() => (showSettings = !showSettings)}
      >
        {@html profileIcon}
      </button>
    </div>
  </header>

  <div class="room-bar">
    <span class="label">{t('room.label')}</span>
    <span
      class="url"
      title={tabChat.kind === 'ready' ? tabChat.url : ''}
    >
      {#if tabChat.kind === 'ready'}
        {tabChat.url}
      {:else if tabChat.kind === 'unsupported'}
        {t('room.unsupportedShort')}
      {:else}
        {t('room.noActiveTab')}
      {/if}
    </span>
  </div>

  {#if showInfo}
    <div class="info-panel">
      <p><strong>{t('info.ideaTitle')}</strong></p>
      <p class="info-idea-text">{t('info.ideaText')}</p>
      <p class="info-idea-text">{t('info.ideaPanelText')}</p>
      <p class="info-idea-text">{t('info.ideaRetentionText')}</p>
      <p class="info-faq-heading"><strong>{t('info.title')}</strong></p>
      <ul>
        <li>{t('info.safety1')}</li>
        <li>{t('info.safety2')}</li>
        <li>{t('info.safety3')}</li>
        <li>{t('info.safety4')}</li>
        <li>{t('info.safety5')}</li>
        <li>{t('info.safety6')}</li>
      </ul>
      <p class="info-faq-heading"><strong>{t('info.faqTitle')}</strong></p>
      <ul>
        <li>{t('info.faq1')}</li>
        <li>{t('info.faq2')}</li>
        <li>{t('info.faq3')}</li>
        <li>{t('info.faq4')}</li>
        <li>{t('info.faq5')}</li>
        <li>{t('info.faq6')}</li>
        <li>{t('info.faq7')}</li>
      </ul>
      <p class="info-contact">{t('info.contact')}</p>
      <section class="info-storage-section" aria-labelledby="info-storage-heading">
        <p id="info-storage-heading" class="info-faq-heading">
          <strong>{t('info.storageTitle')}</strong>
        </p>
        <p class="info-storage-intro">{t('info.storageIntro')}</p>
        <table class="info-storage-table">
          <thead>
            <tr>
              <th scope="col">{t('info.storageColTable')}</th>
              <th scope="col">{t('info.storageColData')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('info.storageUserSession')}</td>
              <td>{t('info.storageUserSessionData')}</td>
            </tr>
            <tr>
              <td>{t('info.storageChatMessage')}</td>
              <td>{t('info.storageChatMessageData')}</td>
            </tr>
            <tr>
              <td>{t('info.storageInternal')}</td>
              <td>{t('info.storageInternalData')}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  {/if}

  {#if showSettings}
    <div class="settings-panel">
      <label for="username-input" class="settings-field-label">
        <strong>{t('settings.pseudonymLabel')}</strong>
      </label>
      <input
        id="username-input"
        type="text"
        minlength={MIN_USERNAME_LENGTH}
        maxlength={MAX_USERNAME_LENGTH}
        value={usernameDraft}
        onfocus={handleUsernameFocus}
        onblur={handleUsernameBlur}
        oninput={handleUsernameInput}
      />
      <span id="nick-color-label" class="settings-field-label">
        <strong>{t('settings.colorLabel')}</strong>
      </span>
      <div
        class="color-swatches"
        role="radiogroup"
        aria-labelledby="nick-color-label"
      >
        {#each NICK_COLORS as color, i (color.id)}
          <button
            id="nick-color-{color.id}"
            type="button"
            class="color-swatch"
            class:selected={profileState.current.nickColorId === color.id}
            role="radio"
            aria-checked={profileState.current.nickColorId === color.id}
            aria-label={t(`settings.colors.${color.key}`)}
            style="--swatch: {color.hex}"
            onclick={() => selectNickColor(color.id)}
            onkeydown={(e) => handleColorSwatchKeydown(e, i)}
          ></button>
        {/each}
      </div>
      {#if spacetimeChat.current.error}
        <p class="err-detail">{connectionErrorMessage(spacetimeChat.current.error)}</p>
      {/if}
    </div>
  {/if}

  <div class="messages" bind:this={messagesContainer}>
    {#if tabChat.kind === 'unsupported'}
      <div class="empty">{t('messages.unsupportedSite')}</div>
    {:else if tabChat.kind === 'none'}
      <div class="empty">{t('messages.openTab')}</div>
    {:else if !spacetimeChat.current.connected}
      <div class="empty">
        {spacetimeChat.current.error
          ? connectionErrorMessage(spacetimeChat.current.error)
          : t('messages.connectingToServer')}
      </div>
    {:else if spacetimeChat.current.messages.length === 0}
      <div class="empty">{t('messages.empty')}</div>
    {:else}
      {#if showLoadOlder}
        <button type="button" class="load-older-btn" onclick={handleLoadOlder}>
          {t('messages.loadOlder')}
        </button>
      {/if}
      {#each visibleMessages as msg (msg.id)}
        {@const nickStyles = nickColorStyles(normalizeNickColorId(msg.senderNickColor))}
        {@const mine = messageIsMine(
          msg,
          chatIdentity,
          chatRoomName,
          profileState.current.username
        )}
        {@const ageLabel = formatMessageAgeLabel(
          msg.createdAt,
          locale,
          messageAgeNowMs,
          t('messageAge.justNow')
        )}
        {#if mine}
          <div class="message-row own">
            <button
              type="button"
              class="delete-msg-btn"
              aria-label={t('messages.deleteAria')}
              title={t('messages.deleteAria')}
              onclick={() => spacetimeChat.deleteOwnMessage(msg.id)}
            >
              {@html trashIcon}
            </button>
            <div class="bubble own" style:background={nickStyles.bubbleBackground}>
              <div class="bubble-meta">
                <span class="sender" style:color={nickStyles.senderColor}>{msg.senderName}</span>
                <time class="message-age" datetime={formatMessageAgeIso(msg.createdAt)}>{ageLabel}</time>
              </div>
              <span class="text">{msg.text}</span>
            </div>
          </div>
        {:else}
          <div class="bubble" style:background={nickStyles.bubbleBackground}>
            <div class="bubble-meta">
              <span class="sender" style:color={nickStyles.senderColor}>{msg.senderName}</span>
              <time class="message-age" datetime={formatMessageAgeIso(msg.createdAt)}>{ageLabel}</time>
            </div>
            <span class="text">{msg.text}</span>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <footer class="input-area">
    <div class="input-row">
      <input
        type="text"
        class:muted={rateLimited}
        maxlength={MAX_MESSAGE_LENGTH}
        value={newMessage}
        oninput={handleMessageInput}
        onpaste={handleMessagePaste}
        placeholder={tabChat.kind === 'unsupported'
          ? t('input.placeholderUnsupported')
          : tabChat.kind !== 'ready'
          ? t('input.placeholderNoTab')
          : !spacetimeChat.current.connected
            ? t('input.placeholderConnecting')
            : rateLimited
              ? t('input.placeholderCooldown', { seconds: cooldownSecs })
              : t('input.placeholderCompose')}
        disabled={!urlState.current || !spacetimeChat.current.connected || rateLimited}
        onkeydown={(e) => e.key === 'Enter' && handleSend()}
      />
      <button
        onclick={handleSend}
        class:muted={rateLimited}
        disabled={!canSendMessage || !spacetimeChat.current.connected || !urlState.current}
      >
        {rateLimited ? `${cooldownSecs}s` : t('input.send')}
      </button>
    </div>
    {#if spacetimeChat.current.connected && urlState.current}
      <p class="rate-hint">
        {t('input.rateLimitHint', {
          max: RATE_LIMIT_MAX_SENDS,
          windowMinutes: rateLimitWindowMinutes,
        })}
      </p>
    {/if}
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .chat-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #fff;
    color: #1e293b;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
  }

  .status { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; }

  .dot {
    width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
  }
  .dot.online {
    background: var(--wepchat-green);
    box-shadow: 0 0 5px color-mix(in srgb, var(--wepchat-green) 53%, transparent);
  }
  .dot.offline { background: #f59e0b; box-shadow: 0 0 5px #f59e0b88; }

  .err { color: #ef4444; }

  .header-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    color: #475569;
    background: transparent;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    cursor: pointer;
  }

  .icon-btn:hover {
    background: #f1f5f9;
    color: #1e293b;
  }

  .icon-btn.active {
    background: #e2e8f0;
    border-color: #94a3b8;
    color: #0f172a;
  }

  .info-panel {
    padding: 10px 14px;
    background: color-mix(in srgb, var(--wepchat-green) 16%, white);
    border-bottom: 1px solid color-mix(in srgb, var(--wepchat-green) 32%, white);
    font-size: 0.78rem;
    line-height: 1.45;
    flex: 1 1 auto;
    min-height: 0;
    max-height: min(52vh, calc(100vh - 11rem));
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .info-panel p {
    margin: 0 0 6px;
  }

  .info-panel .info-idea-text {
    margin-bottom: 8px;
    color: #334155;
  }

  .info-panel .info-storage-section {
    margin-top: 2px;
  }

  .info-panel .info-storage-section .info-faq-heading {
    margin-top: 10px;
  }

  .info-panel .info-storage-intro {
    margin-bottom: 6px;
    color: #334155;
  }

  .info-panel .info-storage-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4px;
    color: #334155;
    font-size: 0.72rem;
  }

  .info-panel .info-storage-table th,
  .info-panel .info-storage-table td {
    border: 1px solid color-mix(in srgb, var(--wepchat-green) 28%, #cbd5e1);
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
  }

  .info-panel .info-storage-table th {
    background: color-mix(in srgb, var(--wepchat-green) 10%, white);
    font-weight: 600;
  }

  .info-panel .info-storage-table td:first-child {
    width: 38%;
    word-break: break-word;
  }

  .info-panel .info-faq-heading {
    margin-top: 10px;
  }

  .info-panel .info-contact {
    margin: 10px 0 0;
    color: #334155;
  }

  .info-panel ul {
    margin: 0;
    padding-left: 1.1rem;
    color: #334155;
  }

  .info-panel li {
    margin-bottom: 4px;
  }

  .room-bar {
    display: flex;
    gap: 6px;
    padding: 5px 14px;
    background: #f1f5f9;
    border-bottom: 1px solid #e2e8f0;
    font-size: 0.72rem;
    flex-shrink: 0;
  }
  .label { font-weight: 600; color: #64748b; white-space: nowrap; }
  .url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155; }

  .settings-panel {
    padding: 10px 14px;
    background: #f1f5f9;
    border-bottom: 1px solid #e2e8f0;
    font-size: 0.8rem;
    flex-shrink: 0;
  }
  .settings-panel input {
    display: block;
    margin-top: 4px;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    box-sizing: border-box;
    font-size: 0.82rem;
  }
  .settings-field-label {
    display: block;
    margin-top: 0;
    color: #1e293b;
  }
  .settings-field-label strong {
    font-weight: 600;
  }
  .settings-field-label + input {
    margin-top: 4px;
  }
  #nick-color-label.settings-field-label {
    margin-top: 10px;
  }
  .color-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
  }
  .color-swatch {
    width: 32px;
    height: 32px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    background: var(--swatch);
    cursor: pointer;
    box-shadow: inset 0 0 0 2px #fff;
  }
  .color-swatch.selected {
    border-color: #334155;
    box-shadow: inset 0 0 0 2px #fff, 0 0 0 1px #334155;
  }
  .color-swatch:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }
  .err-detail { margin: 4px 0 0; font-size: 0.7rem; color: #ef4444; word-break: break-all; }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty {
    margin: auto;
    text-align: center;
    color: #94a3b8;
    font-size: 0.82rem;
    line-height: 1.5;
    padding: 20px;
  }

  .load-older-btn {
    align-self: center;
    margin-bottom: 4px;
    padding: 6px 12px;
    font-size: 0.75rem;
    color: #2563eb;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .load-older-btn:hover {
    background: #dbeafe;
  }

  .bubble {
    padding: 8px 12px;
    border-radius: 10px;
    max-width: 82%;
    align-self: flex-start;
    word-break: break-word;
  }
  .message-row.own {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    align-self: flex-end;
    max-width: 88%;
  }
  .message-row.own .bubble {
    flex: 1;
    min-width: 0;
    max-width: 100%;
  }
  .bubble-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 2px;
  }
  .delete-msg-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #94a3b8;
    cursor: pointer;
  }
  .delete-msg-btn :global(svg) {
    display: block;
    width: 14px;
    height: 14px;
  }
  .delete-msg-btn:hover {
    color: #dc2626;
  }
  .delete-msg-btn:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 1px;
  }
  .sender {
    font-size: 0.7rem;
    font-weight: 600;
  }
  .message-age {
    font-size: 0.72rem;
    font-weight: 400;
    color: #94a3b8;
  }
  .text { font-size: 0.84rem; line-height: 1.35; }

  .input-area {
    display: flex;
    flex-direction: column;
    padding: 10px;
    gap: 6px;
    border-top: 1px solid #e2e8f0;
    background: #fff;
    flex-shrink: 0;
  }
  .input-row {
    display: flex;
    gap: 8px;
  }
  .rate-hint {
    margin: 0;
    font-size: 0.68rem;
    color: #94a3b8;
  }
  .input-area input.muted,
  .input-area button.muted {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .input-area input {
    flex: 1;
    padding: 8px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 0.84rem;
    outline: none;
  }
  .input-area input:focus { border-color: #2563eb; }
  .input-area button {
    padding: 8px 14px;
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.84rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .input-area button:disabled { background: #94a3b8; cursor: not-allowed; }
</style>
