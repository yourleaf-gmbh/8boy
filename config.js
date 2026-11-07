// Einstellungen dieser 8BOY-Instanz. Ohne Angaben läuft alles über dieselbe Seite:
//   Lobby (Mehrspieler, Handy als Controller): https → wss://<diese Seite>/mp, http → ws://<rechner>:8787/mp
//   Geschenk-Links: g/<schlüssel>/<name>.8boy.png auf derselben Seite
//   Kartridges: nur die mitgelieferten (carts/index.json, carts/store.json)
// Alle Möglichkeiten mit Beispielen: config.example.js. Betrieb der Gegenstelle: docs/SELBST-BETREIBEN.md
window.EIGHTBOY_CONFIG = {
  katalogUrl: null,      // externer Katalog (oder Liste), z. B. die Lektionen und Lernspiele aus 8boy-lernspiele
  lobbyUrl: null,        // eigene Lobby-Adresse, z. B. 'wss://lobby.example.org/mp'
  padUrl: null,          // Adresse für den Handy-Link im QR-Code, z. B. 'https://spiel.example.org/'
  impressumUrl: null,    // Link „Impressum“ im Regal (ohne Angabe verborgen)
  datenschutzUrl: null,  // Link „Datenschutz“ im Regal (ohne Angabe verborgen)
};
