# 8BOY selbst betreiben

8BOY besteht aus zwei Teilen:

1. **Die Konsole** – statische Dateien (HTML, CSS, JavaScript, Kartridges). Jeder Webserver kann sie ausliefern.
   Alles, was man allein spielt, läuft damit vollständig im Browser, auch offline.
2. **Die Lobby** (`server/lobby.mjs`) – ein kleiner Node-Dienst ohne Abhängigkeiten. Er wird nur gebraucht für
   - Mehrspieler-Kartridges über das Netz (Lua-Befehle `net.*`, z. B. die Netz-Lektion aus 8boy-lernspiele),
   - „Handy als Controller“ und den TV-Modus mit Handys,
   - Geschenk-Links (`#paket=g/…`), die nur wenige Male funktionieren.

## Im Heimnetz

```bash
npm start        # Konsole auf http://<rechner>:8080
npm run lobby    # Lobby auf ws://<rechner>:8787/mp
```

Mehr ist nicht nötig: Über `http://` verbindet sich die Konsole von selbst mit `ws://<gleicher rechner>:8787/mp`,
und die Lobby nimmt Verbindungen von `localhost` und aus privaten Adressbereichen (10.x, 172.16–31.x, 192.168.x) an.
Den QR-Code für Handys versieht der Entwicklungsserver mit seiner WLAN-Adresse.

## Im Internet

### 1. Konsole ausliefern

```bash
npm run build    # → dist/
```

`dist/` auf einen beliebigen Webserver laden. Empfehlungen:

- `sw.js`, `carts/index.json`, `carts/giga.json` und `assets/*/manifest.json` mit `Cache-Control: no-cache`
  ausliefern, damit Updates ankommen. Dateien unter `assets/` tragen ihre Prüfsumme im Namen und dürfen lange
  im Cache bleiben (`immutable`).
- `.lua` und `.txt` als `text/plain; charset=utf-8`.
- HTTPS ist Pflicht für Service Worker (Offline-Betrieb) und Installation als App.

### 2. Lobby starten

```bash
ALLOWED_ORIGINS=https://spiel.example.org TRUST_PROXY=1 node server/lobby.mjs 8787
```

| Variable | Bedeutung | Standard |
|---|---|---|
| `PORT` (oder erstes Argument) | Port des Dienstes | `8787` |
| `ALLOWED_ORIGINS` | Seiten, von denen sich Konsolen verbinden dürfen, kommagetrennt (genaue Herkunft inkl. `https://`) | nur localhost und Heimnetz |
| `TRUST_PROXY` | `1`, wenn ein eigener Reverse Proxy davorsteht und `X-Forwarded-For` setzt (für die Grenze „Verbindungen je Adresse“) | aus |
| `POW_BITS` | Schwierigkeit der Rechenaufgabe beim Verbinden (Schutz vor massenhaften Verbindungen) | `16` |
| `GESCHENKE_DIR` | Ordner mit Geschenk-Kartridges (ohne Angabe ist `/g/` abgeschaltet) | – |
| `GESCHENK_MAX` | Abrufe je Geschenk-Link | `4` |

Die Lobby speichert nichts dauerhaft: keine Konten, keine Protokolle mit IP-Adressen; Namen gibt es nur, solange man
verbunden ist. Grenzen gegen Missbrauch (Nachrichtengröße und -rate, Verbindungen je Adresse, Namensfilter,
Herkunftsprüfung, Rechenaufgabe) stehen am Anfang von `server/lobby.mjs`.

Endpunkte:

| Pfad | Zweck |
|---|---|
| `/mp` | WebSocket für Lobby, Mehrspieler und Handy-Controller |
| `/mp/status` | Anzahl Lobbys, Spieler und Fernseher als JSON |
| `/g/<schlüssel>/<name>.8boy.png` | Geschenk-Kartridges (nur mit `GESCHENKE_DIR`) |

### 3. Reverse Proxy

Am einfachsten liegen Konsole und Lobby unter **derselben Domain**: Der Proxy leitet `/mp` (mit WebSocket-Upgrade)
und `/g/` an die Lobby weiter, alles andere an die statischen Dateien. Dann braucht `config.js` keine Angaben.
Beispiel für nginx:

```nginx
location /mp {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 120s;
}
location /g/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

Andere Reverse Proxys funktionieren genauso: WebSocket-Upgrade für `/mp` durchreichen.

### 4. Konsole einstellen: `config.js`

Liegt die Lobby woanders, trägt man ihre Adresse in `config.js` ein (Vorlage mit allen Möglichkeiten:
`config.example.js`):

```js
window.EIGHTBOY_CONFIG = {
  lobbyUrl: 'wss://lobby.example.org/mp',   // Lobby unter anderer Domain
  padUrl: null,                             // Seite, die Handys über den QR-Code öffnen (Standard: diese Seite)
  impressumUrl: 'https://example.org/impressum',
  datenschutzUrl: 'https://example.org/datenschutz',
};
```

Die Lobby muss die Seite der Konsole dann in `ALLOWED_ORIGINS` erlauben.

## Geschenk-Links

Eine PNG-Kartridge (im Regal „⇩ Packung“ oder `node tools/pack.mjs packages carts/<datei>.lua`) lässt sich als Link
verschicken, der nur wenige Male funktioniert:

```bash
node tools/geschenk.mjs pakete/snake.8boy.png --max 4 --basis https://spiel.example.org/ --ziel /pfad/zu/geschenke
# → https://spiel.example.org/#paket=g/<schlüssel>/snake.8boy.png
```

Der Ordner (`--ziel`) ist derselbe, den die Lobby als `GESCHENKE_DIR` bekommt. Nach dem letzten erlaubten Abruf
löscht die Lobby die Datei; der Link meldet dann „abgelaufen“. Der Schlüssel (128 Bit Zufall) ist das Einzige, was
den Link schützt – Geschenk-Ordner also nie in ein Repository legen (`geschenke/` steht in `.gitignore`).
