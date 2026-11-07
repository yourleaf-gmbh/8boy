# 8BOY – Barrierefreiheit (Spezifikation, Entwurf 25.10.2026)

> Die Zugänglichkeits-Ebene (`js/a11y.js`, Lua-Befehle `say`, `choose`, `cue`, `a11y()`) gehört zur Konsole. Die
> Piloten „Stadtpark 8-Bit“ und „Datenspur“ liegen im Repository 8boy-lernspiele; ihre Quellmodule
> (`tools/stadtpark/`, `tools/datenspur/`) gehören zur separat veröffentlichten Lernspiel-Engine von YOURLEAF.

**Ziel:** Rundenbasierte Kartridges sind vollständig ohne Bild spielbar (Screenreader, Tastatur, Vorlesen), alle
Kartridges bieten Assist-Optionen. Maßstab sind WCAG 2.2 AA und die Game Accessibility Guidelines (basic und
intermediate). Grafik, Klang und Spielgefühl bleiben unverändert. Zugänglichkeit ist eine zusätzliche Ebene, kein
Umbau.

**Grundsatz:** Die Spiellogik liefert ihren Zustand auch als Text. Bild, Ton und Screenreader sind nur verschiedene
Ausgaben desselben Zustands, wie bei den PhET-Simulationen.

## 1. Vorbilder

| Spiel | Was wir übernehmen |
|---|---|
| **Hearthstone Access** (Mod, von Blizzard anerkannt), **Say the Spire** (Mod für Slay the Spire) | Kartenspiel per Screenreader: Hand, Feld, Gegner als Text, Bedienung über Listen und Menüs |
| **Stardew Access** (Mod für Stardew Valley) | Karte mit Bewegung: Umgebung ansagen, Objektlisten, Wegfindung |
| **PhET Interactive Simulations** | HTML5-Lernsimulation mit drei Ebenen neben der Grafik: Beschreibung für Screenreader, eigenes Vorlesen, Verklanglichung von Werten |
| **The Last of Us Part II**, **Forza Motorsport** (Blind Driving Assists) | viele Einzelschalter, Hinweistöne statt Bild, Navigationshilfe |
| **Celeste** (Assist Mode), **Hades** (God Mode) | Tempo und Schwierigkeit einstellbar, ohne den Spieler abzuwerten |
| **A Blind Legend**, **The Vale** | Spiele, die nur über Ton funktionieren und trotzdem für Sehende gut sind |

Weitere Beispiele: gameaccessibilityguidelines.com, Can I Play That?, AbleGamers.

## 2. Aufbau: eine HTML-Ebene neben dem Canvas

```
<div id="a11y">                       sichtbar nur, wenn „Vorlesen“ an ist (sonst nur für Screenreader)
  <div aria-live="polite">            Ansagen (say), Untertitel
  <div aria-live="assertive">         dringende Ansagen (Ereignisse, Spielende)
  <div role="group" aria-label="…">   aktuelle Auswahl als echte <button>-Liste (choose)
  <p id="a11y-status">                Kurzbeschreibung (describe), zugleich aria-label des Canvas
</div>
```

- Der Canvas bekommt `role="img"` und als `aria-label` die erste Zeile von `_describe()`.
- Im Modus „Vorlesen“ springt der Tastaturfokus in die Auswahlliste. Pfeiltasten und A/B wirken dort wie im Spiel,
  der Screenreader liest jede Schaltfläche. Ohne Auswahl bleibt der Fokus auf der Konsole.
- Auswahl, Ansagen und Beschreibung laufen auf beiden Konsolen (8BOY und 8BOY 16) gleich.

## 3. Lua-API (neu)

| Befehl / Rückruf | Zweck |
|---|---|
| `say(text [, "polite"\|"assertive"])` | Ansage in die Live-Region. Gleiche Ansage innerhalb von 1 s wird nicht wiederholt. Mit „Eigene Stimme“ zusätzlich über `speechSynthesis`. |
| `function _describe() return "…" end` | Zustand auf Abruf als Text (eine Zeile oder mehrere, getrennt mit `\n`). Taste **H** liest ihn vor. |
| `choose(id, {"Option 1", "Option 2", …} [, titel])` | Setzt die aktuelle Auswahl. Sie erscheint als Schaltflächenliste und kann zusätzlich im Spiel gezeichnet werden. `choose(id, nil)` entfernt sie. |
| `function _choice(id, nr) … end` | Rückruf, wenn eine Option gewählt wurde (per Liste, Maus, Touch oder Spieltaste) |
| `t(schluessel, …)` | Text aus Sprachpaketen, Platzhalter `%1 %2`; fällt auf Deutsch zurück |
| `texts{ de = {…}, ls = {…}, en = {…} }` | Sprachpakete der Kartridge. `ls` = Leichte Sprache |
| `lang()` | aktuelle Sprache: `"de"`, `"ls"`, `"en"` |
| `a11y()` | Tabelle der Einstellungen: `reader`, `voice`, `contrast`, `motion`, `speed`, `assist`, `captions` |
| `cue(name)` | Hinweiston: `"ok"`, `"fehler"`, `"ereignis"`, `"runde"`, `"warnung"`, `"fokus"`. Feste Klänge der Konsole, damit sie in jedem Spiel gleich bedeuten |
| `caption(text)` | Untertitel für einen Ton (Leiste unten im Bild und als Ansage) |

Kopfzeile der Kartridge: `-- a11y: voll | assist | keine`. Das Regal zeigt dazu ein Symbol und einen Satz.

## 4. Einstellungen „Zugänglichkeit“ (Startmenü, für alle Kartridges)

| Schalter | Wirkung |
|---|---|
| Vorlesen (Screenreader) | HTML-Ebene aktiv, Fokus in die Auswahlliste, Ansagen ein |
| Eigene Stimme | Ansagen zusätzlich über die Sprachausgabe des Browsers, für Menschen ohne Screenreader |
| Leichte Sprache | `lang()` = `"ls"` |
| Hoher Kontrast | Palette gegen eine Kontrastpalette tauschen; jedes Paar Vorder-/Hintergrund mindestens 4,5 : 1 |
| Weniger Bewegung | kein Bildschirmwackeln, kein Blitzen, Überblendungen statt Sprüngen; nie mehr als 3 Blitze pro Sekunde |
| Tempo 50–100 % | verlangsamt `_update` (Uhr der Konsole), wirkt in jedem Spiel |
| Hilfen (Assist) | Kartridge entscheidet, z. B. unverwundbar, Zeitlimit aus, Lösungshinweis |
| Untertitel für Töne | `caption` sichtbar |
| Größe | ganzzahliger Zoom bis 6× und „füllen“; Text der HTML-Ebene folgt dem Browser-Zoom bis 200 % ohne Verlust |
| Tasten belegen | jede Taste frei belegbar, auch Einhandbedienung |

Gespeichert konsolenweit in `localStorage`, nicht je Kartridge.

## 5. Tasten

Frei in der heutigen Belegung (WASD, X/K/Leertaste, Z/Y/J, Enter/E, Shift/Q, Esc/M/P, Super: C/I, V/U, F/1, G/2):

| Taste | Funktion |
|---|---|
| **H** | Zustand vorlesen (`_describe`) |
| **R** | letzte Ansage wiederholen |
| **L** | aktuelle Auswahl vorlesen bzw. Fokus in die Liste |
| **Tab** | in die HTML-Ebene und wieder heraus |
| Gamepad | OPTION halten + A = vorlesen, OPTION halten + B = wiederholen |
| Touch | eigene Schaltfläche „Vorlesen“ am Gehäuse, nur im Modus „Vorlesen“ sichtbar |

## 6. Pflichten je Kartridge mit `-- a11y: voll`

1. `_describe()` beschreibt alles, was zum Entscheiden nötig ist (Werte mit Zustandswort, nicht nur Zahl oder Farbe).
2. Jede Entscheidung läuft über `choose`, nichts nur per Zielen oder Zeigen auf der Karte.
3. Alle Texte über `t()`, mit Fassung in Leichter Sprache.
4. Ereignisse mit `say` (assertive), `cue` und `caption`.
5. Keine Information nur über Farbe, Position oder Ton.
6. Keine Zeitlimits, oder sie lassen sich abschalten.
7. Minispiele haben eine Fassung über `choose` (z. B. Fehlersuche als Liste, Sortieren als Auswahl).

Actionspiele bekommen `-- a11y: assist`: Tempo, Hilfen, Untertitel, Kontrast,
Tastenbelegung. Eine vollständige Textfassung ist dort weder nötig noch sinnvoll.

## 7. Pilot: Stadtpark 8-Bit (umgesetzt 25.10.2026)

Quellen: `tools/stadtpark/zugang.lua` (neu, wird als letztes Modul eingebaut), gemeinsame Schritte in `ui.lua`,
`haupt.lua`, `minispiele.lua`, `einstellungen.lua`, `szenen.lua`. Kopfzeile `-- a11y: voll`.

- **Nur zusätzlich:** `zugang.lua` hängt sich nur ein, wenn `a11y().on` wahr ist. Ohne Ebene und auch mit Ebene, aber
  ohne eingeschaltete Wünsche, ist jedes Bild und die Zufallsfolge identisch (geprüft über volle Partien mit dem
  Tasten-Bot aus `test-stadtpark.mjs`, alte gegen neue Fassung und ohne gegen mit Ebene). Der neue Code verbraucht
  keine Zufallszahlen.
- **Eine Funktion für Taste und Liste:** Jede Entscheidung ist eine benannte Funktion (`title_activate`,
  `dialog_next`, `dialog_pick`, `conflict_to_solutions`, `conflict_pick`, `conflict_confirm`, `menu_activate`,
  `menu_back`, `settings_apply`, `mini_sort_pick`, `mini_quiz_pick`, `mini_next`, `monthend_after_report` …). Die
  Spieltasten und `_choice` rufen dieselbe Funktion auf. Die Auswahl wird jedes Bild aus dem Zustand gebaut
  (`ax_context`) und nur bei Änderung mit `choose` gemeldet; sie bietet nur, was auch die Tasten gerade können
  (z. B. „Weiter“ erst nach derselben Sperrzeit).
- **`_describe()`:** Bildschirm und markierte Möglichkeit, dann „Monat 7 von 30 (Oktober, Jahr 1). Budget 12 G.
  Erholung stabil 55, Artenvielfalt kritisch 18, …“, Kollaps-Warnung, offene Konflikte mit Ort, Frist und Schwere,
  Personal mit Beruf und Einsatz, ob schon entschieden ist. Am Ende beginnt der Text mit „Spielende“. Mit
  `a11y().leicht` alles in Leichter Sprache.
- **Konfliktliste statt Karte:** Im Park listet die Auswahl alle offenen Konflikte, dringende zuerst, und öffnet sie
  direkt. Dazu Besucher mit Frage, „Taste A: …“ (was vor der Figur liegt), Frau Okafor, Gärtnerhof, Pausenmenü, Monat
  abschließen. Die Parkkarte wird als Text mit Richtungen beschrieben („9 Felder nach Süden und 3 nach Osten“).
- **Lösungen in Worten:** „Bewässerungssäcke anbringen. Wirkung: Baumbestand plus 6, Stadtklima plus 2. Kosten: 4 G.
  Nicht möglich: Zu wenig Budget.“ Die Eskalation wie im Bild nur als Richtung („Baumbestand sinkt stark“).
- **Ansagen:** neuer Bildschirm, jede Dialogseite, jede Änderung der vier Werte („Baumbestand sinkt von 58 auf 52,
  jetzt angespannt“) und des Budgets; fällt ein Wert auf kritisch oder in den Kollaps: assertive und `cue("warnung")`.
  Eskalationen und Kollaps-Warnung im Monatsbericht assertive mit `cue("warnung")`, Parkzeitung assertive mit
  `cue("ereignis")`, neuer Monat mit `cue("runde")`, Besucher mit `cue("fokus")`, Fehlermeldungen mit `cue("fehler")`.
  Alles eines Bildes wird zu einer Ansage je Dringlichkeit zusammengefasst, damit sich die Ansagen nicht gegenseitig
  überschreiben. Hinweistöne nur mit „Vorlesen“ oder „Eigene Stimme“, damit das Spiel sonst klingt wie bisher.
- **Untertitel** (Wunsch „Untertitel“): Münzklang, Fehlerton, Fanfaren, Feuerwerk, Musikwechsel.
- **Lernspiele als Liste:** Zuordnen (Kategorien als Möglichkeiten) und Quiz. **Gieß-Spiel:** Wer über die Liste
  spielt, bekommt die ruhige Fassung ohne Zeitdruck (15 Züge, ein Zug = eine Sekunde Gießen auf die gewählte Pflanze,
  Wasserstand in Worten). Mit Tasten bleibt es das Echtzeit-Spiel; die erste Wahl aus der Liste hält die Uhr an.
- **Ohne Zeitdruck:** Besucher mit offener Frage gehen nicht, solange über die Liste gespielt wird. Vorspann und
  Monatsübergang laufen von selbst weiter und haben „Weiter“.
- **Hoher Kontrast** (`a11y().contrast`): Schriftfarben unter 4,5 : 1 werden heller (dunkles Grau, Lavendel, Rot,
  Dunkelgrün), auf Papier (Zeitung, Lernkarten) dunkler; doppelte helle Rahmen; Frist auf schwarzem Grund; nicht
  bezahlbare Lösungen zusätzlich mit „×“.
- **Weniger Bewegung** (`a11y().motion`): kein Wippen der Flammen, Pfeile und Sprechblasen, kein Blinken (Kollaps,
  Karte, ▼), kein Blitz und stehender Regen im Kollaps-Ende, kein Feuerwerk, stehender Schnee/Regen, ruhiges Wasser,
  kein Schwenk im Titelbild, Porträts ohne Blinzeln.
- **Leichte Sprache:** `a11y().leicht` schaltet zusätzlich zu `BAL.leicht` alle `*_l`-Texte ein; Ansagen und
  `_describe` haben eine eigene Fassung. Feste Spieltexte ohne `*_l` (Dialoge von Frau Okafor, Monatsbericht-Zeilen)
  bleiben in Standardsprache.
- Nebenbei behoben: Taste B auf der Infoseite eines Konflikts brachte das Spiel zum Absturz.
- Danach Datenspur, dann die übrigen rundenbasierten Kartridges.

## 8. Tests

| Test | Inhalt |
|---|---|
| `tools/test-a11y.mjs` | Playwright: Vorlesen an, HTML-Ebene vorhanden, axe ohne Verstoß, Fokusfolge, Tasten H/R/L, Zoom 200 % |
| **Blinder Bot** | spielt Stadtpark nur über `_describe`, `choose` und `_choice` bis zum Ende, ohne Pixel zu lesen. Beweist, dass das Spiel ohne Bild vollständig spielbar ist |
| Kontrast | rechnet alle Paarungen der Kontrastpalette gegen 4,5 : 1 |
| Kompatibilität | `test-compat.mjs` bleibt grün: mit ausgeschalteter Zugänglichkeit ändert sich kein Bild |
| von Hand | NVDA + Firefox, JAWS + Chrome, VoiceOver macOS/iOS, TalkBack; Ergebnis in die BITV-Selbstbewertung |

## 9. Datenspur (umgesetzt 25.10.2026)

Kopfzeile `-- a11y: voll`. Alles Zusätzliche steht in `tools/datenspur/zugang.lua`, die übrigen Module rufen nur
gemeinsame Aktionsfunktionen auf. Ohne Ebene (`a11y().on == false`) wird nichts davon ausgeführt:
`test-compat` bleibt Bild für Bild gleich, neuer Code verbraucht keine Zufallszahlen.

| Pflicht | Umsetzung |
|---|---|
| `say`-Konflikt | Die eigene Dialogfunktion heißt jetzt `dialog(pages, opts)`. |
| `_describe()` | Ort (Spielmodus, nächstes Schild), nächster Fall mit Weg in Schritten („9 nach rechts, 3 nach oben“), Datenspur mit Stufe („deutliche Datenspur“) und Bilanz, aktueller Dialog/Fenster/Ansicht ganz, dazu die aktuelle Auswahl. Am Ende „Spielende“. In Leichter Sprache, wenn sie an ist. |
| Auswahl | `choose` für Titel, Intro, Figurenwahl, Dialog („Weiter“), Menüs und Rückfragen, Fenster („Weiter“/„Zurück“), Ansicht, Entscheidung (Antworten + „Ansicht noch einmal“), beide Minispiele, Auswertung, Abspann. `_choice` ruft dieselben Funktionen wie die Tasten (`menu_waehlen`, `title_waehlen`, `dialog_weiter`, `doc_weiter`, `ansicht_weiter`, `wahl_entscheiden`, `fs_aktion`, `so_ablegen`, `so_weiter`, `ende_weiter`, `abspann_fertig`, `avatar_*`, `pause_oeffnen`). |
| Karte | Liste „Gehe zu: <Figur> – dein nächster Fall“, „Andere Figuren und Schilder“ (alle Figuren, sechs Schilder), „Menü“. Die Spielfigur läuft den Weg selbst und spricht am Ziel an wie mit A; jede Pfeiltaste bricht ab. Wer selbst läuft, hört, was vor ihm steht. |
| Minispiele | Warnzeichen finden als Liste aller Stellen mit Zustand „markiert/nicht markiert“ und „Antworten prüfen“; Daten sortieren als Liste der Fächer mit Beschreibung. Kein Zeitlimit (es gab nie eins). |
| Ansagen | Jede neue Dialogseite (ganze Sätze, mit Bildbeschreibung `bildAlt`), jedes Fenster (Folge, Ergebnis, Auswertung), jede nachgebaute Ansicht als Text, Rückfragen, Welt-Lage. Ansagen eines Bildes werden gesammelt und einmal gesprochen. |
| Ereignisse | `cue` + Untertitel bei Entscheidung (ok/warnung/fehler), Minispiel-Ergebnis, Karte richtig/falsch (mit Text), Post kommt, Spielende (runde). Wertänderung der Datenspur steht in jedem Folge-/Ergebnisfenster und wird mit angesagt; Markieren, Musik und Leichte Sprache werden als Zustand angesagt. |
| Untertitel | nur mit „Untertitel für Töne“: Ereignistöne und Musikwechsel (`caption`). |
| Leichte Sprache | `a11y().leicht` schaltet die vorhandene Fassung `SP = "l"` ein (alle Spieltexte und alle neuen Ansagen haben eine `l`-Fassung); aus → wieder die eigene Wahl im Spiel. |
| Kontrast | `kt/kbg/kfl` in `ui.lua`: dunkle Fenster schwarz, blasse Schrift heller (5→6, 6→7, 13→29), blaue/grüne Knöpfe der Ansichten dunkler, Auswahlrahmen im Minispiel schwarz, Markierung dunkelrot. Gerechnete Paare ≥ 4,5 : 1 (Text) bzw. ≥ 3 : 1 (Rahmen). |
| Weniger Bewegung | kein Schreibmaschinentext, kein Blinken, keine wippenden Pfeile/Sprechblasen, Wasser und Sterne stehen, Titelbild steht, Intro ohne fliegende Zeichen, Karte fliegt nicht ins Fach, Balken ohne Hochzählen, kein Foto-Blitz im Motiv, Abspann als stehende Seite. |
| Keine Information nur über Farbe | Bewertung immer mit Symbol und Wort, Datenspur mit Zahl und Stufe, Markierung mit Warnsymbol und Rahmen. |

Test: `node tools/test-a11y.mjs datenspur.lua` (Bot in beiden Sprachfassungen bis „Spielende“, axe, Tastatur, Zoom),
`node tools/test-compat.mjs datenspur.lua`, `node tools/test-datenspur.mjs`.

## 10. Reihenfolge

1. HTML-Ebene, `say`, `_describe`, Tasten H/R/L, Einstellungsmenü (Vorlesen, Kontrast, Bewegung, Tempo, Größe)
2. `choose`/`_choice`, `t`/`texts`/`lang`, `cue`, `caption`
3. Pilot Stadtpark, Blinder Bot, `test-a11y.mjs`
4. Datenspur, danach Assist-Kopfzeilen für alle übrigen Kartridges
5. Studio: Vervollständigung und Hilfe für die neuen Befehle (`js/api-docs.js`), Vorlage „Zugängliches Spiel“
