-- title: Lektion 1: Hallo 8BOY
-- author: 8BOY Schule
-- desc: Spielschleife, Bildschirm, Koordinaten, Farben und Formen.
-- color: 12
-- kind: tutorial
-- cover: 3 START@0.5 START@1 START@1.5
-- icon:
-- ........
-- .777777.
-- .7cccc7.
-- .7c77c7.
-- .7cccc7.
-- .777777.
-- ..7..7..
-- ........

--[[anleitung
# Worum geht es?
Deine erste Lektion! Fünf Seiten zeigen, wie ein 8BOY-Programm tickt.

Oben läuft eine kleine Vorführung, unten steht die Erklärung.

Du lernst die Spielschleife, Koordinaten, Farben und Formen kennen.

# Steuerung
[START] nächste Seite
[SELECT] Seite zurück
[✚] Fadenkreuz (S. 2)

Drückst du [START] und [SELECT] zusammen, öffnet sich das Menü der Konsole. Dort findest du „Code ansehen“.

# Das lernst du
- _init, _update, _draw
- cls und pset
- line, rect, rectfill
- circ und circfill
- print für Text
- btn für die Tasten
- frame() und t() für die Zeit

_init läuft einmal, _update und _draw 60-mal pro Sekunde.

# Probier es aus!
Ändere im 8BOY Studio eine Zahl und starte neu:
- dx=1.5 bei ball auf 3: Der Ball saust.
- cls(1) auf cls(2): neuer Hintergrund.
- „Hallo Welt!“ auf deinen Namen.

Kaputt machen kannst du nichts!
]]

-- Jede 8BOY-Kartridge ist ein Lua-Programm. Die Konsole ruft
-- drei Funktionen auf, wenn es sie gibt:
--   _init()    einmal beim Start
--   _update()  60 mal pro Sekunde: Spiel-Logik (rechnen)
--   _draw()    60 mal pro Sekunde: Bild malen
-- Diese Lektion ist in "Seiten" aufgeteilt. Die Menütaste blättert
-- weiter, die Optionstaste zurück. Unten steht jeweils die Erklärung.

pages = {}
page = 1

-- Hilfsfunktion: Rahmen mit Titel und Erklärtext
function frame_ui(title, text)
  rectfill(0, 0, SCREEN_W, 11, 1)
  print(title, 4, 2, 10)
  print(page .. "/" .. #pages, SCREEN_W - 26, 2, 6)
  rectfill(0, 99, SCREEN_W, 61, 16)
  line(0, 99, SCREEN_W, 99, 17)
  print(text, 6, 103, 7)
end

-------------------------------------------------- Seite 1
ball = { x = 120, y = 50, dx = 1.5, dy = 1 }

pages[1] = {
  title = "Die Spielschleife",
  text = "Jedes Spiel ist eine Schleife: 60 mal\n" ..
         "pro Sekunde rechnet _update() und\n" ..
         "_draw() malt das Bild neu.\n" ..
         "Der Ball bewegt sich pro Bild ein\n" ..
         "kleines Stück - das ist Animation!\n" ..
         "MENÜ: weiter   OPTION: zurück",
  update = function()
    ball.x = ball.x + ball.dx
    ball.y = ball.y + ball.dy
    -- an den Wänden abprallen: Richtung umdrehen
    if ball.x < 4 or ball.x > SCREEN_W - 5 then ball.dx = -ball.dx end
    if ball.y < 16 or ball.y > 94 then ball.dy = -ball.dy end
  end,
  draw = function()
    cls(1)
    circfill(ball.x, ball.y, 4, 10)
    print("Bild Nr. " .. frame(), 6, 16, 6)
  end,
}

-------------------------------------------------- Seite 2
cross = { x = 120, y = 55 }

pages[2] = {
  title = "Koordinaten",
  text = "Der Bildschirm hat 240 x 160 Pixel.\n" ..
         "x zählt nach rechts, y nach UNTEN!\n" ..
         "Oben links ist (0,0).\n" ..
         "Bewege das Fadenkreuz mit dem\n" ..
         "Steuerkreuz und beobachte x und y.",
  update = function()
    if btn(LEFT) then cross.x = cross.x - 1 end
    if btn(RIGHT) then cross.x = cross.x + 1 end
    if btn(UP) then cross.y = cross.y - 1 end
    if btn(DOWN) then cross.y = cross.y + 1 end
    cross.x = clamp(cross.x, 0, SCREEN_W - 1)
    cross.y = clamp(cross.y, 12, 98)
  end,
  draw = function()
    cls(0)
    -- Raster alle 20 Pixel
    for x = 0, SCREEN_W, 20 do line(x, 12, x, 98, 16) end
    for y = 20, 98, 20 do line(0, y, SCREEN_W, y, 16) end
    line(cross.x, 12, cross.x, 98, 5)
    line(0, cross.y, SCREEN_W, cross.y, 5)
    pset(cross.x, cross.y, 8)
    print("x=" .. cross.x .. " y=" .. cross.y, 6, 16, 10)
  end,
}

-------------------------------------------------- Seite 3
pages[3] = {
  title = "32 Farben",
  text = "8BOY kennt 32 Farben, Nummer 0-31.\n" ..
         "Jede Farbe hat 5 Bit Rot, Grün, Blau\n" ..
         "(15 Bit) - wie bei 16-Bit-Konsolen.\n" ..
         "cls(1) füllt den Bildschirm mit\n" ..
         "Farbe 1, pset(x,y,8) malt 1 Pixel rot.",
  draw = function()
    cls(0)
    for i = 0, 31 do
      local x = 8 + (i % 8) * 28
      local y = 16 + flr(i / 8) * 20
      rectfill(x, y, 24, 12, i)
      print(i, x + 2, y + 13, 6)
    end
  end,
}

-------------------------------------------------- Seite 4
pages[4] = {
  title = "Formen malen",
  text = "line(x1,y1, x2,y2, farbe)\n" ..
         "rect(x,y, breite,höhe, farbe)\n" ..
         "rectfill(...) = gefülltes Rechteck\n" ..
         "circ(x,y, radius, farbe), circfill\n" ..
         "print(text, x,y, farbe)",
  draw = function()
    cls(1)
    local t = t()
    for i = 0, 11 do
      local a = t + i / 12 * pi * 2
      line(50, 55, 50 + cos(a) * 30, 55 + sin(a) * 30, 8 + i % 8)
    end
    rect(100, 25 + sin(t * 2) * 8, 40, 30, 7)
    rectfill(104, 29 + sin(t * 2) * 8, 32, 22, 12)
    circ(185, 55, 10 + sin(t * 3) * 6, 10)
    circfill(185, 55, 5, 9)
    print("Hallo!", 104, 80, 7)
  end,
}

-------------------------------------------------- Seite 5
pages[5] = {
  title = "Jetzt du!",
  text = "Drück MENÜ und OPTION zusammen und\n" ..
         "wähle 'Code ansehen'. Ändere eine\n" ..
         "Zahl, z.B. die Farbe hier oben, und\n" ..
         "starte die Kartridge im Editor neu.\n" ..
         "Programmieren heißt: ausprobieren!",
  draw = function()
    cls(0)
    local msg = "Hallo Welt!"
    for i = 1, #msg do
      local ch = msg:sub(i, i)
      local y = 45 + sin(t() * 4 + i * 0.5) * 8
      print(ch, 60 + i * 12, y, 8 + (i + flr(t() * 6)) % 8, 2)
    end
  end,
}

function _update()
  if btnp(START) and page < #pages then page = page + 1; sfx("select") end
  if btnp(SELECT) and page > 1 then page = page - 1; sfx("back") end
  local p = pages[page]
  if p.update then p.update() end
end

function _draw()
  local p = pages[page]
  camera()
  p.draw()
  frame_ui(p.title, p.text)
end
