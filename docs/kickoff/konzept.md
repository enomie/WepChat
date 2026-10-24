# Konzept: Realtime URL-Chat & Presence Extension

Ein Cross-Browser Plugin (Chrome, Edge, Firefox), das automatisch erkennt, auf welcher URL sich der User befindet, wie viele andere Personen aktuell auf derselben Seite unterwegs sind, und einen dazugehörigen Echtzeit-Chatraum öffnet.

---

## 1. Kernfunktionen & User Experience (UX)

* **URL-basierte Chaträume:** Jede eindeutige Website-URL fungiert als eigener Chatraum.
* **Presence & Realtime-User-Count:** Nutzer sehen sofort, wie viele Personen sich gerade auf der exakten Seite befinden.
* **Seitenleisten-Integration (Side Panel):** Der Chat läuft nativ in der Browser-Seitenleiste (Side Panel in Chrome / Sidebar Action in Firefox). Die eigentliche Website wird automatisch schmaler skaliert und bleibt vollständig klick- und bedienbar.
* **Anonymes & Anpassbares Profil:** Kein Zwang zur Registrierung/Google-Login. User erhalten automatisch ein zufälliges Pseudonym, das jederzeit lokal angepasst werden kann.

---

## 2. Datenschutz & Anonymität

* **Kein Account-Zwang:** Nutzeridentitäten basieren auf zufällig generierten Keys (SpacetimeDB Identity) und lokalen Profildaten im Browser.
* **Lokale Speicherung:** Pseudonyme und Präferenzen werden ausschließlich in `chrome.storage.local` abgelegt.
* **URL-Bereinigung (Sanitization):** Vor dem Betreten eines Raums werden Tracking-Parameter, Sessions und Referrer aus der URL entfernt (z. B. `amazon.de/dp/B0CSJZFNY9?ref=xyz` $\rightarrow$ `amazon.de/dp/B0CSJZFNY9`), um Datenlecks zu vermeiden und Raum-Fragmentierung zu verhindern.

---

## 3. Architektur & Tech-Stack

```text
┌─────────────────────────────────────────────────────────┐
│ Browser Extension (Side Panel UI)                       │
│ ├─ Framework: Svelte 5 (Runes Syntax)                   │
│ ├─ Extension Engine: WXT (Manifest V3 Cross-Browser)    │
│ └─ Storage: chrome.storage.local                        │
└────────────────────────────┬────────────────────────────┘
                             │ WebSocket Connection (Echtzeit)
                             ▼
┌─────────────────────────────────────────────────────────┐
│ Backend (SpacetimeDB / Rust)                            │
│ ├─ Reducers: join_room, leave_room, send_message        │
│ ├─ Tables: UserSession (Presence), ChatMessage          │
│ └─ Subscriptions: Automatische Realtime-Updates         │
└─────────────────────────────────────────────────────────┘
```

### Komponenten-Aufteilung
* **Extension (Frontend):** Svelte 5 + TypeScript + WXT. Kümmert sich um URL-Tracking, UI-Rendering im Side Panel und Steuerung des SpacetimeDB TypeScript Clients.
* **SpacetimeDB (Echtzeit-Database & Logic Engine):** Verwaltet offene WebSockets, berechnet aktive User-Counts pro URL und verteilt Chat-Nachrichten via Push-Subscriptions in Echtzeit.
* **Webserver (PHP - Optional):** Für statische Legal-Seiten (Datenschutz, Impressum) oder künftige Erweiterungen.

---

## 4. SpacetimeDB Datenmodell (Entwurf)

### Tabellen
1. **`UserSession`**
   * `identity` (Identity / Primary Key)
   * `current_url` (String)
   * `username` (String)
   * `joined_at` (Timestamp)

2. **`ChatMessage`**
   * `id` (u64 / Auto-Inc)
   * `url` (String)
   * `sender_identity` (Identity)
   * `sender_name` (String)
   * `text` (String)
   * `created_at` (Timestamp)

### Reducers
* `set_online_location(url: String, username: String)`
* `send_message(url: String, text: String)`

---

## 5. Roadmap / Phasen

- [x] **Phase 1: Setup & Grundgerüst** – WXT-Projekt mit Svelte 5 & Side Panel Entrypoints initialisieren.
- [ ] **Phase 2: SpacetimeDB Backend** – Rust-Module für `UserSession` und `ChatMessage` aufsetzen und lokal/cloud deployen.
- [ ] **Phase 3: Integration & Sync** – SpacetimeDB Client mit Svelte-Stores im Extension Side Panel verbinden.
- [ ] **Phase 4: Polish & Deploy** – URL-Cleaning verbessern, UI für Mobile/Standard-Anwendungsfälle testen, Manifests packen.
