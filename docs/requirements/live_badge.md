# Spezifikation: Background Live Badge (Presence-Indikator)

Dieses Dokument beschreibt das Konzept, die Architektur und die Umsetzung des Live-Badges auf dem angepinnten Extension-Icon im Browser.

---

## 1. Ziel & User Experience (UX)

Wenn Nutzer durchs Web surfen (z. B. auf Amazon, YouTube, Newsseiten, Blogs), soll das WepChat-Icon in der Browser-Toolbar sofort anzeigen, ob sich auf dieser URL gerade andere Menschen im Chat aufhalten.

* **Sidepanel geschlossen**: Der Nutzer muss das Sidepanel **nicht** öffnen, um zu wissen, ob jemand da ist.
* **Badge-Logik**:
  * **0 oder 1 Nutzer** (nur man selbst oder niemand): Badge ist **leer** (keine Zahl, kein visueller Lärm).
  * **Ab 2 Nutzern**: Badge zeigt die Anzahl (z. B. `2`, `14`, `120`).
  * **Große Zahlen (> 999)**: Formatierung als `99+` oder `1k+` (wegen Platzbeschränkung von max. 4 Zeichen in Chromium).
* **Tab-spezifisch**: Jeder Tab hat seinen eigenen Badge-Status (`tabId`). Wechselt der Nutzer von Amazon (2 online) auf YouTube (18 online), wechselt die Zahl sofort synchron zum aktiven Tab.

---

## 2. Technische Architektur

Chrome Manifest V3 unterscheidet strikt zwischen dem **Sidepanel** (UI, lebt nur solange geöffnet) und dem **Background Service Worker** (`background.ts`, läuft im Hintergrund als Event-Handler).

```
                      [ Nutzer surft im Browser ]
                                  │
                       tabs.onActivated / onUpdated
                                  ▼
                    ┌────────────────────────────┐
                    │  Background Service Worker  │
                    │      (background.ts)       │
                    └─────────────┬──────────────┘
                                  │
                 Semantische URL-Normalisierung (cleanUrl)
                                  │
             ┌────────────────────┴────────────────────┐
             │                                         │
    Option 1: HTTP SQL Query                  Option 2: WebSocket
    (Leichtgewichtiger REST-Abruf)            (Reaktive Push-Subscription)
    POST /database/sql                        SELECT * FROM user_session
             │                                         │
             └────────────────────┬────────────────────┘
                                  ▼
                    ┌────────────────────────────┐
                    │    SpacetimeDB Instance    │
                    │        (Cloud/Local)       │
                    └─────────────┬──────────────┘
                                  ▼
                       Online-Count ermitteln
                                  ▼
                   chrome.action.setBadgeText({
                     text: count >= 2 ? count : '',
                     tabId: activeTabId
                   })
```

---

## 3. Datenabfrage: Zwei Optionen im Background Worker

Da der Service Worker im Hintergrund schlafen gelegt werden kann (Lifecycle von MV3 Service Workern), muss die Datenabfrage ressourcenschonend sein:

### Option A: HTTP SQL Endpoint – *Empfohlen für Background*
SpacetimeDB Maincloud (wie in `extension/src/entrypoints/background.ts`):
```http
POST https://maincloud.spacetimedb.com/v1/database/wepchat/sql
Content-Type: text/plain

SELECT count(*) as total FROM user_session WHERE current_url = 'https://www.youtube.com/watch?v=...'
```

Öffentlicher Lesezugriff auf `public` Tabellen — kein Client-Secret. Siehe [security.md](security.md).
* **Vorteil**: 
  * Extrem ressourcensparend (kein dauerhafter WebSocket im Background Service Worker).
  * Der Service Worker kann sich nach dem Request schlafen legen.
  * Kein Verbindungs-Overhead bei Tabs, die man nur kurz ansurft.
* **Trigger**: 
  * `chrome.tabs.onActivated` (Nutzer wechselt den Tab)
  * `chrome.tabs.onUpdated` (URL ändert sich im aktuellen Tab, wenn `changeInfo.status === 'complete'`)

### Option B: WebSocket Subscription (Dauerhafte Echtzeit)
* Der Background Worker hält eine WebSocket-Verbindung und abonniert:
  `SELECT identity, current_url FROM user_session WHERE current_url = '{url}'`
* **Vorteil**: Aktualisiert sich im selben Tab sekündlich live, wenn jemand beitritt oder geht.
* **Nachteil**: Service Worker in MV3 werden nach 30–60 Sekunden Inaktivität von Chrome beendet, wodurch WebSockets getrennt werden und Reconnect-Logik nötig ist.

> **Empfehlung für Phase 1**: **Option A (HTTP SQL)** bei jedem Tab-Wechsel / URL-Laden abfragen. Optional: Wenn das Sidepanel geöffnet ist, übernimmt das Sidepanel ohnehin die Live-Aktualisierung über den bereits bestehenden WebSocket.

---

## 4. Badge-Formatierungsregeln

Die Chrome Action API (`chrome.action`) besitzt feste Einschränkungen:

1. **Badge-Text**:
   * Maximal 4 Zeichen lesbar.
   * Formatierung:
     * `count <= 1`: `""` (leer)
     * `2 <= count <= 99`: `${count}` (z. B. `"2"`, `"42"`)
     * `100 <= count <= 999`: `${count}` (z. B. `"150"`)
     * `count >= 1000`: `"1k+"` / `"99+"`

2. **Badge-Farbe**:
   * Hintergrund: Kräftiges Akzent-Blau (`#2563EB`) oder Markenfarbe von WepChat.
   * Textfarbe: Weiß (`#FFFFFF`).

3. **Gültigkeitsbereich (`tabId`)**:
   * Bei jedem Update muss zwingend `tabId` mitgegeben werden:
     ```ts
     await chrome.action.setBadgeText({ text: formattedCount, tabId });
     await chrome.action.setBadgeBackgroundColor({ color: '#2563EB', tabId });
     ```
   * Dadurch wird verhindert, dass eine Zahl fälschlicherweise auf allen Tabs angezeigt wird.

---

## 5. URL-Konsistenz (Wichtig!)

Der Background Worker muss exakt dieselbe `cleanUrl()`-Logik verwenden wie das Frontend ([url.svelte.ts](file:///Users/johann/MyBrew/WepChat/extension/src/lib/url.svelte.ts)):
* YouTube-Shortlinks & Videos werden auf `https://www.youtube.com/watch?v={id}` bereinigt.
* Amazon-Artikel auf `/dp/{ASIN}`.
* Tracking-Parameter (`utm_*`, `fbclid`, etc.) werden gestrippt.

Nur so stimmen die Zähler im Badge und im geöffneten Chatraum zu 100 % überein.

---

## 6. Schritt-für-Schritt Implementierungsplan (wenn gecodet wird)

1. **`cleanUrl()` auslagern / teilen**:
   * Sicherstellen, dass `cleanUrl` in `src/lib/url-utils.ts` ohne Svelte-Runtimes exportiert wird, damit `background.ts` sie direkt importieren kann.
2. **SpacetimeDB HTTP Count Client**:
   * Kleine Hilfsfunktion `fetchOnlineCount(url: string): Promise<number>` schreiben.
3. **Event-Listener in `background.ts`**:
   * `tabs.onActivated` (Tab gewechselt) -> URL holen -> Count abfragen -> `setBadgeText({ text, tabId })`.
   * `tabs.onUpdated` (Seite neu geladen) -> prüfen ob `changeInfo.url` oder Status complete -> Badge aktualisieren.
4. **Debouncing / Cache (Optional)**:
   * Schnelles Hin- und Her-Klicken zwischen Tabs cachen (z. B. 10 Sekunden Cache pro URL), um unnötige Anfragen zu vermeiden.
