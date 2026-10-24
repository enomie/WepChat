# Nickname & Erscheinungsbild

Spezifikation für **eine Palettenfarbe** pro Profil: farbiger Pseudonym-Text und abgetönter Bubble-Hintergrund, sichtbar für alle im Raum.

---

## 1. Farbpalette (9 feste Farben)

Nutzer wählen **eine** Farbe aus dieser Liste (kein freier Hex-Picker). IDs sind stabil für Schema, API und UI.

| ID | Key | Name (DE) | Hex |
| --- | --- | --- | --- |
| 1 | `blue` | Blau | `#014D9E` |
| 2 | `red` | Rot | `#9E0F23` |
| 3 | `orange` | Orange | `#DF6F04` |
| 4 | `yellow` | Gelb | `#D9A406` |
| 5 | `green` | Grün | `#167849` |
| 6 | `violet` | Violett | `#613AA9` |
| 7 | `pink` | Pink | `#BC2D74` |
| 8 | `brown` | Braun | `#7D5127` |
| 9 | `turquoise` | Türkis | `#1CB185` |

**Validierung:** Server und Client akzeptieren nur `1…9`; ungültige Werte werden zu **`1` (`blue`)** normalisiert.

Client-Quelle: `extension/src/lib/nick-colors.ts`.

---

## 2. Datenmodell & Sync

| Ort | Feld | Bedeutung |
| --- | --- | --- |
| `chrome.storage.local` (`userProfile`) | `nickColorId` | Lokale Wahl des Nutzers (Default `1`). |
| `user_session` | `nick_color` | Aktuelle Session-Farbe, gesetzt durch `join_room`. |
| `chat_message` | `sender_nick_color` | **Snapshot** beim `send_message` aus der Session des Senders. |

**Historie:** Ältere Nachrichten behalten die Farbe vom Sendezeitpunkt. Farbwechsel im Profil wirkt auf neue Nachrichten und `join_room`, nicht auf bestehende Rows.

**Sicherheit:** `send_message` nimmt **kein** Farb-Argument vom Client; der Server liest `nick_color` aus `user_session`.

**Reducer:** `join_room(url, username, nick_color)`.

Deploy: `spacetime publish wepchat -y` (aus `server/`), danach `npm run codegen:stdb` in `extension/`. Siehe [spacetimedb.md](../kickoff/spacetimedb.md), [learnings.md](../learnings.md).

---

## 2.1 Bubble-Hintergrund

| Aspekt | Umsetzung |
| --- | --- |
| **Nickname** | Volle Palettenfarbe (`#…` aus Tabelle). |
| **Bubble** | `color-mix(in srgb, <hex> 14%, white)` im Client (`nickColorStyles`). |
| **Eigene vs. fremde Nachrichten** | `.own` nur für Ausrichtung rechts; Hintergrund folgt **Sender-Farbe**. |
| **Legacy / fehlendes Feld** | Client normalisiert `sender_nick_color` mit `normalizeNickColorId` (Default Blau). |

---

## 2.2 Farbpicker (UI)

| Punkt | Umsetzung |
| --- | --- |
| **Ort** | Settings-Panel unter dem Pseudonym (`App.svelte`). |
| **Layout** | Raster **3 × 3**, IDs 1→9. |
| **Control** | `role="radiogroup"`; Swatches `role="radio"`, lokalisierte `aria-label`. |
| **Interaktion** | Sofort speichern + `syncPresence` / `join_room`. |

---

## 2.3 Default-Farbe

| Ebene | Default |
| --- | --- |
| **Neues Profil (lokal)** | **`1` (`blue`)** |
| **Migration ohne `nickColorId`** | **`1` (Blau)** |
| **Server / Reducer** | **`1` (`blue`)** bei ungültigem `nick_color` |

---

## 3. Später (nicht MVP)

Mehrere Profilfarben, Icons, mehrfarbige Badges: Palette-IDs 1–9 bleiben unverändert; Erweiterung über neue Felder oder Enums.
