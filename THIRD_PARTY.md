# Bestandteile von Dritten

8BOY kommt im Browser ohne fremde Dienste aus. Mitgeliefert werden nur die folgenden Bestandteile von Dritten.

| Bestandteil | Datei | Lizenz | Rechteinhaber |
|---|---|---|---|
| **fengari-web** 0.1.4 (Lua-VM für den Browser, enthält **fengari** 0.1.5 und **fengari-interop** 0.1.4) | `vendor/fengari-web.js` | MIT – [`vendor/fengari-LICENSE.txt`](vendor/fengari-LICENSE.txt) | © 2017–2018 Benoit Giannangeli, © 2017–2018 Daurnimator; Lua-Referenzimplementierung © 1994–2017 Lua.org, PUC-Rio (MIT) |
| **sprintf-js** 1.1.3 (im fengari-web-Paket enthalten) | `vendor/fengari-web.js` | BSD-3-Clause – [`vendor/sprintf-js-LICENSE.txt`](vendor/sprintf-js-LICENSE.txt) | © 2007–present Alexandru Mărășteanu |
| **Atkinson Hyperlegible** (Schrift der UI-Ebene) | `vendor/AtkinsonHyperlegible-Regular.ttf`, `vendor/AtkinsonHyperlegible-Bold.ttf` | SIL Open Font License 1.1 – [`vendor/AtkinsonHyperlegible-OFL.txt`](vendor/AtkinsonHyperlegible-OFL.txt) | © 2020 Braille Institute of America, Inc. |

## Nur zum Entwickeln (nicht ausgeliefert)

Über `npm install` kommen Werkzeuge für Tests dazu, die nicht Teil der Konsole sind:

| Paket | Lizenz |
|---|---|
| fengari, fengari-web (für Tests ohne Browser) | MIT |
| playwright (Browser-Tests) | Apache-2.0 |

## Alles Übrige

Programmcode, Kartridges, Grafiken, Klänge, Modelle und Texte sind eigene Werke der YOURLEAF GmbH bzw. werden im
Code erzeugt (Klänge per Synthese, Modelle und Texturen per Formel oder mit Blender aus den Skripten in
`tools/giga/`). Lizenzen: [`LICENSE`](LICENSE) (Code, MIT) und [`LICENSE-CONTENT`](LICENSE-CONTENT) (Inhalte,
CC BY-SA 4.0; Asset-Pakete CC0).
