# Eigene Nachrichten löschen

Nutzer können **eigene** Chat-Nachrichten manuell entfernen. Fremde Nachrichten sind nicht löschbar. Autorisierung läuft **serverseitig über SpacetimeDB-`Identity`** (`sender_identity` / `ctx.sender`), **nicht** über den Anzeigenamen.

Verwandte Docs:

- [security.md](security.md), `sender_name` ist nur Anzeige; vertrauenswürdig ist `sender_identity`
- [security-list.md](security-list.md), Rate-Limit, Retention 72 h (Scheduler-`delete_message`)
- [message-content.md](message-content.md), erlaubte Zeichen in `text` / Pseudonym (bereits live)
- [general.md](general.md), Pseudonym lokal, Identity serverseitig

---

## 1. Ziel & Abgrenzung

| Was | Verhalten |
|-----|-----------|
| **Löschen** | Nur Nachrichten, deren `sender_identity` der aktuellen Verbindung entspricht |
| **Anzeige im Chat** | Weiterhin **`sender_name`** (Pseudonym), für alle sichtbar, inkl. historischer Namen pro Nachricht |
| **„Eigene“ Blase / Papierkorb (UI)** | `messageIsMine` in `spacetime.svelte.ts`: primär **Identity**, zusätzlich Anzeigename im Raum (`roomDisplayName` / lokales Pseudonym) für Layout |
| **Löschen (Server)** | Nur **`sender_identity == ctx.sender`**, Anzeigename wird ignoriert |
| **Moderation** | Kein „fremde Nachricht löschen“ für normale User (später optional Admin-Reducer) |

**Warum Identity statt Name?** Pseudonyme sind frei wählbar und können kollidieren (geplant: eindeutige Raum-Anzeigenamen, [room-pseudonym.md](room-pseudonym.md)). Ein User kann den Namen nach dem Senden ändern. Löschen und „meine Blase“ müssen an die **Verbindungs-Identity** gebunden sein.

**Anzeige bleibt beim Namen:** In der Blase wird unverändert der zum Sendezeitpunkt gespeicherte `sender_name` gerendert. Papierkorb und `bubble own` nutzen `messageIsMine`; der Reducer prüft nur die Identity.

---

## 2. Ist-Zustand

- Tabelle `chat_message` enthält `sender_identity` und `sender_name` (`server/src/lib.rs`).
- Reducer `delete_message`: nur Scheduler (Retention 72 h), `only_scheduler(ctx)`.
- Reducer **`delete_own_message`**: User-Löschung nur bei `msg.sender_identity == ctx.sender` (live).
- Extension: `deleteOwnMessage` → `conn.reducers.deleteOwnMessage({ messageId })`; `onDelete` aktualisiert die Liste.
- UI: [`App.svelte`](../../extension/src/App.svelte), Zeile `message-row own` mit Papierkorb **links** neben der Blase ([`trash.svg`](../../extension/src/assets/icons/trash.svg)), Locale `messages.deleteAria`.

---

## 3. Server (`delete_own_message`)

### 3.1 Signatur

`delete_own_message(message_id: u64)` in [`server/src/lib.rs`](../../server/src/lib.rs)

### 3.2 Regeln

1. Zeile mit `id == message_id` laden.
2. Keine Zeile → **noop** (idempotent, kein Fehler nötig).
3. `msg.sender_identity != ctx.sender` → **abbrechen** (kein Delete, kein Leak ob die ID existiert, für MVP reicht stilles Ignorieren wie bei Rate-Limit).
4. Sonst: `chat_message` Zeile löschen.

### 3.3 Retention / Scheduler

Beim Senden wird pro Nachricht ein geplanter Lauf `delete_message` (72 h) angelegt (`delete_message_schedule`).

| Option | Empfehlung |
|--------|------------|
| **A, Minimal** | User-Löschung entfernt nur die Zeile; geplanter Job läuft später noop (bereits spezifiziert in [security-list.md §6](security-list.md)) |
| **B, Sauber** | Beim User-Löschen zugehörigen Schedule-Eintrag mit `message_id` entfernen (weniger toter Scheduler-Noise) |

Für MVP reicht **A**; **B** als Follow-up, wenn Schedule-Tabelle wächst.

### 3.4 Sicherheit

- **Niemals** `username` oder Client-gesendeten „Besitzer“ akzeptieren, nur `ctx.sender`.
- Öffentliche Tabelle bleibt `public`; Schutz ist **Reducer-Logik**, nicht Tabellen-Privatsphäre.

---

## 4. Extension, UI & Verhalten

### 4.1 Eigene Nachricht erkennen (Client)

`messageIsMine(msg, identityHex, roomDisplayName, localUsername)` in [`spacetime.svelte.ts`](../../extension/src/lib/spacetime.svelte.ts):

1. `senderIdentity` (Hex, case-insensitive) === `spacetimeChat.current.identity`, oder  
2. `msg.senderName` === `roomDisplayName` (aus `user_session` für die eigene Identity), sonst Fallback lokales Pseudonym.

Schritt 2 betrifft **nur** Anzeige von `own` / Papierkorb. **Löschen** schlägt serverseitig fehl, wenn die Identity nicht passt (z. B. alte Nachrichten nach Identity-Wechsel: Trash ggf. sichtbar, Klick ohne Effekt, selten).

### 4.2 Chat-Anzeige (unverändert inhaltlich)

Pro Nachricht weiter anzeigen:

- **Sender:** `msg.senderName` (historischer Name der Nachricht)
- **Text:** `msg.text`

Keine Anzeige der `sender_identity` im Chat (optional nur im Profil wie heute).

### 4.3 Löschen-Interaktion (live)

| Element | Verhalten |
|---------|-----------|
| **Layout** | `.message-row.own`: Papierkorb-Button links, Chatblase rechts, am unteren Chatrand ausgerichtet (`align-self: flex-end`) |
| **Button** | Transparent, Icon grau (`currentColor`); **Hover:** Icon rot, kein Button-Hintergrund |
| **Ausrichtung** | Papierkorb vertikal zur Blase zentriert (`align-items: center`) |
| **Aktion** | Ein Klick, keine Bestätigung → `spacetimeChat.deleteOwnMessage(msg.id)` |
| **A11y** | `aria-label` / `title` via `messages.deleteAria` (de/en) |

Layout (eigene Nachricht):

```
  [Trash]  ┌─────────────────────┐
           │ Anon…    Just now   │
           │ Hallo Welt          │
           └─────────────────────┘
```

Fremde Nachricht: nur `.bubble` ohne Zeile und ohne Papierkorb.

### 4.4 Build & Test der Extension

Lokales Laden aus `extension/.output/chrome-mv3`: nach Änderungen unter `extension/src/` **`npm run build`**, dann in `chrome://extensions` **Aktualisieren**. Siehe [publish-guide.md](../infos/publish-guide.md).

### 4.5 Deploy (Reducer)

Nach Änderung an `delete_own_message`: `cargo test` → `spacetime publish wepchat -y` → bei Bedarf `npm run codegen:stdb` in `extension/`.

---

## 5. Release-Historie (Kurz)

Feature live: Server-Reducer, Codegen, Extension-UI. Rate-Limit und Retention unverändert; User-Delete zusätzlich zum 72h-Scheduler (Option **A**, Schedule-Eintrag kann später noop).

---

## 6. Randfälle & Copy

| Situation | Verhalten |
|-----------|-----------|
| **Pseudonym geändert** | Alte Nachrichten zeigen alten `sender_name`; weiterhin löschbar (gleiche Identity) |
| **Gleicher Name wie anderer User** | Nur eigene Blasen mit Trash; Löschen fremder Nachrichten serverseitig unmöglich |
| **Neue Identity** („ID neu generieren“, Storage gelöscht) | Alte Nachrichten noch im Raum sichtbar, **nicht** mehr löschbar, akzeptabel; optional Hinweis in Profil-Doc |
| **Nachricht schon gelöscht** | Doppelklick / Retry: noop |
| **Retention hat zuerst gelöscht** | UI entfernt Zeile bereits über `onDelete` |

Optionaler UI-Hinweis (Tooltip Trash): *„Nur deine Nachrichten, unabhängig vom Anzeigenamen.“*

---

## 7. Akzeptanzkriterien

- [x] User kann eigene Nachricht löschen; verschwindet bei allen Clients im Raum (Subscription Delete).
- [x] User kann **keine** fremde Nachricht löschen (manipulierte `message_id` am Server wirkungslos).
- [x] Chat zeigt weiterhin **Namen** (`sender_name`), nicht die Identity.
- [x] Blase `own` und Trash nur bei `messageIsMine` (Identity und/oder Raum-Anzeigename); Server löscht nur bei passender `sender_identity`.
- [x] Fremde Nachrichten: kein Trash, keine `own`-Blase.
- [x] Papierkorb per Tastatur bedienbar (`aria-label`, Fokus sichtbar).

---

## 8. Testideen (manuell)

1. Zwei Browser-Profile: A sendet, B sieht Nachricht, B hat keinen Trash; A schon.  
2. A löscht → bei B verschwindet die Blase.  
3. A ändert Pseudonym, löscht alte Nachricht → funktioniert; Name in der Blase bleibt der alte.  
4. Gleicher `sender_name` bei A und B, nur jeweils eigene Nachrichten löschbar.  
5. B ruft Reducer mit A’s `message_id` auf (DevTools) → keine Änderung.  
6. Nach User-Delete: optional prüfen, dass geplanter 72h-Job noop (kein Fehler im Log).
