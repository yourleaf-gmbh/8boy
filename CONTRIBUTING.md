# Mitmachen bei 8BOY

Danke, dass du 8BOY besser machen willst! Willkommen sind Fehlerbehebungen, neue Funktionen
und Verbesserungen an Konsole, Studio und Baukasten, Barrierefreiheit, Übersetzungen und Dokumentation.

Bitte lies vorher kurz den [Verhaltenskodex](CODE_OF_CONDUCT.md). Sicherheitslücken meldest du nicht als Issue,
sondern wie in [SECURITY.md](SECURITY.md) beschrieben.

## So läuft ein Beitrag

1. **Issue zuerst** bei allem, was größer ist als ein kleiner Fehler: kurz beschreiben, was du vorhast. So klären wir
   früh, ob es passt, und niemand arbeitet umsonst. Vorlagen gibt es für Fehler und Ideen.
2. **Fork und Branch:** `git checkout -b studio-suche` (oder `fix-…`, `lobby-…`).
3. **Lokal prüfen:** `npm install`, dann `npm start` zum Ausprobieren und `npm run check` vor dem Pull Request.
4. **Pull Request** gegen `main` mit der Vorlage. Ein Thema je Pull Request; lieber zwei kleine als einen großen.

## Kartridges beitragen

Dieses Repository enthält nur die Konsole und eine Beispiel-Kartridge. **Lektionen, Konzept-Demos und Lernspiele**
gehören in das Repository [8boy-lernspiele](https://github.com/yourleaf-gmbh/8boy-lernspiele) – dort steht, wie man
sie beiträgt. Eigene Sammlungen lassen sich als Katalog einbinden (siehe `docs/KARTRIDGES-EINBINDEN.md`).

Hier willkommen sind Beiträge zur Konsole selbst: Laufzeit, Lua-Befehle, Grafik- und Klangchips, Regal und Store,
Studio, Baukasten, TV-Modus und Handy-Controller, Lobby-Server, Barrierefreiheit, Doku.

## Code-Stil

- **Ohne Build-Schritt und ohne Laufzeit-Abhängigkeiten.** Die Konsole besteht aus ES-Modulen, die der Browser direkt
  lädt. Neue Bibliotheken im Browser nur nach Absprache im Issue; keine externen Dienste, kein Tracking, keine CDNs.
- **JavaScript:** moderne Syntax (ES2022), 2 Leerzeichen Einrückung, einfache Anführungszeichen, Semikolons,
  Zeilen bis etwa 140 Zeichen. Kommentare und Bezeichner wie im umgebenden Code (überwiegend Deutsch).
- **Lua:** 2 Leerzeichen Einrückung, lokale Variablen wo möglich, Konstanten in GROSSBUCHSTABEN.
- **Neue Lua-Befehle** immer auch in `js/api-docs.js` beschreiben – daraus entstehen Hilfe und Vervollständigung.
- **Abwärtskompatibel:** Bestehende Kartridges müssen weiter genauso laufen. `node tools/test-compat.mjs`
  vergleicht Bild für Bild mit `tools/compat-golden.json`. Die Referenz nur bewusst neu aufnehmen
  (`--golden`) und im Pull Request begründen.
- **Zugänglichkeit:** Bedienelemente mit Tastatur erreichbar, sichtbarer Fokus, ausreichender Kontrast
  (siehe `docs/BARRIEREFREIHEIT.md`).

## Tests

| Befehl | Prüft | Browser nötig |
|---|---|---|
| `npm test` | alle Kartridges ohne Browser, Zufallseingaben | nein |
| `node tools/test-compat.mjs` | Kompatibilität Bild für Bild | nein |
| `node tools/test-mp.mjs` | Lobby, Mehrspieler, Handy-Controller | nein |
| `npm run check` | die drei oben zusammen (läuft auch in GitHub Actions) | nein |
| `node tools/test-e2e.mjs` | auspacken, Heft, spielen, PNG-Kartridge, Studio | ja (`npx playwright install chromium`, Server muss laufen) |
| `node tools/test-touch.mjs`, `test-super.mjs`, `test-dock.mjs`, `test-offline.mjs` … | Touch, Konsolen, TV-Modus, Offline | ja |
| `node tools/test-gpu.mjs`, `test-giga.mjs` | Grafikchip ULTRA/GIGA mit den Lektionen | ja; braucht `8boy-lernspiele` im Nachbarordner (oder `LERNSPIELE=<ordner>`) |

Kartridges eines anderen Ordners lassen sich ebenfalls prüfen:
`CARTS=../8boy-lernspiele/carts node tools/test-carts.mjs` und
`CARTS=../8boy-lernspiele/carts GOLDEN=../8boy-lernspiele/tools/compat-golden.json node tools/test-compat.mjs`.

## Lizenz deiner Beiträge

Mit einem Pull Request stellst du deinen Beitrag unter dieselben Lizenzen wie das Projekt:

- **Code** (auch der Lua-Code in Kartridges): [MIT](LICENSE)
- **Inhalte** (Grafiken, Texte, Melodien, Titelbilder, Bilder der Doku): [CC BY-SA 4.0](LICENSE-CONTENT)

Bitte bestätige das mit einem **Sign-off** in jedem Commit nach dem
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```bash
git commit -s -m "Studio: Suche im Editor"
# fügt an: Signed-off-by: Vorname Nachname <mail@example.org>
```

Damit erklärst du, dass du den Beitrag selbst erstellt hast oder das Recht hast, ihn unter diesen Lizenzen
weiterzugeben. Wer keinen Sign-off setzen möchte, hakt stattdessen die Lizenzbestätigung in der
Pull-Request-Vorlage ab. Als Autor in der Kartridge (`-- author:`) darfst du deinen Namen oder ein Pseudonym nennen.

## Fragen

Einfach ein Issue mit der Vorlage „Idee“ öffnen – oder an <support@yourleaf.de> schreiben.
