# Ideen für zukünftige Entwicklung

Nur Sammlung von Ideen — keine feste Roadmap.

1. **Chatnachrichten nach Retention löschen** — Nach 72 h serverseitig (Scheduled Delete + Cleanup-Job): [security-list.md](../requirements/security-list.md#6-nachrichten-retention-72-stunden).
2. **Bezahlfunktion / längere Speicherung** — Wer bezahlt, dessen Chats bleiben länger (oder dauerhaft) auf dem Server gespeichert.
3. **Inhalte ausschließen** — Pornografie, sexuelle Inhalte und vergleichbare Themen vom Chat fernhalten (Moderation, Filter, Nutzungsregeln).
4. **Reine Textnachrichten / Keine Links & Sonderzeichen-Filter** — Man soll sich rein austauschen; daher keine anklickbaren/geposteten Web-Links (Schutz vor Phishing/Spam) und keine störenden Sonderzeichen/Symbole. Nur Buchstaben, Zahlen, Leerzeichen sowie grundlegende Satzzeichen (`.`, `,`, `!`, `?`, `-`) erlauben, alles andere automatisch bereinigen oder blockieren.
5. **Localhost ausschließen** — URLs mit `http://localhost`, `127.0.0.1` (inkl. Ports) brauchen keinen Chat/Raum: nur lokal erreichbar, kein gemeinsamer Kontext mit anderen Nutzern.

