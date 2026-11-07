# Sicherheit

## Eine Lücke melden

Bitte melde Sicherheitslücken **nicht** als öffentliches Issue, sondern per E-Mail an **<support@yourleaf.de>**
(Betreff: „8BOY Sicherheit“). Alternativ kannst du auf GitHub eine private Meldung über
„Security → Report a vulnerability“ anlegen, sofern das im Repository freigeschaltet ist.

Hilfreich sind:

- betroffene Datei oder Funktion und Version (Commit),
- Schritte zum Nachvollziehen, gern mit einer kleinen Kartridge oder einem Skript,
- was ein Angreifer damit erreichen könnte.

Wir bestätigen den Eingang innerhalb von fünf Werktagen, halten dich über die Behebung auf dem Laufenden und nennen
dich auf Wunsch in den Release-Hinweisen. Bitte gib uns Zeit für eine Behebung, bevor du Details veröffentlichst.

## Was uns besonders interessiert

- **Ausbruch aus der Lua-Umgebung:** Kartridges sind fremder Code. Sie dürfen nicht an `io`, `os`, `require`,
  JavaScript-Objekte, das DOM, Cookies oder Netzwerk außerhalb von `net.*` gelangen, und Endlosschleifen müssen vom
  Zeitlimit abgefangen werden.
- **PNG-Kartridges und Asset-Pakete** (`.8boy.png`, `.8bpak`): fehlerhafte oder manipulierte Dateien dürfen nur zu
  einer Fehlermeldung führen.
- **Lobby** (`server/lobby.mjs`): Umgehen der Grenzen (Rechenaufgabe, Raten, Verbindungen je Adresse,
  Herkunftsprüfung), Absturz durch Nachrichten, Zugriff auf Geschenk-Kartridges ohne gültigen Schlüssel.
- **Cross-Site-Scripting** über Titel, Beschreibungen oder Anleitungshefte von Kartridges.

## Unterstützte Versionen

Sicherheitskorrekturen gibt es für den aktuellen Stand von `main`.
