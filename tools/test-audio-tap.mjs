// Prüft den Ton-Mitschnitt (für Videos): Kartridge starten, 4 s Ton aufnehmen.  node tools/test-audio-tap.mjs [kartridge.lua] [ausgabe.webm]
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2] || '01-hallo.lua', out = process.argv[3];
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.goto('http://localhost:8080/');
await p.waitForFunction(() => window.eightboy?.carts.length);
const r = await p.evaluate(async (f) => {
  const e = window.eightboy;
  e.powerOn();
  const rec = new MediaRecorder(e.audio.tap(), { mimeType: 'audio/webm;codecs=opus' });
  const parts = [];
  rec.ondataavailable = (ev) => parts.push(ev.data);
  rec.start();
  await new Promise((res) => setTimeout(res, 3000));
  e.insertCart(f);
  await new Promise((res) => setTimeout(res, 4000));
  rec.stop();
  await new Promise((res) => { rec.onstop = res; });
  const buf = new Uint8Array(await new Blob(parts).arrayBuffer());
  // Pegel prüfen
  const ac = new AudioContext();
  const data = (await ac.decodeAudioData(buf.buffer.slice(0))).getChannelData(0);
  let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v));
  return { bytes: [...buf], peak, sec: data.length / ac.sampleRate, state: e.audio && ac.state };
}, file);
if (out) fs.writeFileSync(out, Buffer.from(r.bytes));
console.log({ kb: (r.bytes.length / 1024).toFixed(0), sekunden: r.sec.toFixed(1), spitze: r.peak.toFixed(3) });
await b.close();
process.exit(r.peak > 0.01 ? 0 : 1);
