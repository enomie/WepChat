<script lang="ts">
  import { onMount } from 'svelte';
  import { urlState } from './lib/url.svelte';
  import { profileState } from './lib/profile.svelte';
  import { spacetimeChat } from './lib/spacetime.svelte';
  import { rateLimitState } from './lib/rate-limit.svelte';
  import { filterMessageInput, prepareMessageForSend } from './lib/message-text-policy';
  import {
    applyScrollAnchorAfterPrepend,
    hasOlderMessages,
    shouldAutoScrollToBottom,
    visibleMessagesSlice,
  } from './lib/message-history';
  import { tick } from 'svelte';
  import profileIcon from './assets/icons/profile.svg?raw';
  import infoIcon from './assets/icons/info.svg?raw';

  let newMessage = $state('');
  let showSettings = $state(false);
  let showInfo = $state(false);
  let messagesContainer: HTMLDivElement | null = null;
  let initialScrollDoneForUrl = $state<string | null>(null);
  let lastMessageCount = $state(0);

  // Verbindung einmalig beim Laden aufbauen
  onMount(() => {
    spacetimeChat.connect();
    const tickId = setInterval(() => rateLimitState.bumpTick(), 1000);
    return () => {
      clearInterval(tickId);
      spacetimeChat.disconnect();
    };
  });

  const cooldownMs = $derived(rateLimitState.cooldownRemainingMs());
  const cooldownSecs = $derived(Math.ceil(cooldownMs / 1000));
  const rateLimited = $derived(cooldownMs > 0);

  // Sobald URL + Username + connected: Raum abonnieren
  $effect(() => {
    const url = urlState.current;
    const username = profileState.current.username;
    const connected = spacetimeChat.current.connected;

    if (url && username && connected) {
      spacetimeChat.subscribeToUrl(url, username);
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

  // Raumwechsel: erneut einmal nach unten scrollen
  $effect(() => {
    const url = urlState.current;
    if (url !== initialScrollDoneForUrl) {
      initialScrollDoneForUrl = null;
    }
  });

  // Initial-Scroll + Auto-Scroll nur wenn Nutzer unten
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

  function handleUsernameInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const filtered = filterMessageInput(el.value);
    el.value = filtered;
    profileState.setUsername(filtered);
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

<main class="chat-container">
  <!-- Header -->
  <header>
    <div class="status">
      <span class="dot {spacetimeChat.current.connected ? 'online' : 'offline'}"></span>
      <span class="status-text">
        {#if spacetimeChat.current.error}
          <span class="err">Verbindungsfehler</span>
        {:else if spacetimeChat.current.connected}
          <strong>{spacetimeChat.current.onlineCount}</strong>
          {spacetimeChat.current.onlineCount === 1 ? ' Person' : ' Personen'} online
        {:else}
          Verbinde…
        {/if}
      </span>
    </div>
    <div class="header-actions">
      <button
        type="button"
        class="icon-btn"
        class:active={showInfo}
        title="Info & Datenschutz"
        aria-label="Info und Datenschutz"
        aria-expanded={showInfo}
        onclick={() => (showInfo = !showInfo)}
      >
        {@html infoIcon}
      </button>
      <button
        type="button"
        class="icon-btn"
        class:active={showSettings}
        title="Profil"
        aria-label="Profil bearbeiten"
        aria-expanded={showSettings}
        onclick={() => (showSettings = !showSettings)}
      >
        {@html profileIcon}
      </button>
    </div>
  </header>

  <!-- Raum-URL -->
  <div class="room-bar">
    <span class="label">Raum:</span>
    <span class="url" title={urlState.current || ''}>{urlState.current || 'Kein Tab aktiv'}</span>
  </div>

  {#if showInfo}
    <div class="info-panel">
      <p><strong>Anonym & lokal</strong></p>
      <ul>
        <li>Kein Login — Pseudonym und Profil nur in diesem Browser gespeichert.</li>
        <li>URLs werden bereinigt, damit ihr im gleichen Raum landet.</li>
        <li>Server sieht deine SpacetimeDB-Identity, nicht deinen echten Namen.</li>
      </ul>
    </div>
  {/if}

  <!-- Profil-Einstellungen -->
  {#if showSettings}
    <div class="settings-panel">
      <label for="username-input">Pseudonym:</label>
      <input
        id="username-input"
        type="text"
        value={profileState.current.username}
        oninput={handleUsernameInput}
      />
      {#if spacetimeChat.current.identity}
        <p class="identity">ID: {spacetimeChat.current.identity.slice(0, 16)}…</p>
      {/if}
      {#if spacetimeChat.current.error}
        <p class="err-detail">{spacetimeChat.current.error}</p>
      {/if}
    </div>
  {/if}

  <!-- Chat-Verlauf -->
  <div class="messages" bind:this={messagesContainer}>
    {#if !urlState.current}
      <div class="empty">Öffne einen Website-Tab um den Chat zu laden.</div>
    {:else if !spacetimeChat.current.connected}
      <div class="empty">
        {spacetimeChat.current.error ? '⚠️ ' + spacetimeChat.current.error : 'Verbinde mit Server…'}
      </div>
    {:else if spacetimeChat.current.messages.length === 0}
      <div class="empty">Noch keine Nachrichten. Sei der Erste! 👋</div>
    {:else}
      {#if showLoadOlder}
        <button type="button" class="load-older-btn" onclick={handleLoadOlder}>
          Ältere Nachrichten laden
        </button>
      {/if}
      {#each visibleMessages as msg (msg.id)}
        <div class="bubble {msg.senderName === profileState.current.username ? 'own' : ''}">
          <span class="sender">{msg.senderName}</span>
          <span class="text">{msg.text}</span>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Eingabe -->
  <footer class="input-area">
    <div class="input-row">
      <input
        type="text"
        class:muted={rateLimited}
        value={newMessage}
        oninput={handleMessageInput}
        onpaste={handleMessagePaste}
        placeholder={!urlState.current
          ? 'Kein Tab aktiv'
          : !spacetimeChat.current.connected
            ? 'Verbinde…'
            : rateLimited
              ? `Noch ${cooldownSecs}s…`
              : 'Nachricht schreiben…'}
        disabled={!urlState.current || !spacetimeChat.current.connected || rateLimited}
        onkeydown={(e) => e.key === 'Enter' && handleSend()}
      />
      <button
        onclick={handleSend}
        class:muted={rateLimited}
        disabled={!canSendMessage || !spacetimeChat.current.connected || !urlState.current}
      >
        {rateLimited ? `${cooldownSecs}s` : 'Senden'}
      </button>
    </div>
    {#if spacetimeChat.current.connected && urlState.current}
      <p class="rate-hint">Max. 2 Nachrichten pro Minute.</p>
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
  .dot.online  { background: #22c55e; box-shadow: 0 0 5px #22c55e88; }
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
    background: #f0f9ff;
    border-bottom: 1px solid #bae6fd;
    font-size: 0.78rem;
    line-height: 1.45;
    flex-shrink: 0;
  }

  .info-panel p {
    margin: 0 0 6px;
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
    background: #fefce8;
    border-bottom: 1px solid #fef08a;
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
  .identity { margin: 6px 0 0; font-size: 0.7rem; color: #854d0e; }
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
    background: #f1f5f9;
    padding: 8px 12px;
    border-radius: 10px;
    max-width: 82%;
    align-self: flex-start;
    word-break: break-word;
  }
  .bubble.own {
    background: #dbeafe;
    align-self: flex-end;
  }
  .sender {
    display: block;
    font-size: 0.7rem;
    font-weight: 600;
    color: #475569;
    margin-bottom: 2px;
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
