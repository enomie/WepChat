# Nachrichten-Inhalt: erlaubte Zeichen

Spezifikation für **Chat-Text** (Sidepanel-Eingabe und `send_message`). Ziel: ruhiger, lesbarer Austausch ohne Links, Sonderzeichen-Spam oder Copy-Paste-Müll — **ohne** dem Nutzer beim Tippen Fehlermeldungen an die Nase zu halten.

Verwandt: [security-list.md](security-list.md) (Umsetzungsreihenfolge), [ideas.md](../kickoff/ideas.md) (Ursprungsidee), [security.md](security.md) (Threat Model — Client-Regeln sind umgehbar).

**Status:** Implementiert — [message-text-policy.ts](../../extension/src/lib/message-text-policy.ts), [App.svelte](../../extension/src/App.svelte), [server/src/lib.rs](../../server/src/lib.rs) (`send_message`, `join_room`).

---

## 1. Ziel & UX

| Aspekt | Vorgabe |
|--------|---------|
| **Gefühl beim Tippen** | Verbotene Zeichen **erscheinen nicht** im Eingabefeld (kein roter Fehlertext nötig). |
| **Einfügen (Paste)** | Gleiche Filterung — nach Paste sieht der Nutzer nur den erlaubten Rest. |
| **Senden** | Nur nicht-leerer Text nach `trim()`; vor dem Reducer-Aufruf nochmal filtern. |
| **Server** | Gleiche Regel; bei Verstoß **kein Insert** (still, wie Rate-Limit). |
| **Anzeige** | Bereits gespeicherte Nachrichten werden unverändert angezeigt; Filter gilt für **neue** Eingaben. |

Keine URLs, keine `@`, keine `#`, keine Emojis, keine Steuerzeichen — alles fällt unter „nicht erlaubt“. **Link- und Domain-Spam** wird bewusst über diese Whitelist gelöst, nicht über einen separaten Link-Detector (siehe [§8](#8-links-domains-kein-link-regex)).

---

## 2. Erlaubtes Zeichenset

Eine Nachricht besteht aus **einer oder mehreren** erlaubten Zeichen. Zwischen Wörtern: **Leerzeichen** (normales U+0020).

### 2.1 Buchstaben

- ASCII: `A`–`Z`, `a`–`z`
- Deutsch: `Ä`, `Ö`, `Ü`, `ä`, `ö`, `ü`, `ß`

Keine weiteren Unicode-Buchstaben (kein é, ø, кириллица, …) — bewusst eng, später erweiterbar.

### 2.2 Ziffern

- `0`–`9`

### 2.3 Satzzeichen (nur diese drei)

| Zeichen | Name |
|---------|------|
| `,` | Komma |
| `.` | Punkt |
| `-` | Bindestrich |

**Nicht** erlaubt (Abgrenzung zu älterer Idee in ideas.md): `!` `?` `'` `"` `:` `;` `/` `\` `(` `)` …

### 2.4 Leerzeichen

- Einzelnes Leerzeichen ` ` zwischen Wörtern erlaubt.
- **Am Rand:** beim Senden `trim()` — führende/trailing Spaces entfernen.
- **Mehrfach-Leerzeichen** in der Mitte: beim Senden optional auf ein Leerzeichen kollabieren (empfohlen, Server + Client gleich).

### 2.5 Kurzreferenz (Implementierung)

**TypeScript** (Vorschlag, eine Quelle `message-text-policy.ts`):

```ts
// Erlaubt: ASCII letters, deutsche Umlaute, Ziffern, Leerzeichen, , . -
const ALLOWED_CHAR =
  /^[A-Za-z0-9\u00C4\u00D6\u00DC\u00E4\u00F6\u00FC\u00DF ,.\-]*$/;

export function filterMessageInput(value: string): string {
  return value.replace(/[^A-Za-z0-9\u00C4\u00D6\u00DC\u00E4\u00F6\u00FC\u00DF ,.\-]/g, '');
}
```

**Rust** (Vorschlag, `fn char_allowed(c: char) -> bool`):

- `c.is_ascii_alphanumeric()` **oder**
- `c` in `['Ä','Ö','Ü','ä','ö','ü','ß']` **oder**
- `c` in `[' ', ',', '.', '-']`

`send_message`: `clean_text.chars().all(char_allowed)` — sonst `return`.

---

## 3. Geltungsbereich

| Feld | Diese Spec (v1) | Anmerkung |
|------|-----------------|-----------|
| **Chat-Nachricht** (`text` in `send_message`) | **Ja** | Hauptfall |
| **Pseudonym** (`username` in `join_room` / Anzeige) | **Ja** (gleiche Regel) | [profile.svelte.ts](../../extension/src/lib/profile.svelte.ts); Default `Anon` + Ziffern |
| **URL-Raum** (`url`) | **Nein** | Bleibt URL-Validierung / `cleanUrl` — separates Thema |

---

## 4. Extension

### 4.1 Modul

- Datei: `extension/src/lib/message-text-policy.ts`
- Export: `filterMessageInput`, optional `isMessageTextAllowed` (ganzer String nach Filter === Eingabe)

### 4.2 UI (`App.svelte`)

- Chat-`<input>`: bei `oninput` (und ggf. `onpaste` mit `requestAnimationFrame`) `newMessage = filterMessageInput(...)`.
- `handleSend`: `const text = filterMessageInput(newMessage).trim()`; ggf. Whitespace kollabieren; wenn leer → return.
- `spacetimeChat.sendMessage` nur mit gefiltertem Text.

### 4.3 Nicht Ziel

- Kein `pattern=` am HTML-Input allein (unzureichend für Paste und Umlaute-Konsistenz).
- Keine Server-Ersetzung („Säubern“ von Müll-Text) — nur **ablehnen**.

---

## 5. Server (`server/src/lib.rs`)

In `send_message`, **nach** `trim`, **vor** Rate-Limit und `insert`:

1. Wenn `clean_text.is_empty()` → `return` (bereits heute).
2. Wenn nicht `chars().all(char_allowed)` → `return`.
3. Optional: interne Mehrfach-Leerzeichen normalisieren (ein Pass), dann erneut `trim` / leer prüfen.

Angreifer ohne Extension können den Reducer trotzdem aufrufen — deshalb ist Schritt 2 Pflicht.

---

## 6. Akzeptanzkriterien

- [x] Tippen von `/`, `@`, `!`, Emoji: Zeichen erscheint **nicht** im Feld.
- [x] `Hallo Welt`, `Grüße, Max.`, `Test-123` sind sendbar.
- [x] Paste mit gemischtem Text: nur erlaubte Zeichen bleiben.
- [x] Server: `send_message` mit verbotenem Zeichen erzeugt **keine** neue `chat_message`-Zeile.
- [x] Regeln in TS und Rust **semantisch gleich** (gleiche Testbeispiele).

### 6.1 Testideen (manuell)

1. `abc` → OK  
2. `https://evil.com` → Client: kein `/`/`:` sichtbar; Server: kein Insert wenn roh gesendet  
3. `Schöner Tag.` → OK (Umlaut + Punkt)  
4. Leer / nur Spaces nach trim → kein Send  

---

## 7. Dokumenten-Links

- [security-list.md](security-list.md) — Punkt 4 erledigt; Link-Regex siehe [§7 Bewusst nicht Ziel](security-list.md#7-bewusst-nicht-ziel)  
- [learnings.md](../learnings.md) §9 — Gotchas (kein Filter in `$derived`)  
- [security.md](security.md) — Roadmap Inhaltsregeln  

---

## 8. Links & Domains (kein Link-Regex)

### 8.1 Typische Maßnahme (nicht unser Ansatz)

In vielen Chats wird **Link-Spam** (Affiliate, Phishing, URL-Flooding) mit Regeln wie diesen adressiert:

| Variante | Idee | Aufwand (grob) |
|----------|------|----------------|
| Links verbieten | Regex erkennt `http://`, `https://`, `www.` … | gering (Reducer/Client) |
| **Max. 1 Link pro Nachricht** | Zählen erkannter URLs, Rest ablehnen | gering |

Das setzt eine **URL-Erkennung** voraus (Regex, Parser, Homoglyphen, `hxxp`, Punycode, …) und muss laufend gepflegt werden.

### 8.2 WepChat: Whitelist statt Link-Detector

Wir lösen das **über den Zeichenfilter** ([§2](#2-erlaubtes-zeichenset)) — **kein** eigenes Link-Modul, **kein** „max. 1 Link“-Zähler.

Für klassische URLs fehlen in Nachrichten die **Pflichtzeichen**:

| Zeichen | Rolle | In Chat-Text erlaubt? |
|---------|--------|------------------------|
| `:` | Schema (`https:`) | **Nein** |
| `/` | Pfade (`//host/path`) | **Nein** |
| `\` | Windows-Pfade, Escapes | **Nein** |
| `@` | E-Mail, Mentions | **Nein** |
| `#` | Fragment, Hashtags | **Nein** |

Erlaubt bleiben u. a. Buchstaben, Ziffern, Leerzeichen, `,` `.` `-`. Damit lassen sich **keine** klickbaren `http(s)://…`-URLs und **keine** normalen Pfad-URLs in einer Nachricht formulieren.

- **Client:** Verbotene Zeichen **erscheinen nicht** (`filterMessageInput` in [message-text-policy.ts](../../extension/src/lib/message-text-policy.ts)) — effektiv „entfernt“ beim Tippen/Paste, nicht als Fehlermeldung.
- **Server:** Enthält der Text nach `trim` ein verbotenes Zeichen → **kein Insert** (`char_allowed` in [lib.rs](../../server/src/lib.rs)); der Server **stripped** fremde Payloads nicht.

### 8.3 Abgrenzung & Grenzen

| Thema | Verhalten |
|-------|-----------|
| **Raum-URL** (`url` in `send_message`) | **Nicht** diese Spec — normale URL des Tabs / `cleanUrl()`; Chat-Text ≠ Raum-Adresse. |
| **„example.com“ als Klartext** | Punkt `.` ist erlaubt, aber ohne `:` und `/` kein klassischer Link; Nutzer können Domänen **nicht** als URL posten. |
| **Umgehung** | Reducer ohne Extension: nur Strings **ohne** verbotene Zeichen sind gültig — kein Bypass über „versteckte“ URLs im Text. |
| **Bewusst nicht** | Keine Regex-Liste für TLDs, keine Link-Zählung, kein Markdown/HTML-Rendering mit Auto-Link. |

Spätere Erweiterungen (z. B. erlaubtes `?` nur in kontrollierten Mustern) wären eine **neue** Policy-Version — bis dahin gilt: **Link-Schutz = Teil der reinen Textnachrichten-Policy**.
