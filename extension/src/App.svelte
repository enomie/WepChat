<script lang="ts">
  import { onMount } from 'svelte';
  import { urlState } from './lib/url.svelte';
  import { profileState } from './lib/profile.svelte';
  import { spacetimeChat } from './lib/spacetime.svelte';
  import { rateLimitState } from './lib/rate-limit.svelte';

  let newMessage = $state('');
  let showSettings = $state(false);
  let messagesContainer: HTMLDivElement | null = null;

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

  // Auto-Scroll
  $effect(() => {
    const msgs = spacetimeChat.current.messages;
    if (msgs.length && messagesContainer) {
      setTimeout(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }, 50);
    }
  });

  function handleSend() {
    const url = urlState.current;
    const username = profileState.current.username;
    if (!newMessage.trim() || !url || !spacetimeChat.current.connected) return;
    if (!rateLimitState.canSend()) return;
    spacetimeChat.sendMessage(url, username, newMessage.trim());
    newMessage = '';
  }
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
    <button class="settings-btn" onclick={() => (showSettings = !showSettings)}>
      ⚙️ Profil
    </button>
  </header>

  <!-- Raum-URL -->
  <div class="room-bar">
    <span class="label">Raum:</span>
    <span class="url" title={urlState.current || ''}>{urlState.current || 'Kein Tab aktiv'}</span>
  </div>

  <!-- Profil-Einstellungen -->
  {#if showSettings}
    <div class="settings-panel">
      <label for="username-input">Pseudonym:</label>
      <input
        id="username-input"
        type="text"
        value={profileState.current.username}
        onchange={(e) => profileState.setUsername(e.currentTarget.value)}
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
      {#each spacetimeChat.current.messages as msg (msg.id)}
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
        bind:value={newMessage}
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
        disabled={!newMessage.trim() || !spacetimeChat.current.connected || !urlState.current || rateLimited}
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

  .settings-btn {
    background: transparent;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 0.75rem;
    cursor: pointer;
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
