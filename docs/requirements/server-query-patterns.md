# Server: Abfragen ohne `chat_message`-Vollscan

Reducer-Logik in [`server/src/lib.rs`](../../server/src/lib.rs). Threat Model: [security.md](security.md).

**Regel:** Auf dem **heißen Pfad** (`send_message`, ggf. `join_room`) **kein** `ctx.db.chat_message().iter()` über die gesamte Tabelle. Zählungen, Rate-Limits, Echo-Vergleiche und ähnliches über **Hilfstabellen** (PK-Lookup) oder **B-Tree-Indizes** mit gezieltem `filter`, nicht über Table-Scans.

---

## 1. Ist-Zustand im Code (Stand Repo)

| Funktion / Reducer | Aktuelles Muster | Pfad |
|--------------------|------------------|------|
| `is_rate_limited` / `record_rate_send` | `send_rate_state.identity().find` / `update` | **`send_message`** (jedes Senden) |
| `purge_expired_messages` | `iter()`, Filter `created_at < cutoff`, dann `id().delete` | Scheduler (~15 Min) |
| `delete_message` | `id().find` / `id().delete` | Scheduler (pro Nachricht), **OK** (PK) |
| `delete_own_message` | `id().find`, Prüfung `sender_identity`, `id().delete` | Client (eigene Nachricht), **OK** (PK) |

`chat_message` hat heute nur **PK `id`**, keine B-Tree-Indizes auf `url`, `sender_identity` oder `created_at` (siehe Struct in `lib.rs`).

Die Extension subscribed mit `WHERE url = '…'`; serverseitig profitiert das erst mit Index auf `url` (kleinere Index-Range statt Vollscan auf DB-Seite beim Host).

---

## 2. Warum kein Scan auf `send_message`

- Kosten wächst mit **allen Nachrichten aller Räume**, obwohl nur **eine Identity** bzw. **ein Raum** relevant ist.
- Geplante Features (Echo-Schutz, strengere Limits) würden sonst **weitere** Scans stapeln.
- SpacetimeDB bietet **Indizes** und **schlanke State-Tabellen**, die sind die vorgesehene Lösung ([Indexes](https://spacetimedb.com/docs/tables/indexes), Rust `#[index(btree)]` / `index(accessor = …, btree(columns = […]))`).

---

## 3. Empfohlene Muster (besser als `iter()`)

### 3.1 Hilfstabellen, **Priorität für Send-Pfad**

Kleine Tabellen, eine Zeile pro Schlüssel, **O(1)** per PK/`find`/`update`:

| Zweck | Tabelle (Vorschlag) | Schlüssel | Felder (Beispiel) | Wann pflegen |
|-------|---------------------|-----------|-------------------|--------------|
| **2/Min Rate-Limit** | **`send_rate_state`** (live) | `identity` (PK) | `send_at_1`, `send_at_2` (`UNIX_EPOCH` = leer) | Nach erfolgreichem `insert` in `send_message` |
| **Echo-Schutz** | `sender_room_state` | `(sender_identity, url)`, PK oder Unique-Index | `last_text` (normalisiert), optional `last_message_id` | Gleich nach `insert`; bei User-Delete ggf. zurücksetzen/neu setzen |

Prüfung vor `insert`: nur `find`/`update` auf der Hilfstabelle, **kein** Lesen der Message-Historie.

Das **2/Min-Limit** zählt **Send-Events** in `send_rate_state`, nicht Zeilen in `chat_message` (`delete_own_message`: Löschen senkt den Rate-Zähler nicht). Tests: `cd server && cargo test`.

### 3.2 B-Tree-Indizes auf `chat_message`

Sinnvoll für **Abfragen über viele Zeilen** oder **Subscriptions**, nicht als Ersatz für Echo/Rate-State:

| Index (Vorschlag) | Spalten | Nutzen |
|-------------------|---------|--------|
| `url` | `url` | Raum-Subscriptions / SQL `WHERE url = ?` |
| `created_at` | `created_at` | `purge_expired_messages`: `RangedIndex::filter` / `delete` unter `cutoff` statt Vollscan |
| `url_sender` | `[url, sender_identity]` | Engere Menge als Vollscan; für „letzte eigene Nachricht“ trotzdem schlechter als `sender_room_state` (max `created_at` / Sortierung) |

Rust (SpacetimeDB 1.0, Auszug):

```rust
#[table(
    name = chat_message,
    public,
    index(accessor = by_url, btree(columns = [url]))
)]
pub struct ChatMessage {
    // ...
    #[index(btree)]
    created_at: Timestamp,
}
```

Zugriff: `ctx.db.chat_message().by_url().filter(&clean_url)`, siehe [docs.rs `spacetimedb`](https://docs.rs/spacetimedb/latest/spacetimedb/) (`RangedIndex::filter`).

**Hinweis:** Rate-Limit „2 Sends in 60s“ mit nur Index auf `sender_identity` erfordert weiterhin Zeitfilter über alle Zeilen des Senders, **Hilfstabelle bleibt die saubere Lösung.**

### 3.3 Was darf scannen?

| Job | Bewertung |
|-----|-----------|
| `purge_expired_messages` (selten, Batch) | Akzeptabel mit **`created_at`-Index**; ohne Index technischer Vollscan |
| Einmalige Dev-/Migrations-Reducer | Ausnahme, nicht im Produktions-Send-Pfad |

---

## 4. Umsetzungsreihenfolge (Backlog)

1. ~~Hilfstabelle `send_rate_state`~~, erledigt.
2. **`sender_room_state`** vor Echo-Schutz ([duplicate-detection Plan](../../.cursor/plans/duplicate-detection-echo.plan.md)), kein `last_own_message_text` via `iter()`.
3. **Indizes** `url`, `created_at` (und ggf. `url`+`sender_identity`) an `chat_message`; `npm run codegen:stdd` in `extension/`.
4. **`purge_expired_messages`** auf Range über `created_at`-Index umstellen.

Nach Schema-Änderung: `cargo build --target wasm32-unknown-unknown`, `spacetime publish`, `npm run codegen:stdb` in `extension/`, [learnings.md §2](../learnings.md#2-typescript-bindings-fehlendes-index-accessor).

---

## 5. Bewusst nicht

- Vollscan über `chat_message` in **`send_message`** für Limits oder Echo (auch nicht „nur MVP“ langfristig).
- Logik im Chat-UI als Ersatz für serverseitigen State (Client ist nur UX).
