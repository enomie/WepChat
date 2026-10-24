# Nachrichten-Alter im Chat (relatives Zeitlabel)

Spezifikation für ein **dezent sichtbares „wann“** neben dem Pseudonym in jeder Chat-Bubble im **Sidepanel** ([`extension/src/App.svelte`](../../extension/src/App.svelte)).

**Status:** Implementiert. Code: [`message-age-label.ts`](../../extension/src/lib/message-age-label.ts), [`App.svelte`](../../extension/src/App.svelte). Tests: `cd extension && npm run test:unit`.

Verwandt: [general.md](general.md), [internationalization.md](internationalization.md), [message-history-pagination.md](message-history-pagination.md), [security-list.md §6](security-list.md#6-nachrichten-retention-72-stunden) (max. 72 h Lebensdauer, grob 0–2 Tage im Label), [nickname-appearance.md](nickname-appearance.md) (Pseudonym-Farbe bleibt dominant).

---

## 1. Ziel & UX

| Aspekt | Vorgabe |
|--------|---------|
| **Zweck** | Orientierung in aktiven Räumen: *Wie alt ist diese Nachricht?* ohne die Bubble zu dominieren |
| **Platzierung** | **Eine Meta-Zeile** über dem Nachrichtentext: Pseudonym links, Zeitlabel rechts daneben (gleiche Zeile, `flex`, bei Bedarf umbrechen) |
| **Hierarchie** | Pseudonym: bestehende Nick-Farbe (`.sender`). Zeit: **kleiner, normalgewichtig, neutral grau** (nicht Nick-Farbe) |
| **Schwellwert** | **0 bis unter 1 Minute:** festes Kurzlabel **„Gerade eben“** (UI-Locale). **Ab 1 Minute:** relatives Label (`Intl.RelativeTimeFormat`, erste Stufe typisch „vor 1 Minute“) |
| **Unter 1 Minute** | Immer **„Gerade eben“** (DE) bzw. **„Just now“** (EN), klein/grau wie alle Zeitlabels |

**Beispiel (&lt; 1 Min, DE-Locale):**

```text
Alice    Gerade eben
Hier steht der Nachrichtentext …
```

**Beispiel (≥ 1 Min, DE-Locale):**

```text
Alice    vor 10 Minuten
Hier steht der Nachrichtentext …
```

---

## 2. Fachliche Regeln

### 2.1 Datenquelle

- Feld **`created_at`** der Zeile `chat_message` (im Client: `createdAt`, SpacetimeDB `Timestamp`).
- **Keine Server-Änderung** nötig; keine neue Spalte, kein Reducer.
- Alter = Differenz zwischen **Client-Uhrzeit beim Rendern** und dem aus `createdAt` abgeleiteten Zeitpunkt.

### 2.2 Konstante

| Konstante | Wert |
|-----------|------|
| `MESSAGE_AGE_LABEL_JUST_NOW_MAX_MS` | `60_000` (1 Minute, obere Grenze für „Gerade eben“) |

**Warum 1 Min, nicht 2 Min:** Bei 2 Min „Gerade eben“ wäre das erste relative Label „vor 2 Minuten“, der Sprung wirkt zu groß. Mit 1 Min folgt sinnvoll **„vor 1 Minute“** (bzw. Locale-Variante von `Intl`).

Wenn `ageMs < MESSAGE_AGE_LABEL_JUST_NOW_MAX_MS` → Locale-Key **`messageAge.justNow`** (z. B. „Gerade eben“ / „Just now“).  
Wenn `ageMs >= MESSAGE_AGE_LABEL_JUST_NOW_MAX_MS` → **relative Zeit** (siehe §2.3).

### 2.3 Format (lokalisiert)

- **0 ≤ Alter &lt; 1 Min:** fester String aus dem Message-Katalog (`messageAge.justNow`), nicht `Intl` (konsistente Copy).
- **Alter ≥ 1 Min:** **relative Zeit** (nicht als feste Uhrzeit im MVP), passend zur UI-Locale (**de** / **en**, Fallback **en**, siehe [internationalization.md](internationalization.md)).
- Empfohlen ab Schwellwert: **`Intl.RelativeTimeFormat`** mit sinnvollen Einheiten (`minute`, `hour`, `day`), Locale aus bestehender Auflösung (`resolve-locale` / `t()`-Kontext).
- Oberes Ende durch Retention begrenzt: praktisch **bis etwa „vor 2 Tagen“** (72 h), keine Wochen-/Monats-Stufen nötig.
- **Chat-Inhalt** und **Pseudonyme** werden nicht übersetzt; nur das Zeitlabel folgt der UI-Sprache.

### 2.4 Eigene vs. fremde Nachrichten

- **Gleiche Regel** für alle Bubbles (inkl. `own`): immer Zeitlabel („Gerade eben“ oder relativ), gleiche Typografie.

### 2.5 Echtzeit & Verlauf

| Ereignis | Verhalten |
|----------|-----------|
| Neue Nachricht (`onInsert`) | Sofort **„Gerade eben“**; ab 1 Min Wechsel auf relatives Label (Tick oder Re-Render) |
| `onDelete` (Retention / später User-Delete) | Zeile weg, kein Sonderfall |
| „Ältere laden“ | Label für ältere Zeilen wie für neue, nach `created_at` |
| Raumwechsel | Labels neu aus `createdAt` der geladenen Nachrichten |

---

## 3. UI & Barrierefreiheit

### 3.1 Markup (Vorschlag)

```html
<div class="bubble-meta">
  <span class="sender">…</span>
  <time class="message-age" datetime="…">…</time>
</div>
<span class="text">…</span>
```

- `datetime`: ISO-8601 in UTC oder mit Offset, aus `createdAt` abgeleitet (für Screenreader und Inspektion).
- Kein Em-Dash in sichtbaren UI-Strings; Separator optional als Mittelpunkt `·` in CSS/`::before`, oder nur Abstand.

### 3.2 Styling (Richtwerte)

| Element | Vorgabe |
|---------|---------|
| `.message-age` | z. B. `font-size: 0.72rem`, `font-weight: 400`, Farbe neutral (`#94a3b8` o. Ä., nicht `--wepchat-green`) |
| `.bubble-meta` | `display: flex`, `align-items: baseline`, `gap` klein, `flex-wrap: wrap` |

Bestehende Bubble- und Nick-Styles aus [nickname-appearance.md](nickname-appearance.md) unverändert lassen, nur Meta-Zeile ergänzen.

---

## 4. Implementierung (Extension)

### 4.1 Modul

- Neues Hilfsmodul z. B. `extension/src/lib/message-age-label.ts`:
  - `timestampToDate(createdAt: Timestamp): Date` (SpacetimeDB-Timestamp einmal sauber dokumentieren/testen).
  - `formatMessageAgeLabel(createdAt, locale, now, justNowLabel): string` → `justNowLabel` wenn &lt; 1 Min, sonst `Intl`.
- Unit-Tests für Schwellwert, Grenzen (59 s → „just now“-Pfad, 60 s → relative Minute), und mindestens **de** + **en**.

### 4.2 Aktualisierung der relativen Texte

Relative Strings veralten („vor 10 Minuten“ → „vor 11 Minuten“).

- **Mindestanforderung:** zentraler **Tick** (z. B. alle **60 s**) im Sidepanel oder in einem kleinen Svelte-Store, der `now` für die sichtbaren Nachrichten fortschreibt, solange der Chat verbunden ist.
- Kein `setInterval` pro Nachricht.
- **Zusätzlich für „Gerade eben“:** Tick mindestens alle **30–60 s**, damit der Wechsel bei 1 Min ohne Nutzeraktion sichtbar wird (minütlicher Tick passt zum Übergang → „vor 1 Minute“).
- Optional später: feinerer Tick nur für junge Nachrichten (nicht MVP).

### 4.3 Integration

- [`App.svelte`](../../extension/src/App.svelte): in der `#each visibleMessages`-Schleife Meta-Zeile + bedingtes `<time>`.
- Locale: dieselbe wie für `t()` (Import aus `extension/src/lib/i18n/`).

### 4.4 Locales

- **`messageAge.justNow`** in `extension/src/locales/de.json` und `en.json` (Pflicht, gleiche Keys wie restliche UI).
- Ab 1 Min: **`Intl.RelativeTimeFormat`** (kein weiterer Katalog für Minuten/Stunden nötig).

---

## 5. Akzeptanzkriterien

- [x] Nachricht **jünger als 1 Minute**: **„Gerade eben“** / **„Just now“** klein/grau neben dem Pseudonym.
- [x] Nachricht **≥ 1 Minute**: relatives Label in **Browser-UI-Sprache** (de/en), erste Stufe sinnvoll (~1 Min), gleiche Typografie.
- [x] `created_at` kommt vom Server; kein zusätzlicher API-Roundtrip.
- [x] Labels aktualisieren sich ohne Reload (30 s-Tick), solange Sidepanel offen.
- [x] Eigene und fremde Bubbles verhalten sich gleich.
- [x] `npm run test:unit` in `extension/` inkl. Tests für Schwellwert und Format-Helfer.
- [x] Keine Em-Dashes in neuen UI-Strings; Satzzeichen-Regel [.cursor/rules/ui-copy-no-em-dash.mdc](../../.cursor/rules/ui-copy-no-em-dash.mdc).

---

## 6. Bewusst nicht Ziel (MVP)

- Absolute Uhrzeit („14:32“) oder Hybrid ab 24 h
- Zeitlabel bei Hover statt inline
- Wechselnde Formulierungen für &lt; 1 Min (z. B. „vor 30 Sekunden“ statt festem „Gerade eben“)
- Server-seitige Aggregation oder separater „last activity“-Endpoint
- Anzeige in Badge/Background (nur Sidepanel-Chat)

---

## 7. Testplan (manuell)

1. Nachricht senden: 0–59 s **„Gerade eben“**; ab ~60 s relatives Label (ggf. nach nächstem Tick), erwartbar „vor 1 Minute“.
2. Browser auf **de** vs. **en**: Formulierung der relativen Zeit passt (z. B. „vor …“ / „… ago“).
3. „Ältere laden“: ältere Bubbles zeigen grobe Labels („vor … Stunden“, „vor … Tagen“).
4. Schmales Sidepanel: Meta-Zeile bricht sauber um, Text der Nachricht unverändert lesbar.
