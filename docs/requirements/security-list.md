# Security-Härtung: Backlog & Spezifikationen

Priorisierte Maßnahmen für `server/` und `extension/`. Übergreifendes Threat Model und Secrets: [security.md](security.md).

**Stand Implementierung:** §1 Rate-Limit, §6 Retention, [Message Content](message-content.md), [Eigene Nachrichten löschen](delete-messages.md) (`delete_own_message`), SQL-Escape (`sql-literal-escape.ts`), URL-Länge 2048. Gotchas: [learnings.md](../learnings.md) §2, §7, §9–§11. **Send-Pfad:** kein `chat_message`-Vollscan, [server-query-patterns.md](server-query-patterns.md).

**Offen (Priorität):**

- Echo-Schutz (`sender_room_state`), Purge per Index, Schedule-Cleanup bei User-Delete (Option B in [delete-messages.md](delete-messages.md))

---

## 1. Nachrichten-Rate-Limit (2 pro Minute)

### 1.1 Ziel

Spam und Flooding pro SpacetimeDB-`Identity` begrenzen. **Maximal 2 erfolgreiche Nachrichten** in einem **gleitenden Fenster von 60 Sekunden**.

- Schutz **serverseitig** (Pflicht), Client-Limit ist nur UX.
- Für ehrliche Nutzer: klares Feedback (ausgegraut, Countdown), kein „Senden“-Klick ins Leere ohne Erklärung.

`join_room` / Presence bleiben **ohne** dieses Limit (nur `send_message`).

### 1.2 Regeln (fachlich)

| Konstante | Wert |
|-----------|------|
| `MAX_MESSAGES_PER_WINDOW` | `2` |
| `RATE_WINDOW_SECS` | `60` |

**Gleitendes Fenster:** Zeitpunkt `now`. Zähle Nachrichten mit `sender_identity == ctx.sender` und `created_at >= now - 60s`. Wenn Anzahl ≥ 2 → `send_message` **beendet ohne Insert** (keine neue Zeile in `chat_message`).

**Abgrenzung:** 2/Min ist **bewusst kurz** (Casual-Flooding für ehrliche Clients), **kein** Ersatz für Bot-Abwehr; längere Identity-Quotas siehe [§7](#7-bewusst-nicht-ziel).

**Rate-Limit (fachlich):** **umgesetzt**, Server-Hilfstabelle `send_rate_state` (PK `identity`, `send_at_1` / `send_at_2`) + Extension-Countdown ([§1.4](#14-extension--ux-appsvelte--ggf-spacetimesveltets)). **Kein** `chat_message().iter()` auf dem Send-Pfad. Unit-Tests: `cd server && cargo test`. Geplante **Echo-Prüfung** ebenfalls nicht per Scan (`sender_room_state`, Identity + `url`, `last_text`), [server-query-patterns.md](server-query-patterns.md).

**Nicht betroffen:** Lesen, Subscriptions, Badge-Count, Profil bearbeiten.

### 1.3 Server (`server/src/lib.rs`)

- `is_rate_limited` / `record_rate_send` über Tabelle `send_rate_state` (PK `identity`), **vor** bzw. **nach** `insert` in `send_message`.
- Identität: immer `ctx.sender` (nicht Client-Parameter).
- Kein separater „Fehler-Reducer“ nötig für MVP; Client erkennt fehlgeschlagenes Senden optional daran, dass keine eigene Nachricht ankommt, deshalb **Client-Countdown parallel** (siehe unten).
- Später: falls SpacetimeDB sichtbare Reducer-Fehler an den Client liefert, kurze Meldung „Zu schnell“ anzeigen.

### 1.4 Extension, UX (`App.svelte` + ggf. `spacetime.svelte.ts`)

#### Zustände Eingabezeile

| Bedingung | Textfeld | Senden-Button |
|-----------|----------|----------------|
| Kein Tab / nicht verbunden | disabled (wie heute) | disabled |
| Rate-Limit aktiv (`cooldownRemainingMs > 0`) | **disabled**, ausgegraut (`opacity` / `cursor: not-allowed`) | **disabled**, ausgegraut |
| Sonst | enabled | enabled wenn Text nicht leer |

Profil-/Username-Feld in den Einstellungen **bleibt editierbar** während des Cooldowns.

#### Countdown

- Nach jedem **lokal erfolgreichen** `sendMessage`-Aufruf (Reducer ohne Throw): Zeitstempel in einer kleinen Liste (max. 2 relevante Einträge im 60s-Fenster) führen, z. B. in `spacetime.svelte.ts` oder dediziert `rate-limit.svelte.ts`.
- `cooldownRemainingMs = max(0, 60_000 - (now - oldestSendInWindow))` wenn bereits 2 Sends im Fenster, sonst `0`.
- **Anzeige** (eine Variante reicht, konsistent im Footer):
  - Hilfetext unter dem Input: *„Nächste Nachricht in 42 s“*, oder
  - Placeholder im Input: *„Noch 42 s …“*, oder
  - Button-Label: *„42 s“* statt „Senden“.
- Timer: `setInterval` 1 s oder Svelte `$effect` + `requestAnimationFrame`/1s-Tick; bei `cooldownRemainingMs === 0` Inputs wieder freigeben.
- **Enter-Taste** im Input: bei Cooldown **kein** Senden (gleich wie disabled Button).

#### Abgleich mit Server

- Client-Limit **spiegelt** die Server-Regel (2/60s), damit Nutzer selten in den „stille abgelehnt“-Fall laufen.
- Wer die Extension umgeht, wird nur serverseitig begrenzt, akzeptabel.

#### Barrierefreiheit / Copy

- Kurz, neutral: *„Max. 2 Nachrichten pro Minute“* einmalig als Tooltip oder kleiner Hinweis neben dem Footer (optional).
- Countdown in Sekunden, aufgerundet (`Math.ceil(ms / 1000)`).

#### Implementierung & Gotchas

| Teil | Datei |
|------|--------|
| Client-State + Cooldown | [rate-limit.svelte.ts](../../extension/src/lib/rate-limit.svelte.ts) |
| UI (disabled, Placeholder, Button-Label) | [App.svelte](../../extension/src/App.svelte) |
| `recordSend` nach Reducer | [spacetime.svelte.ts](../../extension/src/lib/spacetime.svelte.ts) |

**Svelte 5:** `cooldownRemainingMs()` darf in `$derived` **kein** `$state` mutieren, nur lesend filtern; `prune()` nur bei Send/Tick. Siehe [learnings.md](../learnings.md#7-svelte-5-rate-limit-und-state_unsafe_mutation).

### 1.5 Akzeptanzkriterien

- [x] Dritte Nachricht innerhalb 60 s nach der ersten (bei bereits 2 Sends im Fenster) erzeugt **keine** neue `chat_message`-Zeile. *(Server: `is_rate_limited` / `send_rate_state` in [server/src/lib.rs](../../server/src/lib.rs))*
- [x] Nach Ablauf von 60 s seit der **ältesten** der beiden Nachrichten im Fenster ist wieder **1** Slot frei; nach weiterem Senden ggf. erneut Cooldown.
- [x] UI: Während Cooldown sind Nachrichten-**Input** und **Senden** ausgegraut und disabled; sichtbarer Sekunden-Countdown. *( [rate-limit.svelte.ts](../../extension/src/lib/rate-limit.svelte.ts), [App.svelte](../../extension/src/App.svelte) )*
- [x] Kein Rate-Limit auf Username-Änderung oder Raumwechsel.

### 1.6 Testideen (manuell)

1. Zwei Nachrichten schnell hintereinander **im Sidepanel (gleiche Identity)** → dritter Versuch: UI blockiert, Server nimmt nicht an. (`spacetime call --anonymous` nutzt pro Aufruf oft eine neue Identity, dafür ungeeignet.)  
2. 61 s warten → wieder sendbar.  
3. Tab wechseln / URL wechseln → Cooldown **global pro Identity** (nicht pro URL), gleiches Verhalten.  
4. Disconnect/Reconnect: Server zählt weiter über `send_rate_state`; Client-Timer nach Reload ggf. zurückgesetzt, Nutzer kann kurz UI „frei“ sehen, Server lehnt trotzdem ab (akzeptabel für MVP).  
5. Nach zwei Sends: Zeile in `send_rate_state` für die Identity (Dashboard/SQL). `identity_disconnected` löscht die Zeile.

**Automatisiert:** `cd server && cargo test` (Fenster-Logik, siehe `rate_window_tests` in `lib.rs`).

---

## 2. Server, weitere Härtung (Backlog)

| Maßnahme | Problem heute | Idee |
|----------|----------------|------|
| **Längenlimits** ✓ | — | Username **13**, Text **400**, URL **2048** Bytes ([url-eligibility.md](url-eligibility.md)); [message-content.md §3.1](message-content.md#31-maximale-länge-zeichen) |
| **Username normalisieren** | Unicode/Steuerzeichen | `trim()`, Whitelist ([ideas.md](../kickoff/ideas.md)) |
| **Nur `http`/`https`** ✓ | Exotische Schemes | [url-eligibility.md](url-eligibility.md) |
| **Localhost / private URLs** ✓ | Interne URLs als Raum | [url-eligibility.md](url-eligibility.md) |
| **`send_message`: URL = Session** ✓ | Spoofing fremder Räume | `session.current_url` muss `url` treffen |
| **`send_message`: Anzeigename vom Server** ✓ | Impersonation via `username` | `sender_name` aus `user_session`; Raum-Suffixe: [room-pseudonym.md](room-pseudonym.md) |
| **Text-Policy** | erledigt | [message-content.md](message-content.md) |
| **Link-/Domain-Limits** (Regex, max. 1 Link) | Affiliate/Phishing-URLs im Text | **Nicht separat**, erledigt über Zeichen-Whitelist (`:` `/` `@` … verboten): [message-content.md §8](message-content.md#8-links-domains-kein-link-regex) |
| **`chat_message`-Scans in Reducern** | `iter()` skaliert mit Gesamtbestand | Rate-Limit: **`send_rate_state`** ✓; Purge/Echo noch offen, [server-query-patterns.md](server-query-patterns.md), [learnings.md §12](../learnings.md#12-kein-chat_message-vollscan-in-reducern) |
| **B-Tree auf `chat_message`** | Subscriptions / Purge | `url`, `created_at` (Rust `#[index(btree)]`); Purge per Range statt Vollscan |

Retention 72 h: eigene Spezifikation in [Abschnitt 6](#6-nachrichten-retention-72-stunden).

```rust
// Längenlimits (umgesetzt in lib.rs)
const MAX_MESSAGE_TEXT_LEN: usize = 400;
const MAX_USERNAME_LEN: usize = 13;
const MAX_URL_LEN: usize = 2048;
```

---

## 3. Extension, Verteidigung in der Tiefe (Backlog)

| Maßnahme | Ort | Anmerkung |
|----------|-----|-----------|
| **SQL escapen** ✓ | `sql-literal-escape.ts`, `spacetime.svelte.ts`, `background.ts` | `'` in URL für Subscription-SQL und Badge-Count |
| **Localhost** | `cleanUrl()` / `url.svelte.ts` | Kein Chat-Raum |
| **Nachrichten vor Send** | erledigt | [message-content.md](message-content.md) |
| **Identity-Token** | `spacetime.svelte.ts` | Optional `storage.local` für stabile Identity |
| **Subscriptions** | `subscribeToUrl` | Alte Subscription beim URL-Wechsel beenden |

Alles hier ist **umgehbar**, Server-Regeln aus Abschnitt 2 bleiben maßgeblich.

---

## 4. Background (`background.ts`)

| Maßnahme | Nutzen |
|----------|--------|
| Localhost → kein SQL/Badge | Weniger Noise |
| Cache 10 s | Tab-Events, schnelles Tab-Hopping |
| Alarm 1 min., aktiver Tab | Badge ohne Sidepanel bei gleicher URL; `bypassCache` am Alarm-Tick |
| `live-badge.ts` | Gemeinsame Logik für Background und Sidepanel-Formatierung |

---

## 6. Nachrichten-Retention (72 Stunden)

### 6.1 Ziel

Nachrichten in `chat_message` dürfen **höchstens 72 Stunden** auf dem Server existieren. Danach sind sie **physisch gelöscht** (nicht nur in der UI ausgeblendet).

- **Zwei Server-Mechanismen parallel**, damit die Datenbank auch bei Scheduler-Aussetzern oder Alt-Bestand **zuverlässig sauber** bleibt.
- **Extension:** unverändert volle URL-Subscription; Löschungen kommen über bestehende Table-Callbacks (`onDelete`) bzw. Subscription-Updates.

Referenz Implementierung: [spacetimedb.md](../kickoff/spacetimedb.md) (Kurzfassung). Produktidee: [ideas.md](../kickoff/ideas.md).

### 6.2 Konstanten

| Konstante | Wert |
|-----------|------|
| `MESSAGE_RETENTION` | `72` Stunden |
| `CLEANUP_INTERVAL` | `15` Minuten (wiederkehrender Job B) |

`MESSAGE_RETENTION` als eine Quelle im Rust-Modul (z. B. `Duration` aus Stunden), von A und B gemeinsam genutzt.

### 6.3 Mechanismus A, Scheduled Delete pro Nachricht

SpacetimeDB 1.x: **Scheduled Table** (nicht `ctx.schedule`).

**Tabelle:** `delete_message_schedule` mit `scheduled(delete_message)`, Felder `scheduled_id`, `scheduled_at: ScheduleAt`, `message_id`.

**Trigger:** Erfolgreiches `insert` in `send_message` → `schedule_message_deletion` legt eine Zeile an mit `scheduled_at: (created_at + 72h).into()` (einmaliger Lauf).

**Reducer `delete_message`:** Nur Aufruf durch Scheduler (`ctx.sender == ctx.identity()`); löscht `message_id` falls vorhanden, sonst noop.

**Effekt:** Löschung nahe am 72h-Zeitpunkt; verbundene Clients sehen das Delete in Echtzeit (`onDelete` in [spacetime.svelte.ts](../../extension/src/lib/spacetime.svelte.ts)).

### 6.4 Mechanismus B, Wiederkehrender Cleanup

**Tabelle:** `purge_expired_schedule` mit `scheduled(purge_expired_messages)`, Intervall-Job via `scheduled_at: cleanup_interval().into()` (`TimeDuration` → wiederholender Lauf alle **15 Min**).

**Reducer `purge_expired_messages`:** Scheduler-only; `cutoff = ctx.timestamp - 72h`; alle älteren `chat_message` löschen.

**Bootstrap:** `#[reducer(init)]` plus `ensure_purge_job` in `join_room` / `send_message` (bestehende DBs ohne erneutes `init` nach Publish-Upgrade).

**Effekt:** Sicherheitsnetz, spätestens ~15 Min nach Ablauf der 72h, falls Einzel-Timer fehlt; räumt Alt-Bestand auf.

### 6.5 Zusammenspiel A + B

| Situation | Ergebnis |
|-----------|----------|
| Normal | A löscht punktgenau; B findet nichts oder noop für diese ID |
| A verpasst / fehlgeschlagen | B löscht spätestens innerhalb eines Cleanup-Intervalls |
| B löscht früher (Batch) | A-Lauf später: `delete_message` noop |
| Doppel-Löschung | Idempotent, kein Fehler nötig |

**Kein Mechanismus C:** Subscription mit `created_at > …` in der Extension, **nicht** Teil der Retention-Policy (würde Server-Daten und SQL-Abfragen unverändert lassen).

### 6.6 Extension (`extension/`)

- **Keine** Änderung der Subscription-SQL nur wegen Retention.
- `chat_message.onDelete` entfernt Nachrichten aus dem Sidepanel-State.
- Optional später: UI-Hinweis „Nachrichten werden nach 72 h gelöscht“ (Datenschutz/Landingpage).

### 6.7 Akzeptanzkriterien

- [x] A + B in [server/src/lib.rs](../../server/src/lib.rs); publiziert als Modul `wepchat`.
- [ ] Nachricht älter als 72 h existiert **nicht** mehr in `chat_message` (Dashboard/SQL), *Langzeittest oder Dev-Modul mit verkürzter Retention*.
- [x] A: Jede neu gesendete Nachricht erzeugt einen Eintrag in `delete_message_schedule`.
- [x] B: `purge_expired_schedule` wird via `ensure_purge_job` befüllt; Intervall-Reducer aktiv.
- [x] Verbunde Clients: Delete-Event in `onDelete` implementiert.
- [x] Kein reines Client-Filtering als Ersatz für Server-Löschung.

### 6.8 Testideen

1. Testnachricht senden, `created_at` in Testumgebung verkürzen (nur dev) oder Wartezeit, Zeile weg nach Retention.  
2. `delete_message` manuell für existierende ID, Subscription aktualisiert.  
3. Zeile manuell mit altem `created_at` einfügen (dev), nächster `purge_expired_messages` entfernt sie.  
4. Doppelaufruf `delete_message`, kein Crash.

---

## 7. Bewusst nicht Ziel

- **Moderation durch Personen** (Moderatoren, Admin-Reducer zum Löschen fremder Nachrichten, Meldestaff pro Raum): praktisch unmöglich bei **einem Chat-Raum pro URL** und Milliarden möglicher Seiten; zudem werden **alle** Nachrichten nach **72 h** serverseitig gelöscht ([§6](#6-nachrichten-retention-72-stunden)), es gibt keinen dauerhaften Bestand, den Moderatoren pflegen müssten. Stattdessen: technische Grenzen (Rate-Limit, Zeichenregeln, Retention), Nutzer löschen **eigene** Nachrichten vorher optional ([delete-messages.md](delete-messages.md)), Safety-Hinweise in der UI (Info-Panel).
- Geheime API-Keys in der Extension ([security.md](security.md))
- Rate-Limit nur im UI ohne Server
- `public` Tabellen komplett abschalten
- **Retention nur im Client** (Subscription-Filter ohne Server-Delete)
- **Link-Erkennung per Regex** oder **max. N Links pro Nachricht**, **bewusst nicht**; Link-/Domain-Dropping im Chat-Text über [Message Content §8](message-content.md#8-links-domains-kein-link-regex) (Whitelist ohne `:` und `/`, kein URL-Parser).
- **Identity-basierte Langzeit-Quotas** (z. B. 100 Nachrichten / 72 h pro URL und `ctx.sender`), **verworfen** ([ideas.md](../kickoff/ideas.md)). SpacetimeDB-`Identity` ist an das lokale Token in der Extension gebunden; Angreifer rotieren per `chrome.storage` / neuem Profil, Zähler steht wieder auf 0. Trifft vor allem normale Power-User, kaum Skript-Spam. **Nicht** dasselbe wie [Retention §6](#6-nachrichten-retention-72-stunden) (löscht Nachrichten für **alle** nach 72 h) oder [2/Min §1](#1-nachrichten-rate-limit-2-pro-minute) (kurzes Fenster, gleiche Identity-Schwäche, aber geringe Belastung für Normalnutzer). Ausführlich: [learnings.md §11](../learnings.md#11-identity-limits-und-spam).
