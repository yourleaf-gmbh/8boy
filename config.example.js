// Beispiel für config.js – für eine eigene Instanz nach config.js kopieren und anpassen.
// Alle Werte sind optional; null bedeutet „Standard“ (siehe config.js). Die Adressen unten sind Platzhalter.
window.EIGHTBOY_CONFIG = {
  // Externe Kataloge mit Kartridges für den Store (gleiches Format wie carts/store.json, "file"/"cover" relativ
  // zum Katalog). Eine Adresse oder eine Liste. Der Server muss CORS erlauben. Siehe docs/KARTRIDGES-EINBINDEN.md.
  katalogUrl: 'https://lernspiele.example.org/katalog.json',

  // WebSocket-Adresse der Lobby (server/lobby.mjs). Gebraucht für Mehrspieler-Kartridges (net.*),
  // „Handy als Controller“ und den TV-Modus. Läuft die Lobby unter derselben Domain unter /mp, bleibt das null.
  lobbyUrl: 'wss://lobby.example.org/mp',

  // Seite, die das Handy beim Scannen des QR-Codes öffnet (es hängt #pad=<code> an).
  // Nur nötig, wenn die Konsole unter einer anderen Adresse läuft, als Handys erreichen können.
  padUrl: 'https://spiel.example.org/',

  // Rechtliche Angaben des Betreibers; erscheinen unten im Regal.
  impressumUrl: 'https://example.org/impressum',
  datenschutzUrl: 'https://example.org/datenschutz',
};
