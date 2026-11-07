# Kartridges und Kataloge einbinden

Die Konsole kennt drei Wege, Kartridges ins Regal zu bringen.

## 1. Einzelne Datei

Eine `.lua`-Datei oder eine PNG-Kartridge (`.8boy.png`) auf die Konsole ziehen oder im Regal „Datei laden“ wählen.
Die Kartridge liegt dann nur im Browser dieses Geräts.

## 2. Mitgeliefert (dieses Repository)

| Datei | Bedeutung |
|---|---|
| `carts/<name>.lua` | die Kartridge |
| `covers/<name>.png` | Titelbild der Packung (240×160; `node tools/pack.mjs covers carts/<name>.lua` bei laufendem Server) |
| `carts/index.json` | Grundregal: Liste der Dateinamen, die immer im Regal liegen |
| `carts/store.json` | eigener Store-Katalog (Format wie unten, `file` ohne Pfad); `tools/store.mjs` erzeugt ihn aus `STORE` |
| `carts/giga.json` | Kartridges für den 8BOY 128, nur sichtbar lokal oder mit `?giga` |

## 3. Externer Katalog

Ein Katalog ist eine JSON-Datei irgendwo im Netz. Die Konsole liest sie, wenn `config.js` sie nennt:

```js
window.EIGHTBOY_CONFIG = {
  katalogUrl: 'https://example.org/8boy-lernspiele/katalog.json',   // oder eine Liste mehrerer Kataloge
};
```

Ohne `katalogUrl` zeigt der Store nur die mitgelieferten Kartridges. Ist ein Katalog nicht erreichbar, läuft die
Konsole ohne ihn weiter.

### Aufbau

Eine Liste von Einträgen (oder ein Objekt `{ "carts": [ … ] }`). `file` und `cover` sind relativ zur Adresse des
Katalogs oder absolut; ohne `cover` gilt `covers/<name>.png` neben dem Katalog.

```json
[
  {
    "file": "carts/05-springen.lua",
    "cover": "covers/05-springen.png",
    "title": "Lektion 5: Schwerkraft & Springen",
    "desc": "Fallen, Springen, variable Sprunghöhe und Plattformen aus Kacheln.",
    "author": "8BOY Schule",
    "system": 8,
    "kind": "tutorial",
    "color": 11,
    "players": 1,
    "kb": 6,
    "kat": "Lektionen"
  }
]
```

| Feld | Bedeutung |
|---|---|
| `file`, `cover` | Kartridge und Titelbild |
| `title`, `desc`, `author` | wie im Kopf der Kartridge |
| `system` | 8, 16, 32, 64 (128 = 8BOY 128) |
| `kind` | `game` oder `tutorial` |
| `kat` | Kategorie im Store, z. B. `Lektionen`, `Lernspiele`, `Action` |
| `lern`, `license` | Lernspiel mit freier Lizenz (wird im Regal oben gezeigt) |
| `color`, `players`, `kb`, `online` | Etikettfarbe, Spielerzahl, Größe, Online-Mehrspieler |

Das Repository [8boy-lernspiele](https://github.com/yourleaf-gmbh/8boy-lernspiele) erzeugt seinen Katalog mit
`node tools/katalog.mjs` aus den Kartridge-Köpfen; das Skript eignet sich als Vorlage für eigene Kataloge.

### Was der Server des Katalogs braucht

- **CORS:** `Access-Control-Allow-Origin` für die Adresse der Konsole (oder `*`), für den Katalog, die Kartridges und
  die Titelbilder. Ohne CORS bleibt der Store leer bzw. die Packungen ohne Bild.
- `.lua` als `text/plain; charset=utf-8`.
- Für den Offline-Betrieb speichert der Service Worker nur Dateien der eigenen Adresse. Kartridges aus fremden
  Katalogen brauchen beim ersten Laden Netz; danach liegen sie im Regal des Browsers.
- Dateinamen müssen über alle Kataloge eindeutig sein; bei Gleichstand gewinnt der eigene Katalog, dann der erste.

### Asset-Pakete (8BOY 128)

Kartridges mit `-- assets: …` laden ihre Pakete aus `assets/<paket>/` der Konsole, nicht aus dem Katalog. Die Pakete
der GIGA-Lektionen (`giga-demo`, `giga-figuren`, `giga-licht`, `giga-welt`) liefert dieses Repository mit.
