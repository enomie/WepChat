# Monorepo-Struktur WepChat

Saubere Aufteilung und Struktur für das Projekt:

```text
WepChat/                            <-- Projekt-Root
│
├── docs/                           <-- Dokumentation & Spezifikation
│   ├── kickoff/
│   │   ├── konzept.md              <-- Produkt- und Kernkonzept
│   │   ├── setup.md                <-- Schritt-für-Schritt Setup-Guide
│   │   └── svelte.md               <-- Svelte 5 Architektur & State Management
│   ├── requirements/
│   │   ├── general.md              <-- Allgemeine Anforderungen
│   │   ├── security.md             <-- Secrets, Threat Model, SpacetimeDB-Zugang
│   │   ├── message-content.md      <-- Erlaubte Zeichen in Chat-Nachrichten
│   │   └── architektur.md          <-- Monorepo-Struktur & Aufteilung
│   └── infos/                      <-- Notizen, Recherchen & API-Referenzen
│
├── extension/                      <-- Browser Extension (WXT + Svelte 5)
│   ├── package.json
│   ├── wxt.config.ts
│   └── src/
│       ├── entrypoints/
│       │   ├── sidepanel.html
│       │   ├── sidepanel/
│       │   │   └── main.ts
│       │   └── background.ts
│       ├── lib/
│       │   ├── url.svelte.ts       <-- URL State & Normalisierung
│       │   ├── profile.svelte.ts   <-- Anonymes Profil & Storage
│       │   └── spacetime.ts        <-- SpacetimeDB Client & Subscriptions
│       └── App.svelte              <-- Hauptkomponente / Side Panel UI
│
├── server/                         <-- Realtime Backend (SpacetimeDB in Rust)
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs                  <-- Reducers & Tabellen (UserSession, ChatMessage)
│
└── web/                            <-- (Optional) Webserver / PHP
    └── index.php                   <-- Landingpage, Impressum, Datenschutz
```

---

### Wo wird was entwickelt?

1. **`extension/` (WXT + Svelte 5 + TypeScript)**
   * **Aufgabe:** Gesamter Client-Code, der im Browser ausgeführt wird (Side Panel UI, Tab/URL-Erkennung, Sanitizing, lokales Profil via `browser.storage.local` und SpacetimeDB TypeScript SDK).
   * **Befehl:** `cd extension && npm run dev` (startet Test-Browser mit Auto-Reload / HMR).

2. **`server/` (SpacetimeDB / Rust)**
   * **Aufgabe:** Serverseitige Logik für Presence-Tracking, Chat-Nachrichten, automatische Client-Disconnects und Push-Subscriptions via WebSocket.
   * **Befehl:** `cd server && spacetime publish wepchat` (deployt die Logik lokal oder in der SpacetimeDB Cloud).
   * **SDK-Generierung:** `spacetime generate --lang typescript --out-dir ../extension/src/module_bindings` (generiert typisierte TypeScript-Bindings direkt für die Extension).

3. **`web/` (PHP / Statisch - Optional)**
   * **Aufgabe:** Datenschutz-Erklärung, Impressum und Landingpage.
   * **Kontakt:** Offizielle E-Mail wepchat@proton.me (Impressum, Datenschutz, Support).

---

### Wichtige Hinweise zum Setup

* **Kein Projekt im Root vermischen:** Das WXT-Projekt gehört direkt in den Unterordner `extension/`, nicht in den Root `WepChat/`.
* **Codegen-Workflow:** Wenn im Rust-Backend Tabellen oder Reducers angepasst werden, generiert das SpacetimeDB CLI mit einem einzigen Befehl die passenden TypeScript-Klassen und Types direkt in den `extension/`-Ordner.