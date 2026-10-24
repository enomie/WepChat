# SpacetimeDB Backend Guide (Rust & Realtime)

Dieses Dokument beschreibt das Setup, die Tabellenstrukturen, Lifecycle-Hooks und Reducers für das Backend in `server/src/lib.rs` sowie den TypeScript-Codegen für die Extension.

---

### Referenzen & Links
* Offizielle Website: https://spacetimedb.com/
* Installation: https://spacetimedb.com/install
* Dokumentation: https://spacetimedb.com/docs/
* **Live Dashboard deiner Datenbank:** https://spacetimedb.com/wepchat

---

### Phase 1: SpacetimeDB CLI installieren & einloggen

Führe im Terminal die Installation des CLI durch:

**macOS / Linux:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://spacetimedb.com/install.sh | sh
```

Danach die CLI mit deinem SpacetimeDB-Account verbinden:
```bash
spacetime login
```
*(Es öffnet sich ein Browserfenster zur Bestätigung der Anmeldung.)*

> **Sicherheit:** Dieses Login ist **nur für Entwickler** (Publish, Verwaltung). Es gehört **nicht** in die Browser-Extension. URI, Modulname und Client-Identity sind ein anderes Thema — siehe [security.md](../requirements/security.md).

---

### Phase 2: Backend-Projekt initialisieren

Navigiere in den Projekt-Root (`/Users/johann/MyBrew/WepChat`) und initialisiere das Server-Modul in Rust:

```bash
cd /Users/johann/MyBrew/WepChat
spacetime init --lang rust server
```

Dadurch wird der Ordner `server/` mit `Cargo.toml` und `src/lib.rs` angelegt.

---

### Phase 3: Backend-Code (`server/src/lib.rs`)

Die Implementierung nutzt die SpacetimeDB 2.0 `ctx.db`-API inklusive automatischer Disconnect-Behandlung (`client_disconnected` Lifecycle-Hook):

```rust
use spacetimedb::{table, reducer, Identity, Timestamp, ReducerContext, Table};

// 1. Tabelle für aktive Online-User pro URL (Presence)
#[table(name = user_session, public)]
pub struct UserSession {
    #[primary_key]
    pub identity: Identity,
    pub current_url: String,
    pub username: String,
    pub joined_at: Timestamp,
}

// 2. Tabelle für Chat-Nachrichten
// Indizes + kein iter() auf send_message: docs/requirements/server-query-patterns.md
#[table(name = chat_message, public)]
pub struct ChatMessage {
    #[auto_inc]
    #[primary_key]
    pub id: u64,
    pub url: String,
    pub sender_identity: Identity,
    pub sender_name: String,
    pub text: String,
    pub created_at: Timestamp,
}

// 3. Lifecycle-Hook: Automatische Presence-Bereinigung bei Verbindungsabbruch
#[reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    ctx.db.user_session().identity().delete(&ctx.sender);
    log::info!("User getrennt: {:?}", ctx.sender);
}

// 4. Reducer: Raum betreten / URL wechseln
#[reducer]
pub fn join_room(ctx: &ReducerContext, url: String, username: String) {
    let clean_url = url.trim().to_string();
    if clean_url.is_empty() {
        return;
    }

    let sessions = ctx.db.user_session();
    if let Some(mut existing) = sessions.identity().find(&ctx.sender) {
        existing.current_url = clean_url;
        existing.username = username;
        existing.joined_at = ctx.timestamp;
        sessions.identity().update(existing);
    } else {
        sessions.insert(UserSession {
            identity: ctx.sender,
            current_url: clean_url,
            username,
            joined_at: ctx.timestamp,
        });
    }
}

// 5. Reducer: Raum verlassen
#[reducer]
pub fn leave_room(ctx: &ReducerContext) {
    ctx.db.user_session().identity().delete(&ctx.sender);
}

// 6. Reducer: Nachricht senden
#[reducer]
pub fn send_message(ctx: &ReducerContext, url: String, username: String, text: String) {
    let clean_text = text.trim().to_string();
    let clean_url = url.trim().to_string();

    if clean_text.is_empty() || clean_url.is_empty() {
        return;
    }

    ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        url: clean_url,
        sender_identity: ctx.sender,
        sender_name: username,
        text: clean_text,
        created_at: ctx.timestamp,
    });
}
```

---

### Phase 4: Backend publizieren & TypeScript-Bindings generieren

1. **Backend bauen und publizieren:**
   ```bash
   cd /Users/johann/MyBrew/WepChat/server
   spacetime publish wepchat -y
   ```

2. **TypeScript-Bindings für die Extension (inkl. Index-`accessor`-Patch):**
   ```bash
   cd /Users/johann/MyBrew/WepChat/server
   spacetime publish wepchat -y

   cd ../extension
   npm run codegen:stdb
   ```
   (`codegen:stdb` = `spacetime generate --module-path ../server` + `scripts/patch-spacetimedb-codegen.js` — siehe [learnings.md](../learnings.md#2-typescript-bindings-fehlendes-index-accessor).)

> **Wichtiger Workflow:**  
> Nach Änderungen in `server/src/lib.rs`: `spacetime publish wepchat -y`, dann `cd extension && npm run codegen:stdb`, danach `npm run build` und Extension neu laden.

---

### Wichtige Architektur- & SpacetimeDB-Prinzipien

1. **Kryptografische Identitäten (`ctx.sender`):**  
   SpacetimeDB vergibt jedem verbundenen Client automatisch eine manipulationssichere `Identity`. User müssen sich nicht registrieren; die Identität ist der Primärschlüssel.
2. **Automatischer Disconnect (`#[reducer(client_disconnected)]`):**  
   Schließt ein Nutzer den Tab oder verliert die Verbindung, feuert SpacetimeDB diesen Reducer serverseitig. So bleibt der Presence-Zähler verlässlich aktuell.
3. **Subscriptions im Sidepanel:**  
   Das Sidepanel nutzt WebSocket-Subscriptions (`chat_message` / `user_session` pro URL) — Push statt Polling. Der **Background Service Worker** für den Live-Badge nutzt zusätzlich einen leichten **HTTP-SQL**-Count (siehe [live_badge.md](../requirements/live_badge.md), [security.md](../requirements/security.md)).

---

### Wichtige Client- & Extension-Hinweise (Gotchas)
* **Chrome Extension CSP (`unsafe-eval`)**: SpacetimeDB generiert intern dynamische Serializer via `new Function(...)`. Dies wird im Build über das Patch-Skript `scripts/patch-spacetimedb.js` automatisch auf statische Interpreter umgeschrieben.
* **Reducer-Aufruf-Konvention**: Reducer werden im TypeScript SDK in **CamelCase** aufgerufen und erwarten ein **Parameter-Objekt** (z. B. `conn.reducers.joinRoom({ url, username })`).
* **Codegen / Index-`accessor`:** immer `npm run codegen:stdb` in `extension/` — [learnings.md](../learnings.md#2-typescript-bindings-fehlendes-index-accessor).
* **Nachrichten-Inhalt:** `send_message` und `join_room` validieren erlaubte Zeichen — [message-content.md](../requirements/message-content.md).
* **Kein `chat_message().iter()` auf dem Send-Pfad:** Rate-Limit/Echo über Hilfstabellen, Purge über `created_at`-Index — [server-query-patterns.md](../requirements/server-query-patterns.md), [learnings.md §11](../learnings.md#11-kein-chat_message-vollscan-in-reducern).
* Detaillierte Dokumentation dazu siehe: [learnings.md](../learnings.md).

---

### Nachrichten-Retention (72 Stunden)

Chat-Nachrichten werden **nur serverseitig** gelöscht — **beide** Mechanismen zusammen (Doppel-Absicherung). Kein Client-Filter in der Subscription; die Extension lädt weiter `SELECT * FROM chat_message WHERE url = …` und erhält Deletes per Push.

Vollständige Spezifikation: [security-list.md](../requirements/security-list.md#6-nachrichten-retention-72-stunden).

| Mechanismus | Rolle |
|-------------|--------|
| **A — Scheduled Delete pro Nachricht** | Punktgenau ~72 h nach `created_at`; Echtzeit-Delete für Subscribers |
| **B — Wiederkehrender Cleanup** | Fängt verpasste Timer, Reste und Alt-Daten ab |

**A — Scheduled Table `delete_message_schedule`:** Nach `insert` in `send_message` eine Zeile mit `scheduled_at = created_at + 72h` (einmalig) → Reducer `delete_message`. Idempotent.

**B — Scheduled Table `purge_expired_schedule`:** Intervall **15 Min** (`ScheduleAt` aus `TimeDuration`) → Reducer `purge_expired_messages` löscht `created_at < now - 72h`. Bootstrap: `init` + `ensure_purge_job` in `join_room` / `send_message`.

Implementierung: [server/src/lib.rs](../../server/src/lib.rs).

**Bewusst nicht:** Nur in der Extension ältere Nachrichten ausblenden — das wäre keine echte Retention ([security-list.md](../requirements/security-list.md)).

---

### Virtuelle Räume (keine `Room`-Tabelle)

Es gibt absichtlich **keine `Room`-Tabelle**. Ein Raum existiert nur durch Zeilen in `user_session` / `chat_message` mit passender `url`.

#### URLs sind rein virtuelle Räume
Es gibt bei dir absichtlich **keine `Room`-Tabelle**, in der Räume gespeichert werden müssten. 
* Ein Raum „existiert“ in SpacetimeDB einfach dadurch, dass in `user_session` (wer schaut gerade zu?) oder `chat_message` (was wurde geschrieben?) die Spalte `url` diesen Wert hat.
* Wenn niemand auf der URL ist und nichts geschrieben wurde, belegt dieser Raum **0 Bytes** in der Datenbank.

---

#### Warum Einträge in `user_session`, obwohl nichts geschrieben wurde?
Das ist dein **Presence-Tracker (Live-Onlinezähler)**:
* Sobald ein Nutzer mit geöffnetem Sidepanel auf z. B. `https://amazon.de/...` surft, ruft das Plugin `joinRoom({ url, username })` auf.
* Dadurch weiß jeder andere Nutzer auf derselben Seite sofort: *„Aha, hier sind gerade 2 Leute online!“* – noch bevor irgendjemand eine Nachricht tippt.
* In `user_session` gibt es **pro Person genau 1 Zeile** (Key ist die `Identity`). Wechselst du auf eine andere URL, wird nur dieser eine Eintrag aktualisiert:
  ```rust
  existing.current_url = clean_url;
  ```
* Schließt der Nutzer den Tab oder Browser, löscht SpacetimeDB diese Zeile über `client_disconnected` automatisch wieder.

---

#### Fazit
* Die Datenbank „müllt“ dadurch **nicht** zu: `user_session` enthält immer nur die aktuell verbundenen User (wenn 5 Leute online sind, sind es exakt 5 Zeilen – egal wie viele URLs sie besuchen).
* Räume entstehen spontan und verschwinden automatisch wieder, wenn alle weg sind. Du musst also nie manuell Räume verwalten oder initialisieren.