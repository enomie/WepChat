<?php
declare(strict_types=1);

$title = 'WepChat - Realtime URL-Chat & Presence Extension';
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($title) ?></title>
    <style>
        :root {
            --primary: #2563eb;
            --bg: #0f172a;
            --card-bg: #1e293b;
            --text: #f8fafc;
            --muted: #94a3b8;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0;
            background: var(--bg);
            color: var(--text);
            line-height: 1.6;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 3rem 1.5rem;
        }
        header {
            text-align: center;
            margin-bottom: 3rem;
        }
        h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
            background: linear-gradient(135deg, #60a5fa, #a855f7);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p.subtitle {
            font-size: 1.15rem;
            color: var(--muted);
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 1.5rem;
            margin-bottom: 3rem;
        }
        .card {
            background: var(--card-bg);
            padding: 1.5rem;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .card h3 {
            margin-top: 0;
            color: #60a5fa;
        }
        footer {
            text-align: center;
            margin-top: 4rem;
            padding-top: 2rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            color: var(--muted);
            font-size: 0.9rem;
        }
        footer a {
            color: #60a5fa;
            text-decoration: none;
            margin: 0 0.5rem;
        }
        footer a:hover {
            text-decoration: underline;
        }
        .legal {
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        .legal h2 {
            font-size: 1.25rem;
            margin-bottom: 0.75rem;
            color: #60a5fa;
        }
        .legal p {
            color: var(--muted);
            margin: 0 0 1.5rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>WepChat</h1>
            <p class="subtitle">Echtzeit-Chat & Presence auf jeder Website-URL direkt in deiner Browser-Seitenleiste.</p>
        </header>

        <section class="grid">
            <div class="card">
                <h3>💬 URL-basierte Räume</h3>
                <p>Jede besuchte Seite fungiert automatisch als eigener Raum – diskutiere mit Personen genau dort, wo du dich gerade befindest.</p>
            </div>
            <div class="card">
                <h3>👥 Live Presence</h3>
                <p>Sieh sofort in Echtzeit, wie viele Nutzer gerade auf der exakten Seite aktiv sind.</p>
            </div>
            <div class="card">
                <h3>🔒 Anonym & Sicher</h3>
                <p>Kein Account- oder Social-Login-Zwang. Lokale Profilspeicherung und automatische URL-Bereinigung zum Schutz deiner Privatsphäre.</p>
            </div>
        </section>

        <section class="legal" id="datenschutz">
            <h2>Datenschutz</h2>
            <p>
                WepChat speichert dein Pseudonym und Profil lokal in der Browser-Extension.
                Chat-Inhalte und normalisierte URLs werden für den Betrieb des Dienstes auf dem Server verarbeitet
                und nach 72 Stunden gelöscht. Ausführliche Hinweise folgen hier in Kürze.
            </p>
            <p>Kontakt: wepchat@proton.me</p>
        </section>

        <section class="legal" id="impressum">
            <h2>Impressum</h2>
            <p>Angaben gemäß § 5 TMG und verantwortlicher Kontakt für WepChat folgen in Kürze.</p>
            <p>Kontakt: wepchat@proton.me</p>
        </section>

        <footer>
            <p>&copy; <?= date('Y') ?> WepChat. Alle Rechte vorbehalten.</p>
            <p>Kontakt: wepchat@proton.me</p>
            <p>
                <a href="#datenschutz">Datenschutz</a> &bull;
                <a href="#impressum">Impressum</a>
            </p>
        </footer>
    </div>
</body>
</html>
