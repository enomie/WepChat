# Learnings & Gotchas: SpacetimeDB in Chrome Extensions (MV3)

Dieses Dokument fasst die wichtigsten Erkenntnisse und Fallstricke beim Betrieb des **SpacetimeDB TypeScript SDKs** in einer **Chrome Extension (Manifest V3)** zusammen.

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
   Damit der Patch auch nach `npm install` oder Dependencies-Updates dauerhaft erhalten bleibt, führt `package.json` automatisch `node scripts/patch-spacetimedb.js` aus (`postinstall`: `wxt prepare && node scripts/patch-spacetimedb.js`).

---

## 2. SpacetimeDB TypeScript SDK v2.x: Reducer-Aufrufkonvention

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

## 3. Architektur: Eigener Server vs. SpacetimeDB

- **Kein herkömmlicher Node/Express-Server nötig**:  
  Der Rust-Code unter `server/src/lib.rs` wird als WebAssembly kompiliert und direkt in die SpacetimeDB-Engine deployed (`spacetime publish wepchat -y`).
- **Verbindung des Plugins**:  
  Die Extension verbindet sich über das SDK direkt per WebSocket (`wss://maincloud.spacetimedb.com`) mit dem Modul `wepchat`.
- **Presence & Lifecycle**:  
  Beim Schließen des Tabs oder Browserfensters greift serverseitig der `#[reducer(client_disconnected)]`-Hook in `server/src/lib.rs`, der die Benutzersitzung (`user_session`) automatisch löscht.
