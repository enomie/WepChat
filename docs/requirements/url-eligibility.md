# URL eligibility (öffentliche Chat-Räume)

WepChat-Räume gelten nur für **öffentlich im Web erreichbare** `http`/`https`-Seiten. Lokale, private und Browser-interne URLs werden client- und serverseitig abgelehnt.

Siehe auch [ideas.md §5](../kickoff/ideas.md), [security-list.md §2](security-list.md).

---

## 1. Ziel

- Kein `join_room` / keine Nachrichten für URLs, die keinen gemeinsamen Internet-Kontext haben.
- Keine eigene Domain-Blacklist (Porn/Kategorien): nur technische Ausschlüsse.
- Gleiche Regeln in `extension/src/lib/url-utils.ts` und `server/src/lib.rs`.

---

## 2. Erlaubt

- Scheme: nur `http:` und `https:` (case-insensitive am Scheme).
- Hostname: alles, was **nicht** unter §3 fällt (z. B. `example.com`, `www.amazon.de`).
- Länge: höchstens **2048 Bytes** nach Normalisierung (Client `MAX_CHAT_URL_LEN`, Server `MAX_URL_LEN`).

`cleanUrl()` normalisiert danach wie bisher (YouTube, Tracking-Parameter, …).

---

## 3. Abgelehnt

| Kategorie | Beispiele |
|-----------|-----------|
| Browser-intern / kein HTTP(S) | `chrome://`, `file://`, `about:blank`, `edge://` |
| Localhost-Namen | `localhost`, `localhost.localdomain` |
| IPv4 loopback | `127.0.0.0/8` |
| IPv4 privat (RFC 1918) | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` |
| IPv4 link-local | `169.254.0.0/16` |
| IPv4 unspezifisch | `0.0.0.0` |
| IPv6 loopback | `::1` |
| IPv6 link-local | `fe80::/10` (Präfix `fe80:`) |
| IPv6 unique local | `fc00::/7` (Präfix `fc`, `fd`) |

**Nicht** abgelehnt (bewusst): Hostnamen wie `localhost.example.com`, öffentliche IPs außerhalb der obigen Bereiche, Dev-DNS (`lvh.me` → 127.0.0.1, aber Hostname bleibt `lvh.me`).

---

## 4. Extension

- `resolveTabChatUrl(raw)` → `none` | `unsupported` | `ready` + bereinigte URL.
- `cleanUrl()` gibt `''` zurück, wenn die URL nicht eligible ist.
- Sidepanel: ein Hinweistext für `unsupported` (Locales `messages.unsupportedSite`).
- Tab-Wechsel auf unsupported: `leaveRoom` via `clearRoomPresence()`.

---

## 5. Server

- `url_allowed_for_chat(url)` in `join_room` und `send_message` (inkl. max. 2048 Bytes).
- `send_message`: zusätzlich `url` muss `user_session.current_url` entsprechen (Anti-Spoofing).

---

## 6. Tests

- `extension/src/lib/url-utils.test.ts`: Host-Matrix (TS).
- `server/src/lib.rs`: `url_eligibility_tests` (Rust, gleiche Fälle).
