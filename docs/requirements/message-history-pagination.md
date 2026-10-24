# Chat-Verlauf: initiale Fenstergröße & „Ältere laden“

Spezifikation für das **Sidepanel** ([`extension/src/App.svelte`](../../extension/src/App.svelte), [`spacetime.svelte.ts`](../../extension/src/lib/spacetime.svelte.ts)). Ziel: schneller Einstieg in den Raum, ohne beim Öffnen sofort den **gesamten** Verlauf der URL zu laden und zu rendern.

**Status:** Implementiert (§4.2 Client-Fenster). Code: [`message-history.ts`](../../extension/src/lib/message-history.ts), [`spacetime.svelte.ts`](../../extension/src/lib/spacetime.svelte.ts) (`visibleLimit`), [`App.svelte`](../../extension/src/App.svelte). Tests: `cd extension && npm run test:unit`.

Verwandt: [general.md](general.md), [security-list.md §6](security-list.md#6-nachrichten-retention-72-stunden) (max. 72 h Historie), [live_badge.md](live_badge.md) (Presence, nicht Nachrichtenanzahl).

---

## 1. Ziel & UX (kurz)

| Situation | Verhalten |
|-----------|-----------|
| Extension öffnen / Raum laden | Zuerst nur die **neuesten 100** Nachrichten dieses Raums (URL nach `cleanUrl`) |
| Anordnung | **Älteste oben, neueste unten** (klassischer Chat); beim Öffnen **nach unten** scrollen (neueste sichtbar) |
| Nach oben scrollen | Am oberen Rand: **„Ältere Nachrichten laden“** (Button oder klickbarer Streifen), **nicht** automatisch ohne Nutzeraktion (vermeidet Scroll-Sprünge beim versehentlichen Overscroll) |
| Klick „Ältere laden“ | Weitere **100** ältere Nachrichten **oben einfügen**; Scrollposition **stabil** halten (Nutzer bleibt auf derselben Bubble) |
| Wieder oben | Wenn es noch ältere gibt → gleicher Button erneut; wenn nicht → Hinweis *„Keine älteren Nachrichten“* oder Button ausblenden |
| Neue Nachrichten (Echtzeit) | Kommen weiterhin **unten** an (`onInsert`), auch wenn nur ein Fenster geladen ist, Nutzer im aktuellen Verlauf sieht sie sofort |

**Konstante (Vorschlag):** `MESSAGE_PAGE_SIZE = 100`.

---

## 2. Ist-Zustand

- [`subscribeToUrl`](../../extension/src/lib/spacetime.svelte.ts): Subscription lädt **alle** `chat_message` zur URL; `onApplied` iteriert die komplette lokale Tabelle.
- [`App.svelte`](../../extension/src/App.svelte): rendert `spacetimeChat.current.messages` vollständig; Auto-Scroll bei neuen Nachrichten nach unten.

Das skaliert schlecht in beliebten Räumen (viele Nachrichten innerhalb von 72 h) und kostet Speicher/Render-Zeit, obwohl der Nutzer meist nur die letzten Einträge braucht.

---

## 3. Fachliche Regeln

### 3.1 Sortierung & Identität der „Seite“

- Sortierung stabil nach **`id`** (monoton steigend, entspricht grob Sende-Reihenfolge), gleiche Logik wie heute `sort((a,b) => Number(a.id) - Number(b.id))`.
- **Ältere Seite** = Nachrichten mit **`id` kleiner** als die aktuell **älteste geladene** `id` im UI-State.
- Raum-Schlüssel: normalisierte **`url`** (wie `join_room` / `send_message`).

### 3.2 Was zählt als „noch älter vorhanden“?

- Es existiert mindestens eine `chat_message` für diese `url` mit `id < oldestLoadedId`.
- Oder: letzter „Ältere laden“-Request lieferte **genau 100** Zeilen (dann **vermutlich** noch mehr, bis ein Request **&lt; 100** liefert).
- Serverseitig gibt es ohnehin nur Nachrichten **≤ 72 h** ([Retention](security-list.md#6-nachrichten-retention-72-stunden)).

### 3.3 Echtzeit vs. Historie

| Ereignis | Verhalten |
|----------|-----------|
| `onInsert` im Raum | Wenn `id` **größer** als bisher sichtbares Maximum → an **Ende** der Liste; Auto-Scroll nur wenn Nutzer **bereits unten** war (bestehendes Verhalten verfeinern) |
| `onDelete` (Retention / später User-Delete) | Zeile aus sichtbarer Liste entfernen; wenn gelöschte Zeile die älteste geladene war → `oldestLoadedId` / `hasMore` neu bestimmen |
| Raumwechsel (URL) | State zurücksetzen: wieder nur neueste 100 für neue URL |

---

## 4. Implementierungsrichtungen

### 4.1 Empfohlen: keyset-Pagination (nach `id`)

Zwei getrennte Datenpfade:

1. **Live-Tail:** Subscription (oder gefilterte Subscription) für **neue** Nachrichten im Raum, z. B. `id > newestLoadedId` nach initialem Laden, oder weiterhin volle URL-Subscription mit Client-Filter (einfacher MVP, mehr Traffic).
2. **Historie:** Explizites Nachladen älterer Seiten per **SQL** (HTTP-SQL wie im Badge oder zweite Subscription / einmalige Abfrage, SDK-Fähigkeiten beim Umsetzen prüfen):

```sql
-- Neueste 100 (Initial)
SELECT * FROM chat_message WHERE url = ? ORDER BY id DESC LIMIT 100

-- Nächste ältere Seite (cursor = kleinste id der aktuellen Ansicht)
SELECT * FROM chat_message WHERE url = ? AND id < ? ORDER BY id DESC LIMIT 100
```

Ergebnis jeweils **aufsteigend sortieren** für die UI (älteste oben).

**Vorteil:** Weniger Daten über WebSocket (theoretisch).

**Warum nicht für WepChat (Entscheidung):** SpacetimeDB-Views sind keine parametrisierte RPC; dynamisches Resubscribe mit `id >= …` erzeugt Snapshot/Live-Races; bei **72h-Retention** ist der Raum-Bestand typischerweise überschaubar, der Aufwand lohnt sich nicht vor messbarem Bedarf.

### 4.2 Client-Fenster (Slice), **Implementierungsweg**

Volle Subscription `WHERE url = '…'` (unverändert). `state.messages` enthält den Raum-Cache (sortiert nach `id`). Die UI rendert nur `messages.slice(-visibleLimit)` mit `visibleLimit` start **100**; „Ältere laden“ erhöht `visibleLimit` um 100 (synchron, Daten bereits im Speicher).

| Pro | Contra |
|-----|--------|
| Kein Server-/Publish-Risiko | WebSocket synct weiterhin alle Raum-Nachrichten |
| Echtzeit unten ohne Race | Bei extrem großen Räumen ggf. später §4.1 nachziehen |
| Sofortiges „Ältere laden“, stabiler Scroll-Anker | |

Umsetzung: [message-history-pagination.plan.md](../../.cursor/plans/message-history-pagination.plan.md).

---

## 5. UI (`App.svelte`)

### 5.1 „Ältere laden“

- Platzierung: **oben** im Scroll-Container `.messages`, sticky oder als erste Zeile im Flex-Column.
- Zustände:
  - `hasOlder === true` → Button *„Ältere Nachrichten laden“* (optional: „(100)“).
  - `loadingOlder` → disabled + *„Laden…“*.
  - `hasOlder === false` → kein Button oder dezenter Text *„Beginn des Verlaufs“*.
- Optional später: zusätzlich Button zeigen, wenn `scrollTop < Schwellwert` (z. B. 80 px), **Klick** bleibt Pflicht zum Laden (kein endloses Auto-Load beim Scroll).

### 5.2 Scroll-Anker beim Prepended

Beim Einfügen von N Nachrichten **oben**:

- Vorher `scrollHeight` und `scrollTop` speichern.
- Nach DOM-Update: `scrollTop = newScrollHeight - oldScrollHeight + oldScrollTop` (oder `scrollIntoView` auf der zuvor obersten sichtbaren Bubble).

Ohne Anker springt die Ansicht, schlechte UX.

### 5.3 Auto-Scroll unten

- Beim **ersten** Öffnen des Raums: nach Laden der initialen 100 **einmal** nach unten scrollen.
- Bei **neuer** Nachricht: nur auto-scrollen, wenn Nutzer **nahe unten** (z. B. `scrollHeight - scrollTop - clientHeight < 100`).

---

## 6. State (Extension)

Implementierung (§4.2) in `spacetime.svelte.ts` / `message-history.svelte.ts`:

| Feld | Bedeutung |
|------|-----------|
| `messages` | Vollständiger Raum-Cache, aufsteigend nach `id` |
| `visibleLimit` | Anzahl der **untersten** Nachrichten, die gerendert werden (Start **100**) |
| `hasOlder` | `messages.length > visibleLimit` |

`loadOlderVisible()` → `visibleLimit += 100` (gedeckelt auf `messages.length`). Kein Netzwerk-Request.

---

## 7. Sicherheit & SQL

- **`url` escapen** in Subscriptions/SQL: [`sql-literal-escape.ts`](../../extension/src/lib/sql-literal-escape.ts) (Sidepanel + Background), siehe [security-list.md §3](security-list.md#3-extension--verteidigung-in-der-tiefe-backlog).
- Keine neuen Server-Reducer nötig für reine Lese-Pagination, sofern öffentliche `chat_message` + SQL ausreichen.

---

## 8. Akzeptanzkriterien

- [x] Raum mit &gt; 100 Nachrichten: beim Öffnen **höchstens 100** gerendert, neueste unten sichtbar.
- [x] „Ältere laden“ erweitert `visibleLimit` um **100** (Rest wenn &lt; 100 übrig), Scrollposition stabil.
- [x] Kein Button, wenn `messages.length <= visibleLimit`.
- [x] Neue Nachricht erscheint unten in Echtzeit (voller Cache + Slice).
- [x] URL-Wechsel: `visibleLimit` reset auf 100.
- [x] Raum mit ≤ 100 Nachrichten: kein „Ältere laden“-Button.

### 8.1 Testideen (manuell)

1. Dev-Raum mit 250 Testnachrichten (oder Script) → initial 100, zwei Mal „Ältere laden“ → 250 sichtbar, Button weg.
2. Während oben gelesen wird: neue Nachricht unten → kein erzwungener Sprung nach unten.
3. URL mit `'` im Pfad (falls erlaubt) → kein SQL-Bruch.
4. Nach 72 h Retention: älteste Seiten verschwinden serverseitig, „Beginn des Verlaufs“ ohne Fehler.

---

## 9. Dokumenten-Links

- Idee-Sammlung: [ideas.md](../kickoff/ideas.md)
- Architektur Extension: [architektur.md](architektur.md)
