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

2. **TypeScript-Typen direkt für die Svelte-Extension erzeugen:**
   ```bash
   cd /Users/johann/MyBrew/WepChat/server
   spacetime generate wepchat --lang typescript --out-dir ../extension/src/lib/spacetimedb --module-path .
   ```

> **Wichtiger Workflow:**  
> Jedes Mal, wenn du in `server/src/lib.rs` Tabellen oder Reducers änderst, führst du erneut `spacetime publish wepchat -y` aus und regenerierst die TypeScript-Bindings.

---

### Wichtige Architektur- & SpacetimeDB-Prinzipien

1. **Kryptografische Identitäten (`ctx.sender`):**  
   SpacetimeDB vergibt jedem verbundenen Client automatisch eine manipulationssichere `Identity`. User müssen sich nicht registrieren; die Identität ist der Primärschlüssel.
2. **Automatischer Disconnect (`#[reducer(client_disconnected)]`):**  
   Schließt ein Nutzer den Tab oder verliert die Verbindung, feuert SpacetimeDB diesen Reducer serverseitig. So bleibt der Presence-Zähler verlässlich aktuell.
3. **Subscriptions statt Polling:**  
   In der Svelte-Extension wird keine REST-Abfrage (`fetch`) gemacht. Die Extension abonniert stattdessen `SELECT * FROM chat_message WHERE url = ...` und `SELECT * FROM user_session WHERE url = ...`. Neue Nachrichten und User-Änderungen pusht SpacetimeDB sofort per WebSocket.
