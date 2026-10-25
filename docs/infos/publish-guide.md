# WepChat: Release, Deploy und Store

Zentrale Anleitung für **SpacetimeDB-Deploy**, **Extension-Build/ZIP** und **Chrome Web Store**. Bei Deploy- oder Release-Fragen hier nachschlagen.

Verwandt: [spacetimedb.md](../kickoff/spacetimedb.md), [security.md](../requirements/security.md), [general.md](../requirements/general.md).

---

## Übersicht: Was wann wo

| Ziel | Ordner | Befehle (Kurz) |
|------|--------|----------------|
| **Nur Server-Logik live** | `server/` | `cargo test` → `spacetime publish wepchat -y` |
| **Server + neues Schema/Reducer-Signatur** | `server/` + `extension/` | Publish → `npm run codegen:stdb` → Extension neu laden/build |
| **Store-ZIP (Chrome + Firefox)** | `extension/` | Version bump → `npm run publish` |
| **Nur Chrome-ZIP** | `extension/` | `npm run publish:chrome` |
| **Nur Firefox-ZIP** | `extension/` | `npm run publish:firefox` |
| **Lokale Extension ohne ZIP** | `extension/` | `npm run check` → `npm run build` → in `chrome://extensions` neu laden |
| **Entpackt aus `.output/chrome-mv3`** | `extension/` | Nach **jeder** Änderung unter `extension/src/`: `npm run build` (schreibt `.output/chrome-mv3`), dann Extension **Aktualisieren** |

**Live-Backend:** Modul `wepchat` auf `maincloud.spacetimedb.com` (Client: `extension/src/lib/spacetime.svelte.ts`). Dashboard: https://spacetimedb.com/wepchat

---

## 1. SpacetimeDB CLI

**Installation (einmalig):** https://spacetimedb.com/install (macOS/Linux: Install-Script aus [spacetimedb.md](../kickoff/spacetimedb.md)).

**Login (einmalig, nur Entwickler, nicht in der Extension):**

```bash
spacetime login
```

Falls `spacetime` im Terminal nicht gefunden wird (z. B. nur unter `~/.local/bin`):

```bash
export PATH="$HOME/.local/bin:$PATH"
# oder vollständiger Pfad:
~/.local/bin/spacetime publish wepchat -y
```

---

## 2. Backend deployen (`server/`)

Immer **vor** einem Store-Release, wenn `server/src/lib.rs` (oder Server-Abhängigkeiten) geändert wurden. Auch für **nur Logik** ohne Schema-Änderung (z. B. Raum-Pseudonyme, Rate-Limit).

```bash
cd server
cargo test
spacetime publish wepchat -y
```

- `-y` überspringt die Bestätigung für Maincloud.
- Optional: `wasm-opt` installieren (Binaryen) für kleinere WASM-Module, Publish funktioniert auch ohne.
- Nach **reinem Logik-Deploy:** Extension-Clients brauchen **kein** neues ZIP, Sidepanel/Extension einmal neu laden reicht.

### Wann `codegen:stdb` in der Extension?

| Server-Änderung | `npm run codegen:stdb` nötig? |
|-----------------|--------------------------------|
| Nur Reducer-**Logik** (gleiche Tabellen, gleiche Reducer-Namen/Args) | **Nein** |
| Neue/geänderte **Tabellen**, **Reducer-Namen** oder **Argument-Typen** | **Ja** |

```bash
cd extension
npm run codegen:stdb
```

(`codegen:stdb` = `spacetime generate --module-path ../server` + `scripts/patch-spacetimedb-codegen.js`, siehe [learnings.md](../learnings.md).)

Danach: `npm run build` (oder `publish:chrome`) und Extension neu laden.

---

## 3. Extension qualitätssichern und bauen (`extension/`)

### Empfohlene Reihenfolge (lokal / vor Release)

```bash
cd extension
npm run test:unit
npm run check:locales
npm run check          # svelte-check (TypeScript + Svelte)
npm run build          # Chrome: Ordner + ZIP (Alias für build:chrome)
npm run build:all      # Chrome + Firefox, jeweils Ordner + ZIP
```

### Store-Pakete (alles in einem)

```bash
npm run publish
```

Führt aus: Unit-Tests, Locale-Check, `icons:generate`, Production-Build für **Chrome und Firefox**, jeweils Ordner + ZIP.

Nur ein Browser:

```bash
npm run publish:chrome
npm run publish:firefox
```

**Artefakte:**

| Browser | Entpackt testen | Upload-ZIP |
|---------|-----------------|------------|
| Chrome | `extension/.output/chrome-mv3/` | `extension/.output/chrome-mv3.zip` |
| Firefox | `extension/.output/firefox-mv2/` | `extension/.output/firefox-mv2.zip` (gleicher Inhalt als `firefox-mv2.xpi` für AMO) |

### Firefox lokal testen (Signatur!)

**Normales Firefox** installiert nur **von Mozilla signierte** Add-ons dauerhaft. Unser lokales `firefox-mv2.xpi` / `.zip` ist **nicht signiert**. „Aus Datei installieren“ oder ein XPI führt dann zu **not verified** / nicht verifiziert. Das ist erwartet, kein Build-Fehler.

**So testest du die Extension lokal (empfohlen):**

1. `about:debugging` in die Adresszeile
2. Links **„Dieses Firefox“** (This Firefox)
3. **„Temporäres Add-on laden…“**
4. Datei: `extension/.output/firefox-mv2/manifest.json` (Ordner entpackt, **kein** ZIP)

Das Add-on läuft bis du Firefox **komplett beendest** (nicht nur ein Fenster). Nach Neustart Schritt 1–4 wiederholen.

**Nicht** für lokalen Test: `about:addons` → Add-on aus Datei → `.xpi` (braucht AMO-Signatur).

**Dauerhaft / wie Endnutzer:** Einreichung bei [addons.mozilla.org](https://addons.mozilla.org/) (AMO). Nach Review liefert Mozilla ein signiertes Paket; `firefox-mv2.zip` oder `.xpi` dort hochladen.

**Nur Entwicklung (optional, auf eigenes Risiko):** In `about:config` `xpinstall.signatures.required` auf `false` setzen, dann ist „Aus Datei installieren“ möglich. Besser: temporäres Laden wie oben oder AMO **Unlisted**-Signierung für Tester.

**Version vor jedem Store-Upload** in beiden Dateien gleich setzen:

- `extension/package.json` → `version`
- `extension/wxt.config.ts` → `manifest` Callback → `version`

Dann `npm run publish` (oder nur `publish:chrome` / `publish:firefox`) erneut.

---

## 4. Typischer Gesamt-Workflow (Server + Extension geändert)

```bash
cd server && cargo test && spacetime publish wepchat -y
cd ../extension
# nur bei Schema/Reducer-API-Änderung:
# npm run codegen:stdb
npm run test:unit && npm run check:locales && npm run check
npm run publish
```

---

## 5. Chrome Web Store Dashboard

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (einmalige Registrierungsgebühr).
2. **Neues Element** oder bestehendes Item → **Paket** → ZIP hochladen (`extension/.output/chrome-mv3.zip`).
3. **Store-Eintrag** (DE/EN nach Bedarf):
   - **Name:** WepChat (Manifest: `_locales` `extName`)
   - **Kurzbeschreibung:** aus `extDescription` in `extension/public/_locales/`
   - **Ausführliche Beschreibung:** siehe [README.md](../../README.md)
   - **Kategorie:** z. B. Sozial & Kommunikation
   - **Symbol:** `extension/public/icon/128.png` (oder 96)
   - **Screenshots:** Side Panel mit Chat + Presence (mindestens 1, empfohlen 1280×800 oder 640×400)
4. **Datenschutz**
   - Datenschutz-URL (z. B. Landingpage `web/`, sobald live)
   - **Einzelzweck:** Echtzeit-Chat und Anwesenheit pro Seiten-URL
   - **Berechtigungen** kurz begründen:
     - `sidePanel`: Chat-UI in der Seitenleiste
     - `tabs` / `activeTab`: aktuelle URL für Raum und Live-Badge
     - `storage`: Pseudonym und Profil lokal
5. **Verteilung:** Öffentlich oder eingeschränkt (Tester-Liste).
6. Zur Prüfung einreichen (Review dauert typischerweise einige Tage).

---

## 6. Nach dem Release

- Extension aus dem Store (oder Tester-Link) testen, nicht nur „Entpackt“.
- Ablehnung: Grund im Dashboard lesen, fixen, Version erhöhen, neues ZIP.
- Kontakt: wepchat@proton.me ([general.md](../requirements/general.md)).

---

## 7. Optional: CLI-Upload Store

WXT: `npx wxt-publish-extension` (Chrome-API-Credentials + Item-ID). Erster Release meist manuell per ZIP.

---

## Checkliste

**Nur Backend live:**

- [ ] `cd server && cargo test`
- [ ] `spacetime publish wepchat -y`
- [ ] Bei Schema/API-Änderung: `cd extension && npm run codegen:stdb`
- [ ] Extension neu laden oder neu bauen

**Store-Einreichung:**

- [ ] `server/` deploy (falls geändert)
- [ ] `codegen:stdb` (falls Tabellen/Reducer-API geändert)
- [ ] Version in `package.json` und `wxt.config.ts`
- [ ] `npm run publish` grün (inkl. tests + locales + icons + Chrome + Firefox ZIP)
- [ ] Optional vorher: `npm run check` (svelte-check)
- [ ] Icons aktuell (`public/icon/logo.svg` → via `icons:generate` in publish:chrome)
- [ ] Datenschutz-URL erreichbar
- [ ] Screenshots und Store-Texte fertig
