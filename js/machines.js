// Die Konsolen-Familie: jede Kartridge sagt im Kopf, für welche Konsole sie gebaut ist (-- system: 16).
// Neuere Konsolen spielen ältere Kartridges (mittig im Rahmen), ältere lehnen neuere ab.
// Die Familie heißt einheitlich 8BOY, die Generation steht als Zahl dahinter (8BOY 16 … 8BOY 128).
export const MACHINES = {
  8: {
    id: 8, typ: 'YL-8', name: '8BOY', w: 240, h: 160, colors: 32, channels: 4, buttons: 8,
    label: 'PIXEL-LCD · 32 FARBEN · 4 KANÄLE', tagline: 'FANTASY HANDHELD',
  },
  16: {
    id: 16, typ: 'YL-16', name: '8BOY 16', w: 256, h: 224, colors: 256, channels: 8, buttons: 12, layers: 4,
    label: '256 FARBEN · PERSPEKTIVBODEN · 8 KANÄLE', tagline: 'FANTASY HANDHELD',
  },
  32: {
    id: 32, typ: 'YL-32', name: '8BOY 32', w: 320, h: 240, colors: 256, channels: 16, buttons: 12, layers: 4, three: true,
    label: '320×240 · 3D-POLYGONE · 16 KANÄLE', tagline: '3D FANTASY HANDHELD',
  },
  // Heimkonsole: eigener Grafikchip auf der echten Grafikkarte (js/gpu.js, WebGL2), Bild in 16:9 für den Fernseher
  64: {
    id: 64, typ: 'YL-64', name: '8BOY 64', w: 640, h: 360, colors: 256, channels: 16, buttons: 12, layers: 4, three: true, gpu: true, home: true,
    label: '640×360 · GPU · 64.000 DREIECKE · 8 LAMPEN', tagline: 'FANTASY HOME CONSOLE',
    maxTris: 64000, lamps: 8,
  },
  // 8BOY 128 (in Arbeit): HD-Generation – Materialien, HDR, Asset-Pakete; bleibt bis zur Freigabe verborgen
  128: {
    id: 128, typ: 'YL-128', name: '8BOY 128', w: 1280, h: 720, colors: 256, channels: 16, buttons: 12, layers: 4, three: true, gpu: true, home: true, giga: true,
    label: '1280×720 · HDR · 500.000 DREIECKE · ASSET-PAKETE', tagline: 'HD FANTASY HOME CONSOLE',
    maxTris: 500000, lamps: 8,
  },
};

export const machineFor = (id) => MACHINES[id] || MACHINES[8];
// Passt die Kartridge in den Schacht dieser Konsole?
export const fits = (cartSystem, machineId) => (cartSystem || 8) <= machineId;
