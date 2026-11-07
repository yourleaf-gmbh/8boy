// Kleiner statischer Server ohne Abhängigkeiten: node tools/serve.mjs [port] [ordner, z. B. dist]
// Lauscht auf allen Schnittstellen, damit man vom Handy im WLAN testen kann.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..', process.argv[3] || '.');
const port = +process.argv[2] || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.lua': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.mp4': 'video/mp4',
};

// WLAN-Adressen dieses Rechners, beste zuerst: Läuft der Fernseher über localhost, braucht der QR-Code fürs Handy
// eine Adresse, die im Netz erreichbar ist (ohne Link-Local 169.254, virtuelle Adapter und VirtualBox 192.168.56.x nach hinten).
function lanIPs() {
  const out = [];
  for (const [name, ifs] of Object.entries(os.networkInterfaces())) for (const i of ifs) {
    if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue;
    const virt = /vEthernet|VirtualBox|VMware|WSL|docker|Hyper-V/i.test(name) || i.address.startsWith('192.168.56.');
    out.push({ ip: i.address, rang: virt ? 1 : 0 });
  }
  return out.sort((a, b) => a.rang - b.rang).map((x) => x.ip);
}

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/lan.json') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify({ ips: lanIPs(), port }));
    return;
  }
  // /g/… = Geschenk-Kartridges aus geschenke/ (wie server/lobby.mjs mit GESCHENKE_DIR, hier ohne Zähler)
  const rel = url.startsWith('/g/') ? url.replace(/^\/g\//, '/geschenke/') : url;
  let file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(root) || /[\\/](node_modules|\.git)[\\/]/.test(file)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
    // CORS offen: So kann eine zweite Instanz (z. B. 8boy-lernspiele auf anderem Port) als Katalog dienen
    const head = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
    // Teilbereiche, damit man in Videos springen kann
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      const start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]);
      const end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      if (start > end) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }).end(); return; }
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...head, 'content-length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, () => {
  console.log(`8BOY läuft auf http://localhost:${port}`);
  for (const ip of lanIPs()) console.log(`  im Netz:  http://${ip}:${port}`);
});
