# Learnings & Gotchas: SpacetimeDB in Chrome Extensions (MV3)

Dieses Dokument fasst die wichtigsten Erkenntnisse und Fallstricke beim Betrieb des **SpacetimeDB TypeScript SDKs** in einer **Chrome Extension (Manifest V3)** zusammen.

**Zugangsdaten, Threat Model, öffentliche Tabellen:** [requirements/security.md](requirements/security.md)

---

## 1. Chrome Extension Content Security Policy (CSP) & `unsafe-eval`

### Das Problem
Chrome Manifest V3 verbietet im Sidepanel, in Popups und in Service Workern standardmäßig jegliche Ausführung von dynamischem Code (`eval` und `new Function(...)`).
Wird versucht, dynamisch Code zu evaluieren, bricht die Extension sofort ab mit:
```text
EvalError: Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script
```

### Ursache im SpacetimeDB TypeScript SDK
Das offizielle SpacetimeDB SDK verwendet intern an zwei Stellen Code-Generation via String & `Function(...)`:
1. **`algebraic_type.ts` (`ProductType` und `SumType`)**:  
   Zur Performance-Optimierung baut das SDK dynamische Serializer und Deserializer als JavaScript-Funktions-Strings und instanziiert sie mit `Function('writer', 'value', body)` bzw. `Function('reader', body)`.
2. **`sdk/ws.ts` (`dynamicImport`)**:  
   Verwendet `new Function('m', 'return import(m)')` als Trick für dynamische Node.js-Imports (`undici`), falls kein globales `WebSocket` existiert.

### Die Lösung (Statische Interpreter-Schleifen)
Die dynamische Codegenerierung wurde durch CSP-konforme, statische Schleifen ersetzt:

1. **`ProductType.makeSerializer` & `makeDeserializer`**:
   Iteriert direkt über die Feldnamen des Typs und ruft die Einzelsub-Serializer auf, statt dynamischen Code per `Function(...)` zu erzeugen:
   ```ts
   const serializers: Record<string, Serializer<any>> = {};
   const fieldNames = ty.elements.map(e => e.name!);
   serializer = (writer: BinaryWriter, value: any) => {
     for (let i = 0; i < fieldNames.length; i++) {
       const name = fieldNames[i];
       serializers[name](writer, value[name]);
     }
   };
   ```

2. **`SumType.makeSerializer` & `makeDeserializer`**:
   Nutzt ein statisches Tag-zu-Index-Mapping für Tagged Unions / Enums:
   ```ts
   const tagToIndices: Record<string, number> = {};
   for (let i = 0; i < ty.variants.length; i++) {
     tagToIndices[ty.variants[i].name!] = i;
   }
   serializer = (writer: BinaryWriter, value: any) => {
     const tag = value.tag;
     const index = tagToIndices[tag];
     writer.writeByte(index);
     serializers[tag](writer, value.value);
   };
   ```

3. **Automatisierung via Postinstall-Script**:
   Damit der Patch auch nach `npm install` oder Dependencies-Updates dauerhaft erhalten bleibt, führt `package.json` automatisch `node scripts/patch-spacetimedb.js` und `node scripts/patch-spacetimedb-codegen.js` aus (`postinstall` in `extension/package.json`).

---

## 2. TypeScript-Bindings: fehlendes Index-`accessor`

### Das Problem
```text
Uncaught TypeError: Index 'id' on table 'chat_message' must define a non-empty 'accessor'
```

### Ursache
Die SpacetimeDB-CLI (z. B. 2.0.x) schreibt in `extension/src/lib/spacetimedb/index.ts` Index-Metadaten nur mit `name`, `algorithm`, `columns`. Das npm-Paket `spacetimedb` (^2.13) verlangt zusätzlich **`accessor`** pro Index (z. B. `'id'`, `'identity'`).

### Die Lösung
1. Nach jedem `spacetime generate` im Extension-Ordner:
   ```bash
   cd extension
   npm run codegen:stdb
   ```
   Das führt Generate + `scripts/patch-spacetimedb-codegen.js` aus (setzt `accessor` an den Btree-Indizes).
2. `postinstall` wendet den Codegen-Patch an, falls `index.ts` schon im Repo liegt.

Manuell (falls nötig): in `index.ts` bei jedem Index `{ accessor: 'id', name: 'id', ... }` ergänzen.

---

## 3. SpacetimeDB TypeScript SDK v2.x: Reducer-Aufrufkonvention

### Das Problem
```text
TypeError: conn.reducers.join_room is not a function
```

### Ursache
Im SpacetimeDB TypeScript SDK v2:
1. **CamelCase-Namen**: Reducer aus Rust (z. B. `join_room`, `send_message`, `leave_room`) werden auf dem Client automatisch in CamelCase umgewandelt (`joinRoom`, `sendMessage`, `leaveRoom`).
2. **Objekt-Parameter**: Reducer erwarten **ein einziges Parameter-Objekt**, dessen Eigenschaften den Argumentnamen im Rust-Code entsprechen, **nicht** mehrere getrennte Argumente.

### Richtige Aufrufe:
```ts
// FALSCH (führt zu TypeError oder Serialisierungsfehlern):
conn.reducers.join_room(url, username);
conn.reducers.send_message(url, username, text);
conn.reducers.leave_room();

// RICHTIG:
conn.reducers.joinRoom({ url, username });
conn.reducers.sendMessage({ url, username, text });
conn.reducers.leaveRoom({});
```

---

## 4. Architektur: Eigener Server vs. SpacetimeDB

- **Kein herkömmlicher Node/Express-Server nötig**:  
  Der Rust-Code unter `server/src/lib.rs` wird als WebAssembly kompiliert und direkt in die SpacetimeDB-Engine deployed (`spacetime publish wepchat -y`).
- **Verbindung des Plugins**:  
  Die Extension verbindet sich über das SDK direkt per WebSocket (`wss://maincloud.spacetimedb.com`) mit dem Modul `wepchat`.
- **Presence & Lifecycle**:  
  Beim Schließen des Tabs oder Browserfensters greift serverseitig der `#[reducer(client_disconnected)]`-Hook in `server/src/lib.rs`, der die Benutzersitzung (`user_session`) automatisch löscht.

---

## 5. Semantische URL-Normalisierung (Raum-Matching)

### Das Problem
Im Web haben viele URLs unterschiedliche Query-Parameter für denselben Inhalt:
* YouTube-Playlists: `https://www.youtube.com/watch?v=LnjxP6dqkDQ&list=RD...&start_radio=1`
* Timestamps: `https://www.youtube.com/watch?v=LnjxP6dqkDQ&t=42s`
* Share-Links: `https://youtu.be/LnjxP6dqkDQ?si=abc`
* Tracking / Marketing: `?utm_source=twitter&ref=sr_1_1&fbclid=...`

Würde man alle Query-Parameter pauschal abschneiden (`parsed.origin + parsed.pathname`), würden alle YouTube-Videos im selben Raum `https://www.youtube.com/watch` landen. Lässt man dagegen alle Parameter unverändert, landet jeder Nutzer mit einem anderen Tracking-Link in einem eigenen, isolierten Raum.

### Die Lösung in `src/lib/url.svelte.ts`
Die Funktion `cleanUrl()` unterscheidet zwischen **identitätsstiftenden Parametern** und **Tracking/Zustand**:

1. **YouTube & Shortlinks**:
   - `youtube.com/watch`: Behält ausschließlich `?v={id}`.
   - `youtu.be/{id}` & `youtube.com/shorts/{id}`: Werden automatisch zu `https://www.youtube.com/watch?v={id}` kanonisiert.
   - Playlists (`list`), Radios (`start_radio`), Timestamps (`t`) und Share-Tracker (`si`, `feature`) werden entfernt, damit alle Zuseher desselben Videos im selben Chatraum sind.

2. **Amazon**:
   - Beliebige Produktpfade (z. B. `/Apple-AirPods-.../dp/B07PZR3PVB/ref=...`) werden auf die kanonische ASIN reduziert: `https://amazon.de/dp/B07PZR3PVB`.

3. **Google Suche**:
   - Reduktion auf den Suchbegriff `?q=...`. Interne Tracking-Parameter (`oq`, `sourceid`, `crid`, etc.) fliegen raus.

4. **Tracking-Filter für alle anderen Websites**:
   - Entfernt bekannte Ad-/Tracking-Keys (`utm_*`, `ref`, `fbclid`, `gclid`, `session_id`, etc.).
   - Relevante Parameter (z. B. `?id=123` oder `?page=2`) bleiben erhalten.
   - URL-Hashes (`#section`) werden gestrippt.

---

## 6. Virtuelle Räume & Presence-Lifecycle

### Keine `Room`-Tabelle nötig
WepChat benötigt keine eigene Raum-Tabelle in der Datenbank:
* Ein Raum ist rein **virtuell** durch den Wert der Spalte `url` in `user_session` und `chat_message` definiert.
* Wenn eine Seite von niemandem besucht wird und keine Nachrichten existieren, belegt dieser Raum **0 Bytes**.

### Warum gibt es `user_session`-Einträge ohne Nachrichten?
* Sobald ein Nutzer mit geöffnetem Sidepanel auf eine Seite navigiert, meldet das Plugin den Nutzer per `conn.reducers.joinRoom({ url, username })` an.
* Dadurch weiß jeder andere Besucher in Echtzeit: *„Hier sind gerade 2 Nutzer online“* (Presence-Tracking), noch bevor jemand etwas schreibt.
* Pro Nutzer existiert in `user_session` genau **1 Zeile** (Primärschlüssel ist die SpacetimeDB `Identity`). Beim Wechsel der URL wird nur diese eine Zeile aktualisiert.
* Trennt der Nutzer die Verbindung (Tab oder Browser schließen), löscht der serverseitige `client_disconnected`-Hook die Zeile automatisch wieder.

---

## 7. Svelte 5: Rate-Limit und `state_unsafe_mutation`

### Das Problem
```text
Uncaught Error: https://svelte.dev/e/state_unsafe_mutation
```
Im Sidepanel, sobald `$derived(rateLimitState.cooldownRemainingMs())` aktiv ist.

### Ursache
In `rate-limit.svelte.ts` wurde `cooldownRemainingMs()` innerhalb von `$derived` in `App.svelte` aufgerufen und hat dort **`prune()`** ausgeführt — also `$state` (`sendTimestamps`) **während einer Derived-Berechnung** mutiert. Das verbietet Svelte 5.

### Die Lösung (Implementierung)
* **Lesen:** `activeTimestamps(now)` filtert nur, ohne Zuweisung an `$state`.
* **Schreiben:** `prune()` nur in `recordSend()` und `bumpTick()` (1‑Sekunden-Timer in `App.svelte`).

Spezifikation Rate-Limit: [security-list.md](requirements/security-list.md#1-nachrichten-rate-limit-2-pro-minute). Code: `extension/src/lib/rate-limit.svelte.ts`.

---

## 8. Security-Härtung (Rate-Limit, Retention)

Server-Logik in `server/src/lib.rs` (2 Nachrichten / 60 s, 72 h Retention via Scheduled Tables). Übersicht: [security-list.md](requirements/security-list.md).

---

## 9. Nachrichten-Zeichenfilter (`message-text-policy.ts`)

- **Eine Policy-Datei:** `extension/src/lib/message-text-policy.ts` — `filterMessageInput` (Tippen/Paste), `prepareMessageForSend` (Senden).
- **Nicht in `$derived` filtern** — nur in Event-Handlern (`oninput` / `onpaste`), sonst Risiko `state_unsafe_mutation` (wie §7).
- **Server lehnt ab, säubert nicht:** Verbotene Zeichen in `send_message` / `join_room` → `return`, kein Strip fremder Müll-Strings.
- Spec: [message-content.md](requirements/message-content.md).

