# Raum-Pseudonym: Eindeutigkeit & Suffixe

Spezifikation für **eindeutige Anzeigenamen pro Chat-Raum** (normalisierte URL). Der Nutzer tippt einen **Wunschnamen**; der Server vergibt den **Raum-Anzeigenamen** (`user_session.username`) und schreibt denselben Wert in `chat_message.sender_name` beim Senden.

Verwandt: [message-content.md](message-content.md) (Zeichen, Länge 13), [nickname-appearance.md](nickname-appearance.md) (Farbe unabhängig vom Namen), [delete-messages.md](delete-messages.md), [security-list.md §2](security-list.md#2-server-weitere-härtung-backlog), [security.md](security.md).

**Status:** Implementiert. Server: [`server/src/lib.rs`](../../server/src/lib.rs) (`assign_room_display_name`, `join_room`, `send_message`), Tests `room_pseudonym_tests`. Extension: [`spacetime.svelte.ts`](../../extension/src/lib/spacetime.svelte.ts), [`App.svelte`](../../extension/src/App.svelte).

---

## 1. Ziel & Abgrenzung

| Aspekt | Vorgabe |
|--------|---------|
| **Scope** | Nur **derselbe Raum** (`user_session.current_url` nach Server-`trim`, gleiche Normalisierung wie heute). Keine globale Eindeutigkeit über alle URLs. |
| **Wunschname** | Vom Client in `join_room` (Profil-Eingabe). Validierung wie [message-content.md](message-content.md). |
| **Raum-Anzeigename** | Von **`join_room` berechnet**, in `user_session.username` gespeichert. |
| **Nachrichten** | `sender_name` = Raum-Anzeigename aus der Session des Senders zum Sendezeitpunkt (Snapshot, wie bei `sender_nick_color`). |
| **Identität** | Unverändert SpacetimeDB-`Identity`. Zwei „Kurt“ mit verschiedenen Identities sind technisch ok; diese Spec regelt nur die **sichtbare** Unterscheidung. |
| **Historie** | Umbenennung ändert **keine** alten `chat_message`-Zeilen. |

**Nicht Ziel:** Account-Namen, globale Reservierung, Moderation von „offensiven“ Namen.

---

## 2. Kollisionsregeln (Suffix)

### 2.1 Vergleich

- Zwei Anzeigenamen **kollidieren**, wenn sie nach **`trim` + `normalize_allowed_text`** (wie Server heute) **case-insensitive** gleich sind (`Kurt` = `kurt`).
- Gespeichert wird die **Schreibweise des jeweiligen Nutzers** zum Zeitpunkt der Zuweisung (Wunschname nach Normalisierung), nicht erzwungenes Lowercase.

### 2.2 Zuweisung in `join_room`

Eingabe: Wunschname `W` (normalisiert, 2–13 Zeichen), Raum-URL `U`, Sender `ctx.sender`.

1. Alle `user_session` mit `current_url == U` und `identity != ctx.sender` laden (Presence-Menge des Raums).
2. Belegte Anzeigenamen = deren `username` (case-insensitive Set).
3. Wenn `W` (case-insensitive) **nicht** belegt → Raum-Anzeigename = `W`.
4. Sonst → Suffix vergeben: kleinstes `n ≥ 2`, sodass `W` + Dezimalziffern(`n`) **ohne Leerzeichen** (z. B. `Kurt2`, `Kurt3`) case-insensitive **frei** ist.
5. **Kein** serverseitiges „Abziehen“ von Ziffern am Ende von `W` (Nutzer „Kurt2“ ist ein gültiger Wunschname, kein Auto-Suffix).
6. Session upserten: `current_url`, `username` = zugewiesener Raum-Anzeigename, `nick_color`, `joined_at`.

**Beispiele (Raum hat nur diese Sessions):**

| Bereits im Raum | Wunsch (neu) | Raum-Anzeigename |
|-----------------|--------------|------------------|
| — | Kurt | Kurt |
| Kurt | Kurt | Kurt2 |
| Kurt, Kurt2 | Kurt | Kurt3 |
| Kurt2 allein (Kurt weg) | Kurt | Kurt |

### 2.3 Umbenennen & erneuter Versuch

- Jeder `join_room`-Aufruf (URL-Wechsel, Profil-Sync, Farbwechsel) **berechnet den Anzeigenamen neu** aus aktuellem `W` und aktueller Presence.
- Wunsch wieder `Kurt`, während ein **anderer** noch `Kurt` hat → Zuweisung `Kurt2` (oder nächstes freies `n`), **ohne** Fehlermeldung (still wie Rate-Limit).
- Eigene vorherige Session-Zeile zählt nicht als „fremd belegt“ (Schritt 2 schließt `ctx.sender` aus).

### 2.4 Raum verlassen

- `leave_room` / Disconnect entfernt die Session. Der Anzeigename **gibt den Slot frei** (case-insensitive).
- Wer danach `Kurt` wünscht und `Kurt` frei ist, erhält **`Kurt`** (kein dauerhaftes „einmal Kurt2, immer Kurt2“).

### 2.5 Länge 13 Zeichen

- Zuweisung muss `chars().count() ≤ 13` erfüllen ([message-content.md](message-content.md)).
- Algorithmus: `candidate = W + format!(n)`; wenn zu lang, **Ende von `W` kürzen** (Unicode-scalar), bis `candidate` passt; mindestens **1** Zeichen Basis vor Suffix. Suffix `n` bleibt vollständig (`10` nicht abschneiden).
- Wenn auch mit 1-Zeichen-Basis kein Platz (extrem: `n` sehr groß), `join_room` **abbrechen** (noop), Extension zeigt keinen neuen Raum-Namen.

---

## 3. `send_message`

| Punkt | Vorgabe |
|-------|---------|
| **Parameter `username`** | Vom Client **ignoriert** (Abwärtskompatibilität: Parameter bleibt in der Signatur). |
| **`sender_name`** | `user_session.username` für `ctx.sender`. |
| **Keine Session** | Kein Insert (noop). |
| **URL** | Wie heute: Client-`url` muss zum Raum passen; optional später Session-URL erzwingen (Backlog). |

Damit ist Impersonation („als Kurt senden, obwohl Session Kurt2“) nicht möglich.

---

## 4. Extension (Client)

| Ort | Verhalten |
|-----|-----------|
| **Profil (`userProfile.username`)** | Bleibt der **Wunschname** (2–13 Zeichen, lokal persistiert). |
| **Pseudonym-Eingabe (Settings)** | Zeigt bei Verbindung und eigener Session den **Raum-Anzeigenamen** (`user_session.username`, z. B. `Kurt2`); sonst den Wunschnamen. Bearbeiten aktualisiert den Wunschnamen und triggert `join_room`. Kein leeres Feld, keine 1-Zeichen-Namen. |
| **`join_room`** | Sendet Wunschname + `nick_color` bei URL-Wechsel, Profil- oder Farbänderung (wie heute). |
| **Raum-Anzeigename** | Aus **eigener** `user_session`-Zeile (Subscription), Feld `username`. |
| **Chat-Liste** | Weiterhin `msg.senderName` (bereits disambiguiert). |
| **„Eigene“ Blase / Löschen** | UI: `messageIsMine`; Server: nur `sender_identity` ([delete-messages.md](delete-messages.md)). |
| **`send_message`** | Kann Wunschnamen mitschicken; Server nutzt nur Session. |

**FAQ / Info-Text (später):** Kollisionen nur pro Seite/Raum; Wunschname lokal, Anzeige im Raum kann Suffix haben.

---

## 5. Server & Performance

- Kollisionsprüfung = Scan der Sessions mit gleicher `current_url` (typisch wenige Zeilen). Kein Index-Pflicht für MVP; bei Wachstum B-Tree auf `current_url` ([server-query-patterns.md](server-query-patterns.md)).
- **Unit-Tests (Rust):** Zuweiselogik isoliert (frei, Kurt/Kurt2, Freigabe nach Leave, Längenkürzung, Case-Insensitivity).

Deploy: `spacetime publish` + `npm run codegen:stdb` wie [nickname-appearance.md](nickname-appearance.md).

---

## 6. Abnahme (kurz)

1. Zwei Identities, gleicher Raum, beide Wunsch „Kurt“ → Anzeige `Kurt` / `Kurt2`; Nachrichten zeigen dieselben Namen.
2. Zweiter ändert Wunsch auf „Kurt“ erneut → bleibt `Kurt2`, solange erster `Kurt` online ist.
3. Erster verlässt Raum → zweiter `join_room` mit Wunsch „Kurt“ (z. B. durch Pseudonym-, URL- oder Farb-Sync) → Anzeige `Kurt`.
4. `send_message` mit manipuliertem `username` → `sender_name` trotzdem aus Session.
5. Wunsch „Kurt2“ bei freiem Namen → Anzeige `Kurt2` (kein Umschreiben zu `Kurt`).
