# Internationalisierung (i18n) & Lokalisierung (l10n)

Die Extension soll für Nutzer weltweit nutzbar sein: **UI-Texte** folgen der Browsersprache, mit **Englisch als Fallback**. **Quellcode und Code-Kommentare** bleiben **Englisch**. **Requirements- und Projekt-Docs** dürfen weiterhin **Deutsch** (oder gemischt) sein.

Verwandte Docs:

- [general.md](general.md), Plattform, Profil, Pseudonym
- [message-content.md](message-content.md), erlaubte Zeichen in Chat-Nachrichten (unabhängig von UI-Sprache)

---

## 1. Ziel & Abgrenzung

| Bereich | Sprache / Verhalten |
|--------|---------------------|
| **Extension-UI** (Sidepanel, Badges, Tooltips, `aria-label`, Platzhalter) | Nutzersprache des Browsers, Fallback **en** |
| **Mitgelieferte Locales (MVP)** | Mindestens **de** und **en**; weitere Sprachen später ohne Architektur-Bruch |
| **TypeScript / Rust / Config** | **Englisch** (Bezeichner, Logs für Entwickler, Kommentare) |
| **Docs unter `docs/`** | Deutsch (oder EN), kein Muss zur UI-Sprache |
| **User-Chat-Nachrichten** | **Nicht** übersetzen, Inhalt bleibt, wie der User tippt |
| **Pseudonyme, URLs, Identity-Hex** | **Nicht** lokalisieren |
| **Server-Reducer-Fehler** | Keine nutzerlesbaren Fehlertexte an den Client (bestehendes Muster); UI erklärt Zustände lokal |

**Warum Browser-Sprache?** Kein zusätzliches Profil-Feld nötig; Verhalten entspricht Erwartung bei anderen Extensions. Optional später: manuelle Sprachwahl in den Einstellungen (Override).

**Satzzeichen in UI- und Nutzertexten:** Kein Gedankenstrich (`—`). Nur Komma oder Punkt. Projektregel: [.cursor/rules/ui-copy-no-em-dash.mdc](../../.cursor/rules/ui-copy-no-em-dash.mdc).

---

## 2. Ist-Zustand

- UI-Strings sind **fest im Svelte-Markup** eingebettet, überwiegend **Deutsch** (z. B. `App.svelte`: „Verbinde…“, „Raum:“, Info-Panel).
- Kein zentrales Message-Katalog, keine Locale-Auflösung.
- `wxt.config` / Manifest: keine `_locales` für Name/Beschreibung der Extension (Follow-up für Store-Listing).

---

## 3. Locale-Auflösung

### 3.1 Priorität (MVP)

1. **Primär:** `navigator.languages` (bzw. `navigator.language`) in der Extension-UI, erste unterstützte Locale gewinnen.
2. **Fallback:** `en`, wenn keine passende Locale geliefert wird oder Übersetzung fehlt.
3. **Normalisierung:** `de-DE` → `de`, `en-US` → `en`; nur **Sprach-**Tags (kein Region-Mixing für MVP), außer wir liefern explizit `pt-BR` o. Ä.

### 3.2 Unterstützte Locales (MVP)

| Locale | Pflicht |
|--------|---------|
| `en` | Ja (Default-Fallback, vollständiger Katalog) |
| `de` | Ja (vollständiger Katalog) |

Weitere Locales: gleiche Schlüssel wie `en`; fehlende Keys fallen auf `en` zurück (siehe §4.3).

### 3.3 Optional (nach MVP)

- Einstellung **„Sprache“** in der Extension: `auto` \| `de` \| `en` \| … in `chrome.storage.local`.
- Bei `auto`: wie §3.1; sonst feste Locale.

---

## 4. Extension, technische Anforderungen

### 4.1 Message-Katalog

- Alle **nutzer sichtbaren** Strings aus Komponenten in einen **Katalog** auslagern (z. B. `extension/src/locales/en.json`, `de.json`).
- Zugriff über eine kleine Hilfsfunktion, z. B. `t('status.connecting')`, Implementierung (eigenes Modul vs. Bibliothek) ist Team-Entscheidung; Anforderung ist **eine** API im gesamten UI-Code.
- **Keine** String-Konkatenation für ganze Sätze mit variabler Wortstellung über Sprachen hinweg, stattdessen **parameterisierte** Messages (siehe Pluralisierung).

### 4.2 Pluralisierung & Parameter

Beispiele aus dem Ist-Zustand, die **sprachspezifische** Regeln brauchen:

- Online-Count: EN „1 person online“ / „N people online“; DE „1 Person online“ / „N Personen online“.
- Rate-Limit-Hinweis mit Zahlen.

Empfehlung: ICU-Message-Format (`{count, plural, ...}`) oder äquivalente Plural-API, muss für **de** und **en** korrekt sein.

### 4.3 Fallback-Kette

Pro Key: **aktive Locale** → **en** → Key als letzter Notfall (nur Dev; in Produktion sollte `en` immer den Key haben).

### 4.4 Abdeckung (Checkliste UI)

Mindestens zu übersetzen (Stand Referenz `App.svelte`):

- Verbindungsstatus, Fehlerzustände
- Header-Buttons (`title`, `aria-label`, `aria-expanded` bleibt bool)
- Raum-Leiste, leere Zustände, Lade-Buttons
- Info- & Profil-Panel
- Eingabe-Platzhalter, Senden-Button, Rate-Limit-Text
- Später: Löschen-Bestätigung, Pagination, sobald die Features live sind, **gleicher** Katalog

**Nicht** übersetzen: `console.*` für Entwickler (Englisch); optional einheitlich Englisch lassen.

### 4.5 Manifest & Store (Phase 1b)

Für Chrome/Firefox-Listing:

- `_locales/<lang>/messages.json` für `name`, `description`, `action`, mindestens `en` und `de`, Fallback `default_locale`: `en`.

Sidepanel-Verhalten unabhängig davon; UI-Katalog kann dieselben Texte wiederverwenden oder getrennt pflegen.

### 4.6 RTL & Typografie

- MVP: **LTR** reicht; Layout darf bei späterem Arabisch/Hebräisch nicht brechen (keine festen `left` nur für Textlogik).
- Schrift: System-UI-Font; keine Annahme „nur Latin“ für **UI**-Strings (Keys können Umlaute enthalten).

---

## 5. Server (SpacetimeDB)

- Reducer und Tabellen: **keine** mehrsprachigen Fehlermeldungen in der DB.
- Validierung (z. B. [message-content.md](message-content.md)): Verhalten sprachneutral; wenn die Extension Fehler anzeigen muss, **lokale** UI-Texte + ggf. Fehlercodes (später), nicht deutscher Server-String.

---

## 6. Qualität & Prozess

| Thema | Anforderung |
|-------|-------------|
| **Vollständigkeit** | Jeder neue UI-String: Key in **en** und **de** im selben PR |
| **Review** | Native oder vertrauenswürdige Quelle für `de`; `en` als Referenz für weitere Sprachen |
| **Tests** | Mindestens Unit-Tests für Locale-Auflösung und Fallback; optional Snapshot pro Locale für kritische Strings |
| **CI** | Optional: Script prüft, dass `de.json` und `en.json` dieselben Keys haben |

---

## 7. Akzeptanzkriterien (MVP)

1. Browser auf **Deutsch** (`de` / `de-DE`): gesamte Sidepanel-UI auf Deutsch.
2. Browser auf **Englisch** oder **nicht unterstützte** Sprache (z. B. `fr`): UI auf **Englisch**.
3. Keine hardcodierten nutzersichtbaren UI-Strings mehr in Svelte/TS (außer Katalog-Dateien).
4. Code-Review: neue Kommentare und Identifier auf Englisch.
5. Chat-Inhalt anderer User erscheint unverändert; Pseudonym/URL nicht lokalisiert.

---

## 8. Implementierungs-Reihenfolge (Vorschlag)

1. Locale-Resolver + `t()` + `en.json` / `de.json` aus bestehendem `App.svelte` extrahieren.
2. Plural-Helfer für Online-Count (und Rate-Limit).
3. Restliche Extension-Entrypoints (Background nur falls nutzer sichtbar).
4. `_locales` für Manifest / Store-Texte.
5. Optional: Sprach-Override in Profil-Einstellungen.

---

## 9. Offene Punkte

- Bibliothek: lightweight eigenes Modul vs. z. B. `@formatjs/intl`, Entscheidung bei Implementierung (Bundle-Größe Extension beachten).
- Datums-/Zeitformat in Nachrichten (falls später Timestamps in UI): `Intl.DateTimeFormat` mit aktiver Locale.
- Landingpage (PHP): eigene i18n-Strategie, nicht Teil dieses MVP.
