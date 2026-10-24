# Eigene Nachrichten löschen

Nutzer können **eigene** Chat-Nachrichten manuell entfernen. Fremde Nachrichten sind nicht löschbar. Autorisierung läuft **serverseitig über SpacetimeDB-`Identity`** (`sender_identity` / `ctx.sender`), nicht über den Anzeigenamen.

Verwandte Docs: [security.md](security.md), [security-list.md](security-list.md), [general.md](general.md), [room-pseudonym.md](room-pseudonym.md).

---

## 1. Ziel & Abgrenzung

| Was | Verhalten |
|-----|-----------|
| **Löschen (Server)** | Nur wenn `msg.sender_identity == ctx.sender` (`delete_own_message`) |
| **Anzeige im Chat** | Weiterhin **`sender_name`** pro Nachricht (historisch), nicht die Identity |
| **Eigene Blase / Papierkorb (UI)** | `messageIsMine` in [`spacetime.svelte.ts`](../../extension/src/lib/spacetime.svelte.ts) |
| **Moderation durch Personen** | **Nicht vorgesehen** (Skalierung pro URL; ohnehin [Retention 72 h](security-list.md#6-nachrichten-retention-72-stunden); nur eigenes Löschen, [security-list.md §7](security-list.md#7-bewusst-nicht-ziel)) |

**Identity vs. Anzeigename:** Pseudonyme können im Raum kollidieren ([room-pseudonym.md](room-pseudonym.md)); der Server vergibt eindeutige Raumnamen. Löschen ist **nur** an die Verbindungs-Identity gebunden. Die UI nutzt zusätzlich den Raum-Anzeigenamen, damit „eigene“ Blasen zuverlässig erkannt werden (siehe §3.1).

---

## 2. Server

**Reducer:** `delete_own_message(message_id: u64)` in [`server/src/lib.rs`](../../server/src/lib.rs)

1. Zeile mit `id == message_id` laden; fehlt → noop.
2. `msg.sender_identity != ctx.sender` → abbrechen (stilles Ignorieren).
3. Sonst Zeile in `chat_message` löschen.

**Retention:** Pro Nachricht existiert ein Scheduler-Job `delete_message` (72 h). Nach User-Löschung bleibt der Job bestehen (Option **A**); späterer Lauf ist noop. Optional Follow-up: Schedule-Zeile beim User-Delete entfernen (Option **B**).

**Deploy:** `cargo test` → `spacetime publish wepchat -y` → bei Signatur-Änderung `npm run codegen:stdb` in `extension/`.

---

## 3. Extension

### 3.1 `messageIsMine`

`messageIsMine(msg, identityHex, roomDisplayName, localUsername)`:

1. `senderIdentity` (Hex, case-insensitive) === aktuelle Identity, oder  
2. `msg.senderName` === `roomDisplayName` (eigene `user_session`) bzw. Fallback lokales Pseudonym.

Schritt 2 nur für **UI** (`bubble own`, Papierkorb). **Löschen** wirkt nur bei passender Identity (nach Identity-Wechsel kann der Papierkorb selten ohne Effekt sein).

### 3.2 UI

- [`App.svelte`](../../extension/src/App.svelte): `.message-row.own` mit Papierkorb **links** ([`trash.svg`](../../extension/src/assets/icons/trash.svg)), Blase rechts.
- Button: transparent, Icon grau, Hover rot; ein Klick ohne Dialog.
- `spacetimeChat.deleteOwnMessage(msg.id)`; Liste via `chat_message.onDelete`.
- Locale: `messages.deleteAria` (de/en).

### 3.3 Build

Entpackt aus `extension/.output/chrome-mv3`: nach Änderungen `npm run build`, Extension in Chrome aktualisieren ([publish-guide.md](../infos/publish-guide.md)).

---

## 4. Randfälle

| Situation | Verhalten |
|-----------|-----------|
| Pseudonym geändert | Alter `sender_name` in der Blase; löschbar bei gleicher Identity |
| Gleicher Anzeigename im Raum | Server verhindert Kollision; Löschen nur mit eigener Identity |
| Neue Identity / Storage weg | Alte Nachrichten sichtbar, nicht mehr löschbar |
| Doppelklick / Retry | noop |
| Retention zuerst | UI bereits über `onDelete` |

---

## 5. Manuelle Tests

1. Zwei Profile: nur Sender sieht Papierkorb.  
2. Löschen synchronisiert bei anderen Clients im Raum.  
3. Pseudonym ändern, alte Nachricht löschen: Name in Blase unverändert.  
4. Fremde `message_id` per Reducer: keine Wirkung.  
5. Nach User-Delete: Scheduler-Lauf für diese ID noop (kein Fehler).
