# WepChat

**Chat with everyone on the same page.** WepChat is a cross-browser extension that turns the current URL into a live chat room, with real-time presence so you always see how many people are on that exact page with you.

No account. No social login. Open the side panel and talk.

### Try it in Chrome (Developer mode)

A pre-built unpacked extension lives in the repo:

**[extension/.output/chrome-mv3](https://github.com/enomie/WepChat/tree/main/extension/.output/chrome-mv3)**

1. Clone this repository (or download that folder).
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and choose the local directory `extension/.output/chrome-mv3`.

---

## Why WepChat?

Every day millions of people visit the same product page, article, or docs URL, but they never know it. WepChat adds a lightweight social layer **per URL**:

| | |
|---|---|
| **Same URL → same room** | One chat per normalized page URL |
| **Live presence** | See how many users are on this page right now |
| **Side panel UX** | Chat lives in the browser sidebar; the site stays visible and usable |
| **Privacy-first** | Random pseudonym, local profile storage, URL sanitization before joining |

---

## How it works

```mermaid
flowchart LR
  subgraph browser [Browser]
    Ext[WepChat Extension<br/>Svelte 5 + WXT]
    Panel[Side Panel UI]
    Ext --> Panel
  end
  subgraph cloud [SpacetimeDB]
    WS[WebSocket + subscriptions]
    R[join_room · leave_room · send_message]
    T[(UserSession · ChatMessage)]
    WS --> R --> T
  end
  Ext <-->|realtime| WS
```

1. The extension reads the active tab URL, strips tracking parameters, and joins the matching room.
2. **SpacetimeDB** keeps presence (`UserSession`) and messages (`ChatMessage`) in sync for all subscribers.
3. When you navigate away or disconnect, presence is cleaned up automatically.

---

## Tech stack

| Layer | Stack |
|-------|--------|
| Extension | [WXT](https://wxt.dev/) · [Svelte 5](https://svelte.dev/) · TypeScript · Manifest V3 |
| Realtime backend | [SpacetimeDB](https://spacetimedb.com/) (Rust module → WASM) |
| Web | PHP placeholder for legal/landing pages (`web/`) |

Chrome uses the **Side Panel API**; Firefox uses **Sidebar Action**, one codebase, two builds.

---

## Repository layout

```text
WepChat/
├── extension/     # Browser extension (UI, URL logic, SpacetimeDB client)
├── server/        # SpacetimeDB Rust module (tables + reducers)
├── web/           # Static PHP pages (e.g. imprint, privacy)
└── docs/          # Concept, architecture, setup notes
```

---

## Development

### Prerequisites

- **Node.js** 18+ and npm
- **Rust** toolchain (for the SpacetimeDB module)
- **[SpacetimeDB CLI](https://spacetimedb.com/install)** (`spacetime`)
- Chrome or Firefox for loading unpacked / dev builds

### Extension (local)

```bash
cd extension
npm install
npm run dev          # WXT dev server + test browser
npm run build        # production build → .output/
npm run build:firefox
```

Load the unpacked extension from [`extension/.output/chrome-mv3`](https://github.com/enomie/WepChat/tree/main/extension/.output/chrome-mv3) (committed build), or rebuild locally and use the fresh output under `extension/.output/` (Firefox: artifact after `build:firefox`).

### Backend (publish & regenerate client)

From the repo root:

```bash
cd server
spacetime publish wepchat    # or: spacetime publish --server local wepchat

cd ../extension
npm run codegen:stdb    # generate + patch index accessors (see docs/learnings.md)
npm run build
```

The extension connects to **SpacetimeDB Maincloud** by default (`wepchat` module). Adjust `SPACETIMEDB_URI` / `MODULE_NAME` in `extension/src/lib/spacetime.svelte.ts` if you use a self-hosted instance.

### Useful docs in this repo

- [Concept & UX](docs/kickoff/konzept.md)
- [Architecture requirements](docs/requirements/architektur.md)
- [Security & secrets](docs/requirements/security.md)
- [Message content (allowed characters)](docs/requirements/message-content.md)
- [Setup walkthrough](docs/kickoff/setup.md)
- [Go-live checklist](docs/kickoff/Live-Inbetriebnahme.md)

---

## Privacy & data

- **No mandatory registration**, identity comes from SpacetimeDB’s connection identity; display name is a local pseudonym.
- **Profile data** stays in `chrome.storage.local` (or Firefox equivalent).
- **URLs are normalized** before room lookup (tracking params removed) to reduce fragmentation and accidental leakage of session tokens in query strings.
- **Chat text & display names** are limited to letters (incl. German umlauts), digits, spaces, and `,` `.` `-`, enforced in the extension and on the server: [message-content.md](docs/requirements/message-content.md).
- **Secrets & threat model** (CLI vs. client, public tables, what not to put in the extension): [docs/requirements/security.md](docs/requirements/security.md)

---

## Roadmap

- [x] WXT + Svelte 5 side panel shell
- [x] SpacetimeDB schema: presence + chat reducers
- [x] Extension ↔ Maincloud integration
- [x] Message rate limit, 72h retention, allowed-character filter
- [ ] Store listing polish, moderation, user delete own messages
- [ ] Mobile strategy (PWA / share-sheet), see [requirements](docs/requirements/general.md)

---

## Contact

Official email: wepchat@proton.me (support, privacy, legal).

---

## Contributing

Issues and PRs are welcome on [github.com/enomie/WepChat](https://github.com/enomie/WepChat).

---

**WepChat**, *the web page you’re on is already a crowd; now you can say hello.*
