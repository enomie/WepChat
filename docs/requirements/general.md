# Allgemeinen Anforderungen an WepChat

---

### 1. Kernkonzept & Funktionalität

* **URL-basierte Chaträume:** Jede eindeutige Website-URL (z. B. eine spezifische Amazon-Produktseite) fungiert als eigener Chatraum.
* **Presence Tracking:** Nutzer sehen in Echtzeit, wie viele andere Personen aktuell auf genau derselben Seite unterwegs sind (oder waren).
* **Echtzeit-Chat:** Instant-Messaging pro URL mit automatischer Verteilung neuer Nachrichten an alle anwesenden User.
* **URL-Normalisierung:** Automatisches Bereinigen von URL-Parametern (z. B. Entfernen von `?ref=...` oder Session-IDs), damit alle User auf derselben Produktseite im selben Raum landen und Datenlecks vermieden werden.

---

### 2. Plattform-Strategie

#### 🥇 Phase 1: Desktop First (Chrome zuerst, Firefox direkt mitgedacht)

* **Chrome Extension (Manifest V3):** Primäre Zielplattform.
* **Firefox Extension:** Von Tag 1 in der Architektur berücksichtigt.
* **Integration via Seitenleiste (Side Panel / Sidebar Action):**
* Der Chat öffnet sich in der nativen Browser-Seitenleiste.
* **Vorteil:** Die Zielwebsite passt ihre Breite automatisch an und wird **nicht verdeckt** – der User kann weiterhin auf der Website navigieren und hindurchklicken.


* **Cross-Browser-Builds:** Nutzung von WXT, damit ein einziger Codebase-Build sowohl für Chrome (`side_panel`) als auch für Firefox (`sidebar_action`) kompilierte Pakete erzeugt.

#### 📱 Phase 2: Mobile (iOS & Android)

* **Anforderung/Problem:** Mobilsysteme (Chrome/Safari auf Android/iOS) bieten keine native Seitenleisten-API oder Extension-Infrastruktur wie am Desktop.
* **Geplante Lösungsansätze:**
1. **PWA via Share-Sheet:** Der User nutzt auf dem Smartphone den "Teilen"-Button des Browsers, wählt die Chat-App aus, und diese öffnet die Seite direkt mit der übergebenen URL.
2. **In-App-Browser:** Eigenständige Smartphone-App (z. B. WebView-basiert), in der der User surft und unten eine ausklappbare Chat-Leiste eingeblendet bekommt.



---

### 3. Benutzer-Profil & Datenschutz

* **Unabhängig von Drittanbietern:** Keine Pflicht zur Registrierung via Google oder Social Logins.
* **Lokale Datenspeicherung:** Profildaten (Pseudonym, Farb-Tag/Avatar) liegen ausschließlich im lokalen Speicher des Browsers (`chrome.storage.local`).
* **Frei anpassbar:** Automatische Generierung eines zufälligen Pseudonyms (z. B. `Anon_8392`), das der User im Plugin-Interface jederzeit überschreiben kann.
* **Anonymität:** Anonyme Identifikation gegenüber dem Server über zufällig generierte Verbindungsschlüssel (SpacetimeDB Identity).

---

### 4. Technologiestack & Architektur

* **Frontend (Extension):** **Svelte 5** (Runes Syntax) + TypeScript für maximale Performance, minimale Bundle-Größe und reaktive UI-Updates.
* **Extension-Engine:** **WXT** (Vite-basiertes Cross-Browser-Extension-Framework mit HMR).
* **Echtzeit-Backend:** **SpacetimeDB** (In-Memory-Database + Rust WASM Reducers) für extrem performante WebSockets, Presence-Tracking und Message-Pushing.
* **Statische Inhalte / Landingpage (PHP):** Dein Webserver hostet Datenschutzhinweise, Impressum oder spätere REST-Hilfsdienste.

---

### 5. Was fehlt noch? / Mögliche Zukunftsanforderungen ("Was noch?")

* **Historie & Inaktivität:** Sollen Chat-Nachrichten für immer auf der URL gespeichert bleiben oder nach X Stunden/Tagen verfallen (Ephemeral Chat)?
* **Moderation & Safety:** Bad-Word-Filter, User-Muting oder Meldefunktionen für unangemessene Nachrichten im Backend.
* **Benachrichtigungen:** Unaufdringliche Indikatoren (z. B. kleiner Badge am Extension-Icon), wenn auf der aktuellen Seite aktiv gechattet wird.
* **Domain-weite Räume (Optionaler Tab):** Neben dem Raum für die *exakte URL* könnte ein zweiter Tab für die gesamte Domain existieren (z. B. Chat für ganz `amazon.de`).