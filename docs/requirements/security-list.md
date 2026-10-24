# Security-Härtung: Backlog & Spezifikationen

Priorisierte Maßnahmen für `server/` und `extension/`. Übergreifendes Threat Model und Secrets: [security.md](security.md).

**Stand Implementierung:** §1 Rate-Limit, §6 Retention und [Message Content](message-content.md) sind live. Gotchas: [learnings.md](../learnings.md) §2, §7, §9.

**Umsetzungsreihenfolge (aktuell):**

1. **[Nachrichten-Rate-Limit (2 / Minute)](#1-nachrichten-rate-limit-2-pro-minute)** — Server + UX mit Countdown  
2. Server: Längenlimits, URL-Schema, Localhost, `sender_name` aus `user_session`  
3. Extension: SQL-Escape in Subscriptions, Localhost in `cleanUrl`  
4. ~~**[Nachrichten-Inhalt (erlaubte Zeichen)](message-content.md)**~~ — erledigt  
5. **[Nachrichten-Retention 72 h](#6-nachrichten-retention-72-stunden)** — Scheduled Delete **+** Cleanup-Job (nur Server)  
6. **[Eigene Nachrichten löschen](delete-messages.md)** — Reducer `delete_own_message` (nur `ctx.sender`); Extension: Trash, `bubble own` über Identity (Anzeige weiter `sender_name`)  
7. Optional: Moderation-Reducer (Admin-`Identity` nur im Rust-Modul)

---

## 1. Nachrichten-Rate-Limit (2 pro Minute)

### 1.1 Ziel

Spam und Flooding pro SpacetimeDB-`Identity` begrenzen. **Maximal 2 erfolgreiche Nachrichten** in einem **gleitenden Fenster von 60 Sekunden**.

- Schutz **serverseitig** (Pflicht) — Client-Limit ist nur UX.
- Für ehrliche Nutzer: klares Feedback (ausgegraut, Countdown), kein „Senden“-Klick ins Leere ohne Erklärung.

`join_room` / Presence bleiben **ohne** dieses Limit (nur `send_message`).

### 1.2 Regeln (fachlich)

| Konstante | Wert |
|-----------|------|
| `MAX_MESSAGES_PER_WINDOW` | `2` |
| `RATE_WINDOW_SECS` | `60` |

**Gleitendes Fenster:** Zeitpunkt `now`. Zähle Nachrichten mit `sender_identity == ctx.sender` und `created_at >= now - 60s`. Wenn Anzahl ≥ 2 → `send_message` **beendet ohne Insert** (keine neue Zeile in `chat_message`).

**Optional (Performance):** Statt Scan über `chat_message` eine kleine Hilfstabelle `message_rate` (PK `identity`, Felder z. B. `first_at`, `second_at` oder Ringbuffer der letzten Sendezeiten). Für MVP reicht Zählung über `chat_message` bei moderater Last.

**Nicht betroffen:** Lesen, Subscriptions, Badge-Count, Profil bearbeiten.

### 1.3 Server (`server/src/lib.rs`)

- Logik am Anfang von `send_message`, **vor** `insert`.
- Identität: immer `ctx.sender` (nicht Client-Parameter).
- Kein separater „Fehler-Reducer“ nötig für MVP; Client erkennt fehlgeschlagenes Senden optional daran, dass keine eigene Nachricht ankommt — deshalb **Client-Countdown parallel** (siehe unten).
- Später: falls SpacetimeDB sichtbare Reducer-Fehler an den Client liefert, kurze Meldung „Zu schnell“ anzeigen.

### 1.4 Extension — UX (`App.svelte` + ggf. `spacetime.svelte.ts`)

#### Zustände Eingabezeile

| Bedingung | Textfeld | Senden-Button |
|-----------|----------|----------------|
| Kein Tab / nicht verbunden | disabled (wie heute) | disabled |
| Rate-Limit aktiv (`cooldownRemainingMs > 0`) | **disabled**, ausgegraut (`opacity` / `cursor: not-allowed`) | **disabled**, ausgegraut |
| Sonst | enabled | enabled wenn Text nicht leer |

Profil-/Username-Feld in den Einstellungen **bleibt editierbar** während des Cooldowns.

#### Countdown

- Nach jedem **lokal erfolgreichen** `sendMessage`-Aufruf (Reducer ohne Throw): Zeitstempel in einer kleinen Liste (max. 2 relevante Einträge im 60s-Fenster) führen — z. B. in `spacetime.svelte.ts` oder dediziert `rate-limit.svelte.ts`.
- `cooldownRemainingMs = max(0, 60_000 - (now - oldestSendInWindow))` wenn bereits 2 Sends im Fenster, sonst `0`.
- **Anzeige** (eine Variante reicht, konsistent im Footer):
  - Hilfetext unter dem Input: *„Nächste Nachricht in 42 s“*, oder
  - Placeholder im Input: *„Noch 42 s …“*, oder
  - Button-Label: *„42 s“* statt „Senden“.
- Timer: `setInterval` 1 s oder Svelte `$effect` + `requestAnimationFrame`/1s-Tick; bei `cooldownRemainingMs === 0` Inputs wieder freigeben.
- **Enter-Taste** im Input: bei Cooldown **kein** Senden (gleich wie disabled Button).

#### Abgleich mit Server

- Client-Limit **spiegelt** die Server-Regel (2/60s), damit Nutzer selten in den „stille abgelehnt“-Fall laufen.
- Wer die Extension umgeht, wird nur serverseitig begrenzt — akzeptabel.

#### Barrierefreiheit / Copy

- Kurz, neutral: *„Max. 2 Nachrichten pro Minute“* einmalig als Tooltip oder kleiner Hinweis neben dem Footer (optional).
- Countdown in Sekunden, aufgerundet (`Math.ceil(ms / 1000)`).

#### Implementierung & Gotchas

| Teil | Datei |
|------|--------|
| Client-State + Cooldown | [rate-limit.svelte.ts](../../extension/src/lib/rate-limit.svelte.ts) |
| UI (disabled, Placeholder, Button-Label) | [App.svelte](../../extension/src/App.svelte) |
| `recordSend` nach Reducer | [spacetime.svelte.ts](../../extension/src/lib/spacetime.svelte.ts) |

**Svelte 5:** `cooldownRemainingMs()` darf in `$derived` **kein** `$state` mutieren — nur lesend filtern; `prune()` nur bei Send/Tick. Siehe [learnings.md](../learnings.md#7-svelte-5-rate-limit-und-state_unsafe_mutation).

### 1.5 Akzeptanzkriterien

- [x] Dritte Nachricht innerhalb 60 s nach der ersten (bei bereits 2 Sends im Fenster) erzeugt **keine** neue `chat_message`-Zeile. *(Server: `count_recent_messages` in [server/src/lib.rs](../../server/src/lib.rs))*
- [x] Nach Ablauf von 60 s seit der **ältesten** der beiden Nachrichten im Fenster ist wieder **1** Slot frei; nach weiterem Senden ggf. erneut Cooldown.
- [x] UI: Während Cooldown sind Nachrichten-**Input** und **Senden** ausgegraut und disabled; sichtbarer Sekunden-Countdown. *( [rate-limit.svelte.ts](../../extension/src/lib/rate-limit.svelte.ts), [App.svelte](../../extension/src/App.svelte) )*
- [x] Kein Rate-Limit auf Username-Änderung oder Raumwechsel.

### 1.6 Testideen (manuell)

1. Zwei Nachrichten schnell hintereinander **im Sidepanel (gleiche Identity)** → dritter Versuch: UI blockiert, Server nimmt nicht an. (`spacetime call --anonymous` nutzt pro Aufruf oft eine neue Identity — dafür ungeeignet.)  
2. 61 s warten → wieder sendbar.  
3. Tab wechseln / URL wechseln → Cooldown **global pro Identity** (nicht pro URL), gleiches Verhalten.  
4. Disconnect/Reconnect: Server zählt weiter über `sender_identity`; Client-Timer nach Reload ggf. zurückgesetzt — Nutzer kann kurz UI „frei“ sehen, Server lehnt trotzdem ab (akzeptabel für MVP).

---

## 2. Server — weitere Härtung (Backlog)

| Maßnahme | Problem heute | Idee |
|----------|----------------|------|
| **Längenlimits** | Unbegrenzte Strings | URL ≤ 2 KB, Username ≤ 32, Text ≤ 500–1000 |
| **Username normalisieren** | Unicode/Steuerzeichen | `trim()`, Whitelist ([ideas.md](../kickoff/ideas.md)) |
| **Nur `http`/`https`** | Exotische Schemes | Prefix-Check |
| **Localhost blocken** | Interne URLs als Raum | `localhost`, `127.0.0.1`, `::1`, private IPs |
| **`send_message`: Anzeigename vom Server** | Impersonation via `username` | `sender_name` aus `user_session` für `ctx.sender` |
| **Text-Policy** | erledigt | [message-content.md](message-content.md) |

Retention 72 h: eigene Spezifikation in [Abschnitt 6](#6-nachrichten-retention-72-stunden).

```rust
// Richtung Längenlimits (Auszug)
const MAX_TEXT_LEN: usize = 500;
const MAX_URL_LEN: usize = 2048;
const MAX_USERNAME_LEN: usize = 32;
```

---

## 3. Extension — Verteidigung in der Tiefe (Backlog)

| Maßnahme | Ort | Anmerkung |
|----------|-----|-----------|
| **SQL escapen** | `spacetime.svelte.ts` (Subscriptions) | `'` in URL; Pattern wie `background.ts` |
| **Localhost** | `cleanUrl()` / `url.svelte.ts` | Kein Chat-Raum |
| **Nachrichten vor Send** | erledigt | [message-content.md](message-content.md) |
| **Identity-Token** | `spacetime.svelte.ts` | Optional `storage.local` für stabile Identity |
| **Subscriptions** | `subscribeToUrl` | Alte Subscription beim URL-Wechsel beenden |

Alles hier ist **umgehbar** — Server-Regeln aus Abschnitt 2 bleiben maßgeblich.

---

## 4. Background (`background.ts`)

| Maßnahme | Nutzen |
|----------|--------|
| Localhost → kein SQL/Badge | Weniger Noise |
| Cache 10 s | Bereits vorhanden |

---

## 6. Nachrichten-Retention (72 Stunden)

### 6.1 Ziel

Nachrichten in `chat_message` dürfen **höchstens 72 Stunden** auf dem Server existieren. Danach sind sie **physisch gelöscht** (nicht nur in der UI ausgeblendet).

- **Zwei Server-Mechanismen parallel** — damit die Datenbank auch bei Scheduler-Aussetzern oder Alt-Bestand **zuverlässig sauber** bleibt.
- **Extension:** unverändert volle URL-Subscription; Löschungen kommen über bestehende Table-Callbacks (`onDelete`) bzw. Subscription-Updates.

Referenz Implementierung: [spacetimedb.md](../kickoff/spacetimedb.md) (Kurzfassung). Produktidee: [ideas.md](../kickoff/ideas.md).

### 6.2 Konstanten

| Konstante | Wert |
|-----------|------|
| `MESSAGE_RETENTION` | `72` Stunden |
| `CLEANUP_INTERVAL` | `15` Minuten (wiederkehrender Job B) |

`MESSAGE_RETENTION` als eine Quelle im Rust-Modul (z. B. `Duration` aus Stunden), von A und B gemeinsam genutzt.

### 6.3 Mechanismus A — Scheduled Delete pro Nachricht

SpacetimeDB 1.x: **Scheduled Table** (nicht `ctx.schedule`).

**Tabelle:** `delete_message_schedule` mit `scheduled(delete_message)` — Felder `scheduled_id`, `scheduled_at: ScheduleAt`, `message_id`.

**Trigger:** Erfolgreiches `insert` in `send_message` → `schedule_message_deletion` legt eine Zeile an mit `scheduled_at: (created_at + 72h).into()` (einmaliger Lauf).

**Reducer `delete_message`:** Nur Aufruf durch Scheduler (`ctx.sender == ctx.identity()`); löscht `message_id` falls vorhanden, sonst noop.

**Effekt:** Löschung nahe am 72h-Zeitpunkt; verbundene Clients sehen das Delete in Echtzeit (`onDelete` in [spacetime.svelte.ts](../../extension/src/lib/spacetime.svelte.ts)).

### 6.4 Mechanismus B — Wiederkehrender Cleanup

**Tabelle:** `purge_expired_schedule` mit `scheduled(purge_expired_messages)` — Intervall-Job via `scheduled_at: cleanup_interval().into()` (`TimeDuration` → wiederholender Lauf alle **15 Min**).

**Reducer `purge_expired_messages`:** Scheduler-only; `cutoff = ctx.timestamp - 72h`; alle älteren `chat_message` löschen.

**Bootstrap:** `#[reducer(init)]` plus `ensure_purge_job` in `join_room` / `send_message` (bestehende DBs ohne erneutes `init` nach Publish-Upgrade).

**Effekt:** Sicherheitsnetz — spätestens ~15 Min nach Ablauf der 72h, falls Einzel-Timer fehlt; räumt Alt-Bestand auf.

### 6.5 Zusammenspiel A + B

| Situation | Ergebnis |
|-----------|----------|
| Normal | A löscht punktgenau; B findet nichts oder noop für diese ID |
| A verpasst / fehlgeschlagen | B löscht spätestens innerhalb eines Cleanup-Intervalls |
| B löscht früher (Batch) | A-Lauf später: `delete_message` noop |
| Doppel-Löschung | Idempotent, kein Fehler nötig |

**Kein Mechanismus C:** Subscription mit `created_at > …` in der Extension — **nicht** Teil der Retention-Policy (würde Server-Daten und SQL-Abfragen unverändert lassen).

### 6.6 Extension (`extension/`)

- **Keine** Änderung der Subscription-SQL nur wegen Retention.
- `chat_message.onDelete` entfernt Nachrichten aus dem Sidepanel-State.
- Optional später: UI-Hinweis „Nachrichten werden nach 72 h gelöscht“ (Datenschutz/Landingpage).

### 6.7 Akzeptanzkriterien

- [x] A + B in [server/src/lib.rs](../../server/src/lib.rs); publiziert als Modul `wepchat`.
- [ ] Nachricht älter als 72 h existiert **nicht** mehr in `chat_message` (Dashboard/SQL) — *Langzeittest oder Dev-Modul mit verkürzter Retention*.
- [x] A: Jede neu gesendete Nachricht erzeugt einen Eintrag in `delete_message_schedule`.
- [x] B: `purge_expired_schedule` wird via `ensure_purge_job` befüllt; Intervall-Reducer aktiv.
- [x] Verbunde Clients: Delete-Event in `onDelete` implementiert.
- [x] Kein reines Client-Filtering als Ersatz für Server-Löschung.

### 6.8 Testideen

1. Testnachricht senden, `created_at` in Testumgebung verkürzen (nur dev) oder Wartezeit — Zeile weg nach Retention.  
2. `delete_message` manuell für existierende ID — Subscription aktualisiert.  
3. Zeile manuell mit altem `created_at` einfügen (dev) — nächster `purge_expired_messages` entfernt sie.  
4. Doppelaufruf `delete_message` — kein Crash.

---

## 7. Bewusst nicht Ziel

- Geheime API-Keys in der Extension ([security.md](security.md))
- Rate-Limit nur im UI ohne Server
- `public` Tabellen komplett abschalten
- **Retention nur im Client** (Subscription-Filter ohne Server-Delete)
