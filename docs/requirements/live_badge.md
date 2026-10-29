# Spezifikation: Live Badge (Presence-Indikator)

Dieses Dokument beschreibt das Konzept, die Architektur und die Umsetzung des Live-Badges auf dem angepinnten Extension-Icon im Browser.

---

## 1. Ziel & User Experience (UX)

Wenn Nutzer WepChat auf einer Seite **offen haben** (Sidepanel geöffnet), soll das Icon in der Toolbar anzeigen, ob sich auf dieser URL gerade mindestens eine weitere Person im Chat aufhält.

* **Sidepanel geschlossen**: **Keine** Badge-Zahl und **keine** Server-Anfrage mit der Tab-URL. Der Background sendet beim Surfen keine URLs (siehe `info.faq7` in den Locales).
* **Sidepanel geöffnet**: Badge und Online-Zähler im Panel kommen aus derselben WebSocket-Subscription (`user_session` für den normalisierten Raum).
* **Badge-Logik**:
  * **0 oder 1 Nutzer** (nur man selbst oder niemand): Badge ist **leer** (keine Zahl, kein visueller Lärm).
  * **Ab 2 Nutzern**: Badge zeigt die Anzahl (z. B. `2`, `14`, `120`).
  * **Große Zahlen (≥ 1000)**: Formatierung als `99+` (Platzbeschränkung von max. 4 Zeichen in Chromium).
* **Tab-spezifisch**: Updates nutzen `tabId` des aktiven Tabs im Fenster des Sidepanels. Beim Schließen des Panels wird der Badge geleert.

---

## 2. Technische Architektur

Der **Background Service Worker** ([`background.ts`](../../extension/src/entrypoints/background.ts)) öffnet nur das Sidepanel (Chrome) bzw. dient als Fallback für `action.onClicked`. **Kein** Live-Badge-Polling im Background.

Formatierung und Hilfsfunktionen: [`extension/src/lib/live-badge.ts`](../../extension/src/lib/live-badge.ts). Badge-Updates: [`spacetime.svelte.ts`](../../extension/src/lib/spacetime.svelte.ts) (`recountOnline`, `syncActiveTabBadge`, `clearActiveTabBadge`).

```
        [ Sidepanel offen, Nutzer im Chat-Raum ]
                          │
              WebSocket: join_room + Subscription
              user_session / chat_message pro URL
                          ▼
              ┌────────────────────────────┐
              │    SpacetimeDB (Cloud)     │
              └─────────────┬──────────────┘
                            ▼
                 Online-Count (lokal im Client)
                            ▼
              chrome.action.setBadgeText({
                text: count >= 2 ? count : '',
                tabId: activeTabId
              })

        [ Sidepanel geschlossen ]
                          │
              disconnect → Badge leer, keine URL an Server
```

---

## 3. Datenabfrage

**Umsetzung:** ausschließlich **WebSocket** im Sidepanel (`subscribeToUrl`, Table-Callbacks auf `user_session`). Kein HTTP-SQL aus dem Background.

`fetchOnlineCount` in `live-badge.ts` bleibt für Tests und optional späteres Opt-in (z. B. explizite Nutzer-Einstellung), wird im produktiven Extension-Pfad nicht aufgerufen.

Historische Option (HTTP-SQL / `chrome.alarms` im Background) wurde entfernt, um **keine Tab-URLs** an den Server zu senden, solange der Nutzer WepChat nicht geöffnet hat. Siehe [security.md](security.md) §6.

---

## 4. Badge-Formatierungsregeln

Die Chrome Action API (`chrome.action`) besitzt feste Einschränkungen:

1. **Badge-Text**:
   * Maximal 4 Zeichen lesbar.
   * Formatierung (`formatBadgeText`):
     * `count <= 1`: `""` (leer)
     * `2 <= count <= 99`: `${count}` (z. B. `"2"`, `"42"`)
     * `100 <= count <= 999`: `${count}` (z. B. `"150"`)
     * `count >= 1000`: `"99+"`

2. **Badge-Farbe**:
   * Hintergrund: Akzent-Blau (`#2563EB`, `BADGE_COLOR` in `live-badge.ts`).
   * Textfarbe: Weiß (`#FFFFFF`).

3. **Gültigkeitsbereich (`tabId`)**:
   * Bei jedem Update muss `tabId` mitgegeben werden:
     ```ts
     await chrome.action.setBadgeText({ text: formattedCount, tabId });
     await chrome.action.setBadgeBackgroundColor({ color: '#2563EB', tabId });
     ```

---

## 5. URL-Konsistenz

Raum-URL und Badge zählen dieselbe normalisierte URL wie der Chat (`cleanUrl` in [`url-utils.ts`](../../extension/src/lib/url-utils.ts)): YouTube, Amazon, Tracking-Parameter, usw.

---

## 6. Implementierung (Referenz)

| Ort | Verhalten |
|-----|-----------|
| `background.ts` | Sidepanel-Verhalten, beim Start global leerer Badge |
| `spacetime.svelte.ts` | `recountOnline` → Badge; `disconnect` / `clearRoomPresence` → Badge leeren |
| `live-badge.ts` | `formatBadgeText`, `BADGE_COLOR`; `fetchOnlineCount` nur Tests / optional später |
