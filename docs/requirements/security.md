# Sicherheit & Secrets (WepChat + SpacetimeDB)

Dieses Dokument beschreibt, **welche Zugangsdaten es gibt**, **wo sie hingehören**, **was Angreifer realistisch können**, und wie Schutz primär im **Rust-Modul** (`server/src/lib.rs`) stattfindet, nicht durch versteckte Keys in der Extension.

Verwandte Docs:

- [Security-Härtung: Backlog & Spezifikationen](security-list.md) (Rate-Limit, Umsetzungsreihenfolge)
- [Allgemeine Anforderungen](general.md) (Anonymität, lokales Profil, URL-Normalisierung)
- [SpacetimeDB Backend Guide](../kickoff/spacetimedb.md) (Publish, Tabellen, Reducer)
- [Live Badge](live_badge.md) (HTTP-SQL im Background Worker)
- [Learnings: Extension + SDK](../learnings.md) (CSP, Patches)

---

## 1. Threat Model (kurz)

WepChat ist ein **öffentlicher URL-Chat**: Jeder, der die Extension (oder die gleichen Endpunkte) nutzt, kann als Client teilnehmen. Es gibt **kein** klassisches „Login mit Passwort“ für Endnutzer.

| Akteur | Ziel | Realistisches Risiko heute |
|--------|------|----------------------------|
| Zufälliger Internet-Nutzer | Chat spamen, Presence verfälschen, öffentliche Daten lesen | **Hoch** (by design bei `public` Tabellen) |
| Jemand mit ausgepackter Extension | URI + Modulname sehen, Reducer/SQL nachbauen | **Erwartet**, kein Schutz durch Obfuscation |
| Angreifer mit **deinem** SpacetimeDB-CLI-Login | Modul überschreiben, DB löschen, Kosten/Abuse auf deinem Account | **Kritisch**, darf **nie** in Client-Code landen |
| Mitbewohner auf gleicher URL | Chat lesen/schreiben | **Erwartet** (Produktziel) |

**Fazit:** Die Extension ist **nicht** ein Vertrauensraum für Geheimnisse. Vertrauen und Grenzen setzt du **serverseitig** in Reducers und Tabellen-Sichtbarkeit.

---

## 2. Zwei völlig verschiedene „Keys“

### 2.1 Entwickler-/Owner-Zugang (geheim halten)

| Was | Zweck | Wo speichern |
|-----|--------|----------------|
| **SpacetimeDB CLI-Session** (`spacetime login`) | `spacetime publish`, Schema deployen, Datenbank verwalten | Nur auf dem **Entwickler-Rechner** (CLI-Konfiguration) oder **CI-Secrets** (z. B. GitHub Actions) |
| **Account-Zugang** zum SpacetimeDB-Dashboard | Metriken, Modul-Verwaltung | Passwort/SSO wie beim Anbieter, nicht im Repo |

**Niemals:**

- in `extension/` committen
- in `.env` einbinden, die mit der Extension gebaut wird
- in öffentlichen Issue-Screenshots oder Logs posten

Publish-Befehl (nur lokal/CI): siehe [spacetimedb.md](../kickoff/spacetimedb.md).

### 2.2 Client-Zugang (öffentlich / pro Browser)

| Was | Zweck | Wo speichern |
|-----|--------|----------------|
| **`SPACETIMEDB_URI`** (z. B. `wss://maincloud.spacetimedb.com`) | WebSocket-Ziel | Hardcoded in `extension/src/lib/spacetime.svelte.ts`, **normal** |
| **`MODULE_NAME`** (z. B. `wepchat`) | Datenbank-/Modulname | Ebenfalls im Client, **normal** |
| **SpacetimeDB `Identity`** | Kryptografische Client-ID (`ctx.sender` serverseitig) | Vom Server vergeben; Hex-String optional in UI-State |
| **Reconnect-/Auth-Token** (WebSocket) | Dieselbe Identity beim nächsten Connect behalten | Optional `browser.storage.local`, **Session**, kein Admin-Key |

Implementierung Verbindung:

```8:9:extension/src/lib/spacetime.svelte.ts
const SPACETIMEDB_URI = 'wss://maincloud.spacetimedb.com';
const MODULE_NAME = 'wepchat';
```

Das SDK kann bei vorhandenem `authToken` einen kurzlebigen WebSocket-Token anfordern (`v1/identity/websocket-token`), siehe `extension/src/lib/ws-browser-override.ts`. Das ist **Identitäts-Wiederherstellung**, nicht Datenbank-Ownership.

---

## 3. Warum „Secret in der Extension“ die DB nicht schützt

Jede Browser-Extension ist **vollständig einsehbar** (Quellcode, gebündelte JS-Dateien, Netzwerk-Tab). Ein API-Key in der Extension wäre für alle extractierbar.

Schutzmodell bei SpacetimeDB/WepChat:

1. **Öffentliche Verbindungsparameter** (URI, Modulname), wie eine öffentliche API-URL.
2. **`public` Tabellen**, lesbar/subscribbar für Clients gemäß Plattform-Regeln.
3. **Reducer**, jede Mutation läuft durch Rust-Code; `ctx.sender` ist die authentische Identity (nicht vom Client frei wählbar).
4. **Owner-Rechte**, nur über CLI/Account, nicht über Client-Token.

---

## 4. Transportverschlüsselung (TLS)

Alle Client-Verbindungen von WepChat zum gehosteten Backend laufen über **TLS**:

| Pfad | Protokoll | Code |
|------|-----------|------|
| Sidepanel (Chat, Presence, Reducer) | `wss://` (WebSocket über TLS) | `extension/src/lib/spacetime.svelte.ts` |
| Background (Sidepanel öffnen) | — | `extension/src/entrypoints/background.ts` (kein URL-HTTP) |
| Entwickler-Publish (`spacetime publish`) | HTTPS der CLI zum Cloud-Host | nur lokal/CI |

**Was TLS leistet:** Schutz **auf dem Transportweg** (WLAN, ISP, Mitläufer im Netz). Payload ist für Dritte unterwegs nicht im Klartext lesbar.

**Was TLS nicht leistet:**

- **Kein Ende-zu-Ende-Chat** zwischen Nutzern. Nachrichten sind für jeden im gleichen URL-Raum lesbar (öffentliche Tabellen, siehe Abschnitt 5).
- **Kein Geheimnis vor dem Betreiber** des Backends (Speicher, Betrieb, Dashboard).
- Das WebSocket-**Reconnect-Token** sichert nur die **Identity-Wiedererkennung**, nicht Vertraulichkeit der Inhalte.

**Nutzer-FAQ (ohne Backend-Anbieter):** Sidepanel „Info & Datenschutz“, Locale-Keys `info.faq6` (Verschlüsselung), `info.faq7` (Badge, keine URL-Erfassung ohne Sidepanel) in `extension/src/locales/`.

---

## 5. Aktuelles Datenmodell & Sichtbarkeit

In `server/src/lib.rs` sind beide Kern-Tabellen **`public`**:

- `user_session`, Presence (wer ist auf welcher URL)
- `chat_message`, Nachrichten pro URL

Reducer (u. a.): `join_room`, `leave_room`, `send_message`, `identity_disconnected`.

**Was das bedeutet:**

- Jeder Client kann (innerhalb der SpacetimeDB-Regeln) **teilnehmen** und die öffentlichen Daten **sehen**.
- Es gibt **keine** serverseitige Bindung „`sender_name` muss zur Identity passen“, der Client übergibt `username` als String; Missbrauch (falsche Anzeigenamen) ist möglich.
- Es gibt **keine** Rate-Limits, Längenlimits oder Inhaltsfilter im Backend (geplant: [ideas.md](../kickoff/ideas.md), [general.md](general.md)).

**Betreiber-Operationen** (Publish, Schema, ggf. spätere kostenpflichtige Features) laufen nur über **CLI/Account**, nicht über die Extension. **Keine personenbezogene Moderation** fremder Chat-Inhalte pro URL-Raum (Skalierung, **72 h-Retention**, siehe [security-list.md §7](security-list.md#7-bewusst-nicht-ziel)).

---

## 6. Live Badge und Background (Datenschutz)

Der **Background Service Worker** sendet **keine** Tab-URLs an SpacetimeDB. Er öffnet das Sidepanel (Chrome) und setzt beim Start einen leeren Badge.

Die **Badge-Zahl** am Icon wird nur aktualisiert, solange das **Sidepanel offen** ist: der Count kommt aus der bestehenden WebSocket-Subscription auf `user_session` (`spacetime.svelte.ts`), nicht aus HTTP-SQL im Hintergrund. Beim Schließen des Panels wird die Verbindung getrennt und der Badge geleert.

**Server-Kontakt mit URL** (Raum beitreten, Nachrichten, Subscriptions) passiert damit nur, wenn der Nutzer WepChat aktiv nutzt. Details: [live_badge.md](live_badge.md).

Die Hilfsfunktion `fetchOnlineCount` in `live-badge.ts` (öffentlicher SQL-Endpoint) ist für Tests reserviert und wird im Extension-Runtime-Pfad nicht aufgerufen.

---

## 7. Datenschutz im Client (keine Secrets, aber sensible UX)

| Maßnahme | Ort | Zweck |
|----------|-----|--------|
| Pseudonym + Avatar-Farbe | `browser.storage.local` (`profile.svelte.ts`) | Kein zentraler Account |
| URL-Normalisierung | `url.svelte.ts` / `url-utils.ts` | Gleicher Raum, weniger Tracking-Parameter in Chat-Räumen |
| Keine Pflicht-Social-Logins | Produkt | Weniger Identitäts-Leaks |

**Was trotzdem auf dem Server landet:** normalisierte **URL**, **Nachrichtentext**, **Anzeigename**, **Identity** (hex), Zeitstempel. Das ist für den Chat nötig und in der Datenschutzerklärung (`web/`) zu beschreiben.

**Kontakt (Datenschutz & Sicherheit):** wepchat@proton.me

---

## 8. Extension & Supply Chain

- **CSP / `unsafe-eval`:** SpacetimeDB-SDK wurde für MV3 gepatcht (`extension/scripts/patch-spacetimedb.js`, `postinstall`), siehe [learnings.md](../learnings.md).
- **Codegen:** Nach Schema-Änderungen `npm run codegen:stdb` in `extension/` ([learnings.md](../learnings.md#2-typescript-bindings-fehlendes-index-accessor)).
- **Dependencies:** Regelmäßig `npm audit` im `extension/`-Ordner; Patches nach Updates prüfen.
- **Gebaute Artefakte** unter `extension/.output/` sind öffentlich im Repo, enthalten **keine** CLI-Tokens, nur Client-Konfiguration.

---

## 9. Empfohlene Härtung (Roadmap)

Priorität aus Produktrisiko:

1. **Reducer-Validierung:** Max-Länge für `text`, `username`, `url`; leere/Whitespace bereits teilweise abgefangen.
2. **Rate-Limiting** pro `ctx.sender`, Spezifikation: **2 Nachrichten / 60 s**, UX mit Countdown: [security-list.md](security-list.md#1-nachrichten-rate-limit-2-pro-minute).
3. **Retention 72 h**, Scheduled Delete pro Nachricht **und** wiederkehrender Cleanup (nur Server): [security-list.md](security-list.md#6-nachrichten-retention-72-stunden), Kurz [spacetimedb.md](../kickoff/spacetimedb.md).
4. **Inhaltsregeln**, umgesetzt: [message-content.md](message-content.md) (`message-text-policy.ts` + `send_message` / `join_room`). Darin auch **kein Link-Regex**: Affiliate/Phishing-URLs im Text werden durch die Zeichen-Whitelist verhindert (`:` `/` u. a. verboten), [§8 Links & Domains](message-content.md#8-links-domains-kein-link-regex).
5. **Localhost ausschließen**, Client + Server ([url-eligibility.md](url-eligibility.md)).
6. **Eigene Nachrichten löschen**, umgesetzt: [delete-messages.md](delete-messages.md).
7. **Sensible Tabellen `private`** machen, falls später Nutzerdaten jenseits des öffentlichen Chats nötig sind.

**Nicht geplant:** Moderation durch Personen oder Admin-Reducer zum Entfernen fremder Nachrichten (Skalierung + [72 h-Retention](security-list.md#6-nachrichten-retention-72-stunden), [security-list.md §7](security-list.md#7-bewusst-nicht-ziel)).

---

## 10. Checkliste

### Vor jedem Release

- [ ] Kein `spacetime`-Token, kein `.env` mit Owner-Credentials im Git-Index
- [ ] `git log` / PR-Diffs auf versehentliche Secrets prüfen
- [ ] Bewusstsein: `public` Tabellen = öffentlich lesbar

### Nur auf dem Entwickler-PC / in CI

- [ ] `spacetime login` für Publish
- [ ] `spacetime publish wepchat` aus `server/`

### In der Extension (erlaubt)

- [ ] `SPACETIMEDB_URI`, `MODULE_NAME`
- [ ] Optional: gespeichertes Identity-Reconnect-Token in `storage.local`
- [ ] Profil lokal

### Nicht in der Extension

- [ ] SpacetimeDB-Account-Passwort / CLI-Session für Publish
- [ ] „Master-API-Key“, der Löschen/Publish erlaubt
- [ ] Keine „Moderator“-Logik im Client (personenbezogene Moderation ist kein Produktziel)

---

## 11. FAQ (Entwickler)

**„Sind Nachrichten verschlüsselt?“**  
**Transport:** ja, über `wss://` und `https://` (TLS). **Inhalte:** kein E2E-Geheimchat; öffentliche Räume und Server-Speicher bis Retention (Abschnitt 4 und 5).

**„Kann jeder mit meiner Extension in meine DB?“**  
Als **Chat-Client** ja, genau so wie deine Nutzer. Als **DB-Owner** (publish/löschen) nur mit **deinem** CLI-/Account-Login, nicht aus der Extension.

**„Muss ich URI und Modulname geheim halten?“**  
Nein. Sicherheit kommt aus Reducer-Logik, Tabellen-Sichtbarkeit und Betrieb, nicht aus versteckter URL.

**„Wo lege ich SpacetimeDB Keys hin?“**  
- **Publish/Admin:** lokal + CI-Secrets.  
- **Client:** URI/Modulname im Code; Identity-Token optional lokal im Browser.

**„Ist `sender_name` vertrauenswürdig?“**  
Nein, nur Anzeige. Vertrauenswürdig ist **`sender_identity`** (`ctx.sender`), die der Server der Verbindung zuordnet.

**„Kann Nutzer eigene Nachrichten löschen?“**  
Ja, Papierkorb links neben der eigenen Blase (ein Klick). Server: nur `delete_own_message` bei passender `sender_identity`. Details: [delete-messages.md](delete-messages.md).

**„Gibt es Moderatoren?“**  
Nein. Pro Webseiten-URL ein offener Raum, zu viele URLs für menschliche Moderation; Inhalte verschwinden ohnehin nach **72 h** automatisch vom Server. Schutz über technische Regeln, Retention, eigenes Löschen und Safety-Hinweise in der Extension ([security-list.md §7](security-list.md#7-bewusst-nicht-ziel)).
