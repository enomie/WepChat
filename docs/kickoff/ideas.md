# Ideen für zukünftige Entwicklung

Nur Sammlung von Ideen, keine feste Roadmap.

1. **Chatnachrichten nach Retention löschen**, Nach 72 h serverseitig (Scheduled Delete + Cleanup-Job): [security-list.md](../requirements/security-list.md#6-nachrichten-retention-72-stunden).
2. **Bezahlfunktion / längere Speicherung**, Wer bezahlt, dessen Chats bleiben länger (oder dauerhaft) auf dem Server gespeichert.
3. **Inhalte ausschließen**, Pornografie, sexuelle Inhalte und vergleichbare Themen vom Chat fernhalten (Moderation, Filter, Nutzungsregeln).
4. **Reine Textnachrichten / Zeichenfilter**, umgesetzt: [message-content.md](../requirements/message-content.md) (inkl. Link-Schutz ohne Link-Regex: [§8](../requirements/message-content.md#8-links-domains-kein-link-regex)).
5. **Localhost ausschließen**, umgesetzt: [url-eligibility.md](../requirements/url-eligibility.md) (localhost, private IPs, Browser-interne Schemes).
6. **Raum-Limit 100/72h pro Identity**, **verworfen.** Idee: max. 100 Nachrichten pro URL und `ctx.sender` im gleitenden 72‑h‑Fenster. Nicht umgesetzt: Identity hängt am lokalen Browser-Token, Rotation (Storage/Profil) setzt Zähler zurück; trifft vor allem Power-User, nicht Bots. Begründung: [security-list.md §7](../requirements/security-list.md#7-bewusst-nicht-ziel), [learnings.md §11](../learnings.md#11-identity-limits-und-spam).
7. **Chat-Verlauf paginieren**, umgesetzt (Client-Slice): [message-history-pagination.md](../requirements/message-history-pagination.md).
8. **Nickname-Farbe / Erscheinungsbild**, umgesetzt: [nickname-appearance.md](../requirements/nickname-appearance.md).
9. **Zeitlabel neben Pseudonym** („Gerade eben“ bis 1 Min, danach relativ), umgesetzt: [message-age-label.md](../requirements/message-age-label.md).
