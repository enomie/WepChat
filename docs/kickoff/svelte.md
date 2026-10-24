# Svelte 5 Architektur & State Management

Dieses Dokument beschreibt die modulare UI- und Store-Architektur der Extension mit **Svelte 5 Runes** und WXT.

> **Hinweis zur Projektstruktur:**  
> Das Setup und die Konfiguration von WXT (`wxt.config.ts`, `manifest`, Entrypoints) sind in [setup.md](file:///Users/johann/MyBrew/WepChat/docs/kickoff/setup.md) dokumentiert. Hier liegt der Fokus rein auf den State-Modulen (`$state`, Runes) und der Chat-UI-Komponente.

---

### 1. URL-Erkennung & Sanitizing (`src/lib/url.svelte.ts`)

In Svelte 5 nutzen wir moderne Runes (`$state`), um den URL-State reaktiv zur Verfügung zu stellen.

```typescript
// src/lib/url.svelte.ts
export function createUrlState() {
  let url = $state<string>('');

  function cleanUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      if (!parsed.protocol.startsWith('http')) return '';
      // Entfernt Query- & Hash-Parameter, um Raum-Fragmentierung zu verhindern
      return parsed.origin + parsed.pathname;
    } catch {
      return '';
    }
  }

  async function updateActiveUrl() {
    if (typeof browser !== 'undefined' && browser.tabs) {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) {
          url = cleanUrl(tab.url);
        }
      } catch (err) {
        console.error('Fehler beim Abrufen des Tabs:', err);
      }
    }
  }

  // Initial auslesen & Listener registrieren
  updateActiveUrl();

  if (typeof browser !== 'undefined' && browser.tabs) {
    browser.tabs.onActivated.addListener(() => updateActiveUrl());
    browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
      if (changeInfo.url) updateActiveUrl();
    });
  }

  return {
    get current() {
      return url;
    },
  };
}

export const urlState = createUrlState();
```

---

### 2. Anonymes Profil im Browser (`src/lib/profile.svelte.ts`)

Das Profil wird anonym und lokal in `browser.storage.local` gehalten und kann jederzeit geändert werden.

```typescript
// src/lib/profile.svelte.ts
export interface Profile {
  username: string;
  avatarColor: string;
}

const defaultProfile: Profile = {
  username: 'Anon_' + Math.floor(1000 + Math.random() * 9000),
  avatarColor: '#' + Math.floor(Math.random() * 16777215).toString(16),
};

export function createProfileState() {
  let profile = $state<Profile>({ ...defaultProfile });

  // Aus browser.storage laden
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    browser.storage.local.get('userProfile').then((res) => {
      if (res.userProfile) {
        profile = res.userProfile as Profile;
      } else {
        browser.storage.local.set({ userProfile: defaultProfile });
      }
    });
  }

  async function setUsername(newUsername: string) {
    const trimmed = newUsername.trim();
    if (!trimmed) return;
    profile.username = trimmed;
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      await browser.storage.local.set({ userProfile: $state.snapshot(profile) });
    }
  }

  return {
    get current() {
      return profile;
    },
    setUsername,
  };
}

export const profileState = createProfileState();
```

---

### 3. Svelte 5 Chat UI Komponente (`src/App.svelte`)

Hier fließen URL-Tracking, Profil und spätere SpacetimeDB-Reducers zusammen. Die Syntax nutzt Svelte 5 (`$state`, `$effect`, `onclick`, `onkeydown`).

```svelte
<script lang="ts">
  import { urlState } from './lib/url.svelte';
  import { profileState } from './lib/profile.svelte';

  interface MessageItem {
    sender: string;
    text: string;
    timestamp?: number;
  }

  let messages = $state<MessageItem[]>([]);
  let onlineCount = $state(1);
  let newMessage = $state('');
  let showSettings = $state(false);

  // Reagiert auf URL-Wechsel (z. B. Tab gewechselt oder navigiert)
  $effect(() => {
    const currentUrl = urlState.current;
    if (currentUrl) {
      joinRoom(currentUrl);
    }
  });

  function joinRoom(url: string) {
    // Platzhalter für SpacetimeDB Reducer `set_online_location`
    console.log(`Raum beigetreten für: ${url}`);
    messages = [];
  }

  function sendMessage() {
    if (!newMessage.trim()) return;
    // SpacetimeDB Reducer `send_message` wird hier angebunden
    messages.push({
      sender: profileState.current.username,
      text: newMessage.trim(),
      timestamp: Date.now(),
    });
    newMessage = '';
  }
</script>

<main class="chat-container">
  <!-- Header: Online-Status & Einstellungen -->
  <header>
    <div class="status">
      <span class="online-dot"></span>
      <span class="online-text">
        <strong>{onlineCount}</strong> {onlineCount === 1 ? 'Person' : 'Personen'} online
      </span>
    </div>
    <button class="icon-btn" onclick={() => (showSettings = !showSettings)} title="Profil bearbeiten">
      ⚙️ Profil
    </button>
  </header>

  <!-- URL / Raum Anzeige -->
  <div class="room-bar">
    <span class="room-label">Raum:</span>
    <span class="room-url">{urlState.current || 'Keine Website aktiv'}</span>
  </div>

  <!-- Profil-Einstellungen (einblendbar) -->
  {#if showSettings}
    <div class="settings-box">
      <label for="username-input">Dein Pseudonym:</label>
      <div class="settings-input-group">
        <input
          id="username-input"
          type="text"
          value={profileState.current.username}
          onchange={(e) => profileState.setUsername(e.currentTarget.value)}
        />
      </div>
    </div>
  {/if}

  <!-- Chat Verlauf -->
  <div class="messages">
    {#if messages.length === 0}
      <div class="empty-state">
        Noch keine Nachrichten auf dieser Seite. Sei der Erste!
      </div>
    {:else}
      {#each messages as msg}
        <div class="message-bubble {msg.sender === profileState.current.username ? 'own' : ''}">
          <span class="sender">{msg.sender}</span>
          <span class="text">{msg.text}</span>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Eingabezeile -->
  <footer class="input-box">
    <input
      type="text"
      bind:value={newMessage}
      placeholder="Nachricht schreiben..."
      onkeydown={(e) => e.key === 'Enter' && sendMessage()}
    />
    <button onclick={sendMessage} disabled={!newMessage.trim()}>
      Senden
    </button>
  </footer>
</main>

<style>
  .chat-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #ffffff;
    color: #1e293b;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
  }

  .online-dot {
    width: 8px;
    height: 8px;
    background: #22c55e;
    border-radius: 50%;
  }

  .room-bar {
    display: flex;
    gap: 6px;
    padding: 6px 14px;
    background: #f1f5f9;
    border-bottom: 1px solid #e2e8f0;
    font-size: 0.75rem;
  }

  .room-label {
    font-weight: 600;
    color: #64748b;
  }

  .room-url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #334155;
  }

  .icon-btn {
    background: transparent;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .settings-box {
    padding: 10px 14px;
    background: #fefce8;
    border-bottom: 1px solid #fef08a;
    font-size: 0.8rem;
  }

  .settings-box input {
    margin-top: 4px;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    box-sizing: border-box;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty-state {
    margin: auto;
    text-align: center;
    color: #94a3b8;
    font-size: 0.85rem;
  }

  .message-bubble {
    background: #f1f5f9;
    padding: 8px 12px;
    border-radius: 8px;
    max-width: 80%;
    align-self: flex-start;
  }

  .message-bubble.own {
    background: #dbeafe;
    align-self: flex-end;
  }

  .sender {
    font-weight: 600;
    font-size: 0.75rem;
    display: block;
    color: #475569;
    margin-bottom: 2px;
  }

  .text {
    font-size: 0.85rem;
    line-height: 1.35;
    word-break: break-word;
  }

  .input-box {
    display: flex;
    padding: 10px;
    gap: 8px;
    border-top: 1px solid #e2e8f0;
    background: #ffffff;
  }

  .input-box input {
    flex: 1;
    padding: 8px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 0.85rem;
  }

  .input-box button {
    padding: 8px 14px;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
  }

  .input-box button:disabled {
    background: #94a3b8;
    cursor: not-allowed;
  }
</style>
```
