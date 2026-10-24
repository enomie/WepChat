# Eigene Nachrichten löschen

Nutzer können **eigene** Chat-Nachrichten manuell entfernen. Fremde Nachrichten sind nicht löschbar. Autorisierung läuft **serverseitig über SpacetimeDB-`Identity`** (`sender_identity` / `ctx.sender`), **nicht** über den Anzeigenamen.

Verwandte Docs:

- [security.md](security.md) — `sender_name` ist nur Anzeige; vertrauenswürdig ist `sender_identity`
- [security-list.md](security-list.md) — Rate-Limit, Retention 72 h (Scheduler-`delete_message`)
- [general.md](general.md) — Pseudonym lokal, Identity serverseitig

---

## 1. Ziel & Abgrenzung

| Was | Verhalten |
|-----|-----------|
| **Löschen** | Nur Nachrichten, deren `sender_identity` der aktuellen Verbindung entspricht |
| **Anzeige im Chat** | Weiterhin **`sender_name`** (Pseudonym) — für alle sichtbar, inkl. historischer Namen pro Nachricht |
| **„Eigene“ Blase / Aktionen** | Über **`sender_identity` ↔ lokale Identity**, nicht `sender_name === username` |
| **Moderation** | Kein „fremde Nachricht löschen“ für normale User (später optional Admin-Reducer) |

**Warum Identity statt Name?** Pseudonyme sind frei wählbar und können kollidieren. Zwei User können denselben Namen haben; ein User kann den Namen nach dem Senden ändern. Löschen und „meine Blase“ müssen an die **Verbindungs-Identity** gebunden sein.

**Anzeige bleibt beim Namen:** In der Blase wird unverändert der zum Sendezeitpunkt gespeicherte `sender_name` gerendert (z. B. `Mustafaaaa`). Nur Layout-Klasse `own`, Papierkorb und Reducer-Aufruf nutzen die Identity.

---

## 2. Ist-Zustand

- Tabelle `chat_message` enthält bereits `sender_identity` und `sender_name` (`server/src/lib.rs`).
- Reducer `delete_message` existiert, ist aber **nur für den Scheduler** (Retention 72 h) — `only_scheduler(ctx)`.
- Extension: `chat_message.onDelete` aktualisiert die UI bereits bei serverseitigem Löschen.
- Extension: Klasse `bubble own` hängt heute an **`msg.senderName === profileState.current.username`** (`App.svelte`) — **zu ersetzen** durch Identity-Vergleich (siehe §5).

---

## 3. Server — neuer Reducer

### 3.1 Name & Signatur (Vorschlag)

`delete_own_message(message_id: u64)`

### 3.2 Regeln

1. Zeile mit `id == message_id` laden.
2. Keine Zeile → **noop** (idempotent, kein Fehler nötig).
3. `msg.sender_identity != ctx.sender` → **abbrechen** (kein Delete, kein Leak ob die ID existiert — für MVP reicht stilles Ignorieren wie bei Rate-Limit).
4. Sonst: `chat_message` Zeile löschen.

### 3.3 Retention / Scheduler

Beim Senden wird pro Nachricht ein geplanter Lauf `delete_message` (72 h) angelegt (`delete_message_schedule`).

| Option | Empfehlung |
|--------|------------|
| **A — Minimal** | User-Löschung entfernt nur die Zeile; geplanter Job läuft später noop (bereits spezifiziert in [security-list.md §6](security-list.md)) |
| **B — Sauber** | Beim User-Löschen zugehörigen Schedule-Eintrag mit `message_id` entfernen (weniger toter Scheduler-Noise) |

Für MVP reicht **A**; **B** als Follow-up, wenn Schedule-Tabelle wächst.

### 3.4 Sicherheit

- **Niemals** `username` oder Client-gesendeten „Besitzer“ akzeptieren — nur `ctx.sender`.
- Öffentliche Tabelle bleibt `public`; Schutz ist **Reducer-Logik**, nicht Tabellen-Privatsphäre.

---

## 4. Extension — UI & Verhalten

### 4.1 Eigene Nachricht erkennen (Client)

Vergleich z. B.:

- `msg.senderIdentity.toHexString()` mit `spacetimeChat.current.identity` (bereits Hex aus `onConnect`),

nicht:

- `msg.senderName` mit `profileState.current.username`.

Hilfsfunktion z. B. `isOwnMessage(msg, identityHex: string | null): boolean` in `spacetime.svelte.ts` oder kleines `chat-ui.ts`.

### 4.2 Chat-Anzeige (unverändert inhaltlich)

Pro Nachricht weiter anzeigen:

- **Sender:** `msg.senderName` (historischer Name der Nachricht)
- **Text:** `msg.text`

Keine Anzeige der `sender_identity` im Chat (optional nur im Profil wie heute).

### 4.3 Löschen-Interaktion

| Element | Vorschlag |
|---------|-----------|
| **Trigger** | Papierkorb-Icon in **eigenen** Blasen |
| **Sichtbarkeit** | Desktop Sidepanel: Icon bei **`:hover`** / **`:focus-within`** der Blase; Touch: Icon dauerhaft dezent oder Long-press (Phase 2) |
| **Aktion** | Ein Klick → `deleteOwnMessage(messageId)`; optional Bestätigung „Nachricht löschen?“ |
| **Feedback** | Button kurz `disabled` / Loading bis Delete per Subscription ankommt |
| **A11y** | `<button type="button" aria-label="Nachricht löschen">` |

Layout-Skizze:

```
┌─────────────────────────────┐
│ Mustafaaaa          (Name)  │
│ Hallo Welt              🗑️  │  ← nur wenn senderIdentity == meine Identity
└─────────────────────────────┘
```

Fremde Blase: nur Name + Text, kein Trash.

### 4.4 Reducer-Anbindung

Nach `spacetime publish` / Codegen: z. B. `conn.reducers.deleteOwnMessage({ messageId })` (exakter CamelCase aus generiertem SDK prüfen).

---

## 5. Umsetzungsplan (Reihenfolge)

1. **Server:** Reducer `delete_own_message` implementieren + `spacetime publish`.
2. **Codegen:** `cd extension && npm run codegen:stdb` ([learnings.md](../learnings.md#2-typescript-bindings-fehlendes-index-accessor)).
3. **Extension — Logik:** `deleteOwnMessage` in `spacetime.svelte.ts`; Identity-Helfer `isOwnMessage`.
4. **Extension — UI:** Trash-Button in `App.svelte`; Styles für Hover/Fokus.
5. **Extension — Styling-Fix:** `bubble own` von Pseudonym auf **Identity** umstellen (gleiche Hilfsfunktion wie Trash).
6. **Doku:** Eintrag in [security-list.md](security-list.md) Backlog optional als erledigt markieren; [security.md](security.md) FAQ um „eigene Nachrichten löschen“ ergänzen (kurz).
7. **Manuell testen** (§7).

Abhängigkeit: keine Blockade durch Rate-Limit oder Retention — User-Delete ist zusätzlich zum 72h-Job.

---

## 6. Randfälle & Copy

| Situation | Verhalten |
|-----------|-----------|
| **Pseudonym geändert** | Alte Nachrichten zeigen alten `sender_name`; weiterhin löschbar (gleiche Identity) |
| **Gleicher Name wie anderer User** | Nur eigene Blasen mit Trash; Löschen fremder Nachrichten serverseitig unmöglich |
| **Neue Identity** („ID neu generieren“, Storage gelöscht) | Alte Nachrichten noch im Raum sichtbar, **nicht** mehr löschbar — akzeptabel; optional Hinweis in Profil-Doc |
| **Nachricht schon gelöscht** | Doppelklick / Retry: noop |
| **Retention hat zuerst gelöscht** | UI entfernt Zeile bereits über `onDelete` |

Optionaler UI-Hinweis (Tooltip Trash): *„Nur deine Nachrichten — unabhängig vom Anzeigenamen.“*

---

## 7. Akzeptanzkriterien

- [ ] User kann eigene Nachricht löschen; verschwindet bei allen Clients im Raum (Subscription Delete).
- [ ] User kann **keine** fremde Nachricht löschen (manipulierte `message_id` am Server wirkungslos).
- [ ] Chat zeigt weiterhin **Namen** (`sender_name`), nicht die Identity.
- [ ] Blase `own` und Trash erscheinen nur bei Nachrichten mit **eigener** `sender_identity`, auch wenn `sender_name` ≠ aktuelles Pseudonym.
- [ ] Fremde Nachrichten: kein Trash, keine `own`-Blase.
- [ ] Papierkorb per Tastatur bedienbar (`aria-label`, Fokus sichtbar).

---

## 8. Testideen (manuell)

1. Zwei Browser-Profile: A sendet, B sieht Nachricht — B hat keinen Trash; A schon.  
2. A löscht → bei B verschwindet die Blase.  
3. A ändert Pseudonym, löscht alte Nachricht → funktioniert; Name in der Blase bleibt der alte.  
4. Gleicher `sender_name` bei A und B — nur jeweils eigene Nachrichten löschbar.  
5. B ruft Reducer mit A’s `message_id` auf (DevTools) → keine Änderung.  
6. Nach User-Delete: optional prüfen, dass geplanter 72h-Job noop (kein Fehler im Log).
