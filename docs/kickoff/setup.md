# Projekt-Setup & Schritt-für-Schritt-Anleitung

Anleitung, um das Projekt im Entwickler-Ordner aufzusetzen.

Wir nutzen dafür **WXT** (Cross-Browser Extension Framework mit Manifest V3 Support), **Svelte 5** sowie die **aktuelle SpacetimeDB Client SDK** (`spacetimedb`).

---

### Schritt 1: Terminal öffnen & Projekt initialisieren

Navigiere im Terminal in deinen Entwickler-Ordner:

```bash
cd /Users/johann/MyBrew/WepChat
```

Erstelle das WXT-Projekt mit dem WXT-CLI:

```bash
npx -y wxt@latest init url-chat-extension
```

Im Auswahldialog wählst du:
1. **Framework:** `Svelte`
2. **Language:** `TypeScript`
3. **Package Manager:** `npm` (oder `pnpm` / `bun`)

Danach in das neu erstellte Verzeichnis wechseln:

```bash
cd url-chat-extension
```

---

### Schritt 2: SpacetimeDB SDK installieren

Installiere das offizielle SpacetimeDB Package:

```bash
npm install spacetimedb
```

> **Hinweis:** Nicht mehr das alte Paket `@clockworklabs/spacetimedb-sdk` verwenden, da dieses deprecated ist.

---

### Schritt 3: WXT Konfiguration für Side Panel anpassen (`wxt.config.ts`)

In WXT wird das Chrome Side Panel über `side_panel.default_path` konfiguriert. Für Firefox kommt `sidebar_action` zum Einsatz.

Passe `wxt.config.ts` wie folgt an:

```typescript
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'WepChat - URL Chat & Presence',
    description: 'Echtzeit-Chat und Presence-Tracker pro Webseiten-URL',
    version: '1.0.0',
    permissions: ['sidePanel', 'tabs', 'storage', 'activeTab'],
    // Chrome Side Panel Configuration
    side_panel: {
      default_path: 'sidepanel.html',
    },
    // Firefox Sidebar Configuration
    sidebar_action: {
      default_panel: 'sidepanel.html',
      default_title: 'WepChat',
    },
    action: {
      default_title: 'Chat im Side Panel öffnen',
    },
  },
});
```

---

### Schritt 4: Ordnerstruktur & Entrypoints aufbauen

WXT nutzt dateibasierte Entrypoints im Ordner `src/entrypoints/`.

#### 1. Side Panel HTML (`src/entrypoints/sidepanel.html`)
WXT erkennt HTML-Dateien direkt im Entrypoints-Ordner:

```html
<!DOCTYPE html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WepChat</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./sidepanel/main.ts"></script>
  </body>
</html>
```

#### 2. Svelte 5 Mount Entrypoint (`src/entrypoints/sidepanel/main.ts`)
In Svelte 5 wird die Anwendung über `mount` initialisiert:

```typescript
import { mount } from 'svelte';
import App from '../../App.svelte';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Root element #app nicht gefunden');
}

const app = mount(App, {
  target,
});

export default app;
```

#### 3. Background Service Worker (`src/entrypoints/background.ts`)
Öffnet das Side Panel beim Klick auf das Action-Icon. Der **Live-Badge** wird nur im Sidepanel über WebSocket gepflegt (kein URL-HTTP im Background). Details: [live_badge.md](../requirements/live_badge.md).

Beispiel (nur Side-Panel-Verhalten, verkürzt):

```typescript
export default defineBackground(() => {
  // Öffnet das Side Panel automatisch beim Klick auf das Action-Icon
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error('Fehler bei setPanelBehavior:', error));
  }
});
```

---

### Schritt 5: Svelte App Component anlegen (`src/App.svelte`)

Hier ist die Hauptkomponente mit **Svelte 5 Runes** (`$state`), sauberem URL-Sanitizing (Entfernen von Tracking- und Query-Parametern gemäß Konzept) und robuster Tab-Überwachung (sowohl Tab-Wechsel als auch URL-Updates im selben Tab):

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  let currentUrl = $state('');
  let username = $state('Anon_' + Math.floor(1000 + Math.random() * 9000));
  let messageText = $state('');
  let messages = $state<{ sender: string; text: string }[]>([]);

  // Bereinigt Tracking-/Query-Parameter aus der URL
  function cleanUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      // Nur http(s) URLs tracken, interne Browser-URLs ignorieren
      if (!parsed.protocol.startsWith('http')) return '';
      return parsed.origin + parsed.pathname;
    } catch {
      return '';
    }
  }

  async function updateActiveUrl() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        currentUrl = cleanUrl(tab.url);
      }
    } catch (err) {
      console.error('Fehler beim Abrufen des aktiven Tabs:', err);
    }
  }

  onMount(() => {
    // Profil aus storage laden
    browser.storage.local.get('username').then((stored) => {
      if (stored.username) username = stored.username as string;
    });

    // Initiale URL abfragen
    updateActiveUrl();

    // 1. Wenn der Benutzer zu einem anderen Tab wechselt
    const onActivated = () => updateActiveUrl();
    browser.tabs.onActivated.addListener(onActivated);

    // 2. Wenn der Benutzer im aktuellen Tab auf eine neue URL navigiert
    const onUpdated = (tabId: number, changeInfo: { url?: string }) => {
      if (changeInfo.url) {
        updateActiveUrl();
      }
    };
    browser.tabs.onUpdated.addListener(onUpdated);

    // Cleanup Listener bei Unmount
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  });

  function sendMessage() {
    if (!messageText.trim()) return;
    messages.push({ sender: username, text: messageText.trim() });
    messageText = '';
  }
</script>

<main style="padding: 1rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; height: 100vh; box-sizing: border-box; display: flex; flex-direction: column;">
  <header style="margin-bottom: 0.75rem;">
    <h2 style="margin: 0 0 0.25rem 0; font-size: 1.2rem;">WepChat</h2>
    <p style="margin: 0; font-size: 0.8rem; word-break: break-all; color: #666;">
      <strong>Raum:</strong> {currentUrl || 'Keine unterstützte Website aktiv'}
    </p>
    <p style="margin: 0.25rem 0 0 0; font-size: 0.75rem; color: #888;">
      Als: <strong>{username}</strong>
    </p>
  </header>

  <div style="flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; overflow-y: auto; padding: 0.75rem; margin-bottom: 0.75rem; background: #fafafa; display: flex; flex-direction: column; gap: 0.5rem;">
    {#if messages.length === 0}
      <div style="margin: auto; color: #94a3b8; font-size: 0.85rem;">Noch keine Nachrichten in diesem Raum.</div>
    {:else}
      {#each messages as msg}
        <div style="font-size: 0.85rem; line-height: 1.4;">
          <span style="font-weight: 600; color: #2563eb;">{msg.sender}:</span>
          <span style="color: #1e293b;">{msg.text}</span>
        </div>
      {/each}
    {/if}
  </div>

  <div style="display: flex; gap: 0.5rem;">
    <input 
      type="text" 
      bind:value={messageText} 
      placeholder="Nachricht schreiben..." 
      onkeydown={(e) => e.key === 'Enter' && sendMessage()}
      style="flex: 1; padding: 0.5rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.85rem;"
    />
    <button 
      onclick={sendMessage}
      style="padding: 0.5rem 1rem; background: #2563eb; color: white; border: none; border-radius: 4px; font-weight: 500; cursor: pointer;">
      Senden
    </button>
  </div>
</main>
```

---

### Schritt 6: Entwicklungs-Server starten

Starte den WXT Development Server:

```bash
npm run dev
```

**Was passiert beim Start?**
* WXT kompiliert das Svelte-Projekt und startet eine isolierte Browser-Instanz (Standard: Chrome), in der die Extension direkt geladen ist.
* **HMR (Hot Module Replacement)** aktualisiert das Side Panel automatisch bei Code-Änderungen.
* Sobald der Dev-Server läuft, kann über das Extension-Icon in der Symbolleiste das Side Panel geöffnet und getestet werden.