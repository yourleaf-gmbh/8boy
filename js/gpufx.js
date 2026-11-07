// 8BOY 64 Grafikchip, Stufe 2: die Effekte. Shader und Bausteine für js/gpu.js.
//   Nachbearbeitung (post3d): Das Bild entsteht erst in einer Textur (Render-to-Texture), danach rechnen kleine
//     Programme über jeden Bildpunkt: Glühen (Bloom), Farbe, Tönung, Vignette, Korn, Röhren-TV, Flimmern,
//     Tropfen auf der Linse, Tiefenunschärfe, Lichtstrahlen.
//   Partikel (part3d, emit3d, parts3d): tausende Teilchen in EINEM Zeichenaufruf (Instancing). Die Bahn rechnet
//     die GPU selbst aus Startpunkt, Tempo, Schwerkraft und Alter – die CPU schreibt nur neue Teilchen.
//   Schatten (shadow3d): die Welt noch einmal aus Sicht der Sonne in eine Tiefen-Textur (Shadow Map).
// Datenblatt: 16.384 Teilchen, 16 Teilchenarten, 16 Instanzlisten zu je 4.096, Schatten bis 2.048², 4 Qualitätsstufen.

export const FX_MAX_PARTS = 16384;
export const FX_PART_TYPES = 16;
export const FX_INST_LISTS = 16;
export const FX_INST_MAX = 4096;
export const FX_FORMS = ['punkt', 'quadrat', 'funke', 'ring', 'welle'];
export const FX_POST = ['gluehen', 'farbe', 'toenung', 'vignette', 'korn', 'roehre', 'flimmern', 'tropfen', 'unschaerfe', 'strahlen'];
// Qualitätsstufe → was der Chip sich leistet (fx3d)
export const FX_QUALITY = [
  { name: 'aus', post: false, shadow: 0, pcf: 0, parts: 2048, bloom: 0, rays: 0, dof: false },
  { name: 'niedrig', post: true, shadow: 1024, pcf: 0, parts: 8192, bloom: 4, rays: 20, dof: false },
  { name: 'hoch', post: true, shadow: 2048, pcf: 1, parts: 16384, bloom: 5, rays: 40, dof: true },
  { name: 'ultra', post: true, shadow: 2048, pcf: 2, parts: 16384, bloom: 6, rays: 64, dof: true },
];

// ---------------------------------------------------------------- Vollbild-Dreieck für die Nachbearbeitung
export const FULL_VS = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Helle Stellen herausfiltern (weiche Schwelle) und dabei auf halbe Größe bringen
export const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uSrc; uniform vec2 uTexel; uniform vec2 uThr; out vec4 o;
void main() {
  vec3 c = texture(uSrc, vUV + uTexel * vec2(-0.5, -0.5)).rgb + texture(uSrc, vUV + uTexel * vec2(0.5, -0.5)).rgb
         + texture(uSrc, vUV + uTexel * vec2(-0.5, 0.5)).rgb + texture(uSrc, vUV + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float b = max(c.r, max(c.g, c.b));
  // weiches Knie: knapp unter der Schwelle schon ein wenig, darüber voll
  float k = clamp(b - uThr.x + uThr.y, 0.0, 2.0 * uThr.y);
  k = k * k / (4.0 * uThr.y + 1e-4);
  float w = max(k, b - uThr.x) / max(b, 1e-4);
  o = vec4(c * w, 1.0);
}`;
// Verkleinern mit 4 Abtastungen (je 4 Bildpunkte dank linearem Filter)
export const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 o;
void main() {
  vec3 c = texture(uSrc, vUV).rgb * 4.0;
  c += texture(uSrc, vUV + uTexel * vec2(-1.0, -1.0)).rgb + texture(uSrc, vUV + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(uSrc, vUV + uTexel * vec2(-1.0, 1.0)).rgb + texture(uSrc, vUV + uTexel * vec2(1.0, 1.0)).rgb;
  o = vec4(c / 8.0, 1.0);
}`;
// Vergrößern mit Zeltfilter (9 Abtastungen) – wird auf die nächstgrößere Stufe addiert
export const UP_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uRadius; out vec4 o;
void main() {
  vec2 d = uTexel * uRadius;
  vec3 c = texture(uSrc, vUV).rgb * 4.0;
  c += (texture(uSrc, vUV + vec2(-d.x, 0.0)).rgb + texture(uSrc, vUV + vec2(d.x, 0.0)).rgb + texture(uSrc, vUV + vec2(0.0, -d.y)).rgb + texture(uSrc, vUV + vec2(0.0, d.y)).rgb) * 2.0;
  c += texture(uSrc, vUV - d).rgb + texture(uSrc, vUV + d).rgb + texture(uSrc, vUV + vec2(d.x, -d.y)).rgb + texture(uSrc, vUV + vec2(-d.x, d.y)).rgb;
  o = vec4(c / 16.0, 1.0);
}`;
// Lichtstrahlen: vom Himmel (Tiefe = ganz hinten) radial zur Sonne hin verwischen
export const RAYS_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uSrc; uniform sampler2D uDepth; uniform vec2 uSun; uniform int uSteps; uniform vec4 uRect; uniform float uThr; out vec4 o;
void main() {
  vec2 uv = vUV, stp = (uSun - uv) / float(uSteps) * 0.9;
  float w = 1.0, decay = 0.965;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= uSteps) break;
    vec2 q = clamp(uv, uRect.xy, uRect.xy + uRect.zw);
    float sky = step(0.99999, texture(uDepth, q).r);
    // nur die hellen Stellen des Himmels (Sonne, Halo) senden Strahlen – nicht der ganze Himmel
    vec3 c = max(texture(uSrc, q).rgb - vec3(uThr), vec3(0.0));
    acc += c * sky * w;
    w *= decay;
    uv += stp;
  }
  o = vec4(acc / float(uSteps) * 4.0, 1.0);
}`;

// 8BOY 128: Panorama (equirektangular wie aus Blender/Cycles) – Richtung der Welt → Bildkoordinate.
//   Welt x, y, z = Blender x, z, y: geradeaus (Blender +Y) liegt in der Bildmitte, oben am oberen Rand.
export const PANO_GLSL = `
vec2 panoUV(vec3 d) { d = normalize(d); return vec2(0.5 + atan(d.x, d.z) * 0.15915494, acos(clamp(d.y, -1.0, 1.0)) * 0.31830989); }`;

// 8BOY 128: Umgebungsverdeckung (SSAO, nach McGuire „Alchemy AO“) aus dem Tiefenbild, halbe Größe
export const AO_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uDepth; uniform vec2 uProj; uniform vec4 uRect; uniform vec2 uSize; uniform vec2 uP;   // Radius (Welt), Stärke
out vec4 o;
float linZ(float d) { float n = d * 2.0 - 1.0; return ${(2 * 2000 * 0.1).toFixed(1)} / (${(2000 + 0.1).toFixed(1)} - n * ${(2000 - 0.1).toFixed(1)}); }
vec3 viewPos(vec2 uv) {
  float z = linZ(texture(uDepth, uv).r);
  vec2 L = (uv - uRect.xy) / uRect.zw * 2.0 - 1.0;
  return vec3(L.x * z / uProj.x, L.y * z / uProj.y, z);
}
void main() {
  if (texture(uDepth, vUV).r >= 0.99999) { o = vec4(1.0); return; }
  vec3 P = viewPos(vUV);
  vec2 px = 1.0 / uSize;
  // Normale aus den Nachbarn – jeweils die Seite mit dem kleineren Tiefensprung (keine Kanten über Silhouetten)
  vec3 a1 = viewPos(vUV + vec2(px.x, 0.0)) - P, a2 = P - viewPos(vUV - vec2(px.x, 0.0));
  vec3 b1 = viewPos(vUV + vec2(0.0, px.y)) - P, b2 = P - viewPos(vUV - vec2(0.0, px.y));
  vec3 dx = abs(a1.z) < abs(a2.z) ? a1 : a2, dy = abs(b1.z) < abs(b2.z) ? b1 : b2;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, P) > 0.0) N = -N;
  // verschränktes Gradientenrauschen (Jimenez): gleichmäßig verteilt, verschwindet im Weichzeichnen
  float rnd = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
  float rs = uP.x * uProj.y / P.z * 0.5 * uRect.w;   // Radius auf dem Bildschirm (Anteil der Höhe)
  float asp = uSize.y / uSize.x, sum = 0.0;
  const int S = 12;
  for (int i = 0; i < S; i++) {
    float t = (float(i) + 0.5 + rnd * 0.5) / float(S);
    float ang = t * 6.2831853 * 3.0 + rnd * 6.2831853;
    vec2 q = clamp(vUV + vec2(cos(ang) * asp, sin(ang)) * rs * t, uRect.xy + px, uRect.xy + uRect.zw - px);
    vec3 v = viewPos(q) - P;
    float vv = dot(v, v);
    sum += max(0.0, dot(v, N) - 0.01 * P.z) / (vv + 0.02 * uP.x * uP.x) * step(vv, uP.x * uP.x * 4.0);
  }
  float ao = max(0.0, 1.0 - 2.0 * uP.y * uP.x * sum / float(S));
  o = vec4(vec3(ao * ao), 1.0);
}`;

// 8BOY 128: Himmel aus dem Panorama (statt Farbverlauf), ganz hinten
export const PANO_FS = `#version 300 es
precision highp float;
uniform vec4 uVP; uniform vec2 uProj; uniform vec4 uCamRot; uniform sampler2D uEnvTex; uniform float uK;
out vec4 o;
${PANO_GLSL}
void main() {
  vec2 ndc = (gl_FragCoord.xy - uVP.xy) / uVP.zw * 2.0 - 1.0;
  vec3 v = normalize(vec3(ndc.x / uProj.x, ndc.y / uProj.y, 1.0));
  float dy = v.y * uCamRot.z + v.z * uCamRot.w;
  float rz = -v.y * uCamRot.w + v.z * uCamRot.z;
  vec3 d = vec3(v.x * uCamRot.x - rz * uCamRot.y, dy, v.x * uCamRot.y + rz * uCamRot.x);
  o = vec4(pow(textureLod(uEnvTex, panoUV(d), 0.0).rgb, vec3(2.2)) * uK, 1.0);
}`;

// Zusammensetzen: alle Effekte in einem Durchgang, je Ausschnitt (geteilter Bildschirm) eigene Werte
// 8BOY 128: Kantenglättung nach dem Tone-Mapping (FXAA, nach Timothy Lottes, vereinfacht)
export const FXAA_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc; uniform vec2 uTexel;
out vec4 o;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 cNW = texture(uSrc, vUV + vec2(-1.0, -1.0) * uTexel).rgb, cNE = texture(uSrc, vUV + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 cSW = texture(uSrc, vUV + vec2(-1.0, 1.0) * uTexel).rgb, cSE = texture(uSrc, vUV + vec2(1.0, 1.0) * uTexel).rgb;
  vec3 cM = texture(uSrc, vUV).rgb;
  float lNW = luma(cNW), lNE = luma(cNE), lSW = luma(cSW), lSE = luma(cSE), lM = luma(cM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 a = 0.5 * (texture(uSrc, vUV + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uSrc, vUV + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture(uSrc, vUV - dir * 0.5).rgb + texture(uSrc, vUV + dir * 0.5).rgb);
  float lB = luma(b);
  o = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);
}`;

export const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene; uniform sampler2D uBloom; uniform sampler2D uRays; uniform sampler2D uBlur; uniform sampler2D uDepth;
uniform vec4 uRect;          // Ausschnitt in 0..1 (x, y von unten, w, h)
uniform vec2 uSize;          // Bildgröße in Pixeln
uniform float uTime;
uniform vec4 uBloomP;        // Stärke, an, -, -
uniform vec4 uColorP;        // Belichtung, Sättigung, Kontrast, an
uniform vec4 uTint;          // rgb, Anteil
uniform vec4 uLook;          // Vignette, Korn, Röhre, -
uniform vec4 uDist;          // Flimmern Stärke, Flimmern Tempo, Tropfen, -
uniform vec4 uDof;           // Fokus (Welt-Einheiten), Bereich, an, -
uniform vec4 uRaysP;         // Stärke, an, -, -
uniform vec3 uSunCol;
uniform int uTM;            // 8BOY 128: 1 = ACES-Tone-Mapping und Gamma (die Szene liegt in linearem HDR-Licht)
uniform sampler2D uAO; uniform vec4 uAOP;   // 8BOY 128: Umgebungsverdeckung – Stärke, an, Texel der halben Größe
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 17.31)); }
float linZ(float d) { float n = d * 2.0 - 1.0; return ${(2 * 2000 * 0.1).toFixed(1)} / (${(2000 + 0.1).toFixed(1)} - n * ${(2000 - 0.1).toFixed(1)}); }
// Wassertropfen auf der Linse: Zellen mit je einem Tropfen, der erscheint, verläuft und vergeht
vec3 drops(vec2 p, float t) {
  vec3 acc = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float sc = layer == 0 ? 7.0 : 13.0;
    vec2 q = p * sc * vec2(uSize.x / uSize.y, 1.0);
    vec2 cell = floor(q), f = fract(q) - 0.5;
    vec2 r = hash2(cell + float(layer) * 7.7);
    float life = fract(t * (0.12 + r.y * 0.1) + r.x);
    vec2 c = (r - 0.5) * 0.6 + vec2(0.0, -life * 0.25);
    vec2 d = f - c;
    float rad = (0.18 + r.y * 0.16) * (1.0 - life * 0.6);
    float m = smoothstep(rad, rad * 0.55, length(d * vec2(1.0, 0.8))) * smoothstep(1.0, 0.7, life) * step(0.35, r.x);
    acc.xy += d * m * 2.2;
    acc.z = max(acc.z, m);
  }
  return acc;
}
void main() {
  vec2 L = (vUV - uRect.xy) / uRect.zw;            // 0..1 im Ausschnitt
  vec2 uv = vUV;
  float crt = uLook.z;
  if (crt > 0.0) {
    // Röhren-TV: leicht gewölbt
    vec2 cc = L * 2.0 - 1.0;
    cc *= 1.0 + dot(cc, cc) * 0.06 * crt;
    if (abs(cc.x) > 1.0 || abs(cc.y) > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
    L = cc * 0.5 + 0.5;
    uv = uRect.xy + L * uRect.zw;
  }
  if (uDist.x > 0.0) {
    float t = uTime * uDist.y;
    uv += vec2(sin(L.y * 28.0 + t * 5.0) + sin(L.y * 61.0 - t * 3.1) * 0.4, cos(L.x * 23.0 + t * 4.3)) * uDist.x * 0.0035 * uRect.zw;
  }
  float dropMask = 0.0;
  if (uDist.z > 0.0) { vec3 dr = drops(L, uTime); uv -= dr.xy * 0.05 * uDist.z * uRect.zw; dropMask = dr.z * uDist.z; }
  uv = clamp(uv, uRect.xy + 0.5 / uSize, uRect.xy + uRect.zw - 0.5 / uSize);
  vec3 c;
  if (crt > 0.0) {
    vec2 sh = vec2(1.2 / uSize.x, 0.0) * crt;
    c = vec3(texture(uScene, uv + sh).r, texture(uScene, uv).g, texture(uScene, uv - sh).b);
  } else c = texture(uScene, uv).rgb;
  if (uDof.z > 0.5) {
    float z = linZ(texture(uDepth, uv).r);
    float coc = clamp(abs(z - uDof.x) / max(uDof.y, 0.01), 0.0, 1.0);
    c = mix(c, texture(uBlur, uv).rgb, coc);
  }
  if (uAOP.y > 0.5) {
    // Verdeckung tiefenbewusst weichzeichnen (3×3 auf halber Größe), dann nur auf die Szene, nicht aufs Glühen
    float dc = linZ(texture(uDepth, uv).r), s = 0.0, ws = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 q = uv + vec2(float(x), float(y)) * uAOP.zw * 1.5;
      float w = exp(-abs(linZ(texture(uDepth, q).r) - dc) / (dc * 0.04));
      s += texture(uAO, q).r * w; ws += w;
    }
    c *= mix(1.0, s / max(ws, 1e-4), uAOP.x);
  }
  if (uBloomP.y > 0.5) c += texture(uBloom, uv).rgb * uBloomP.x;
  if (uRaysP.y > 0.5) c += texture(uRays, uv).rgb * uRaysP.x * uSunCol;
  c += dropMask * 0.06;
  if (uTM == 1) {
    // ACES (Näherung nach Narkowicz), dann zurück in den Bildschirm-Farbraum
    // Belichtung wie bei einer Kamera: vor dem Tone-Mapping (post3d("farbe", belichtung))
    c *= 1.1 * (uColorP.w > 0.5 ? uColorP.x : 1.0);
    c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
    c = pow(c, vec3(1.0 / 2.2));
  }
  if (uColorP.w > 0.5) {
    if (uTM == 0) c *= uColorP.x;
    c = (c - 0.5) * uColorP.z + 0.5;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, uColorP.y);
  }
  if (uTint.w > 0.0) c = mix(c, c * uTint.rgb * 1.6, uTint.w);
  if (uLook.x > 0.0) { float r = length((L - 0.5) * vec2(1.15, 1.0)); c *= 1.0 - uLook.x * smoothstep(0.3, 0.85, r); }
  if (crt > 0.0) {
    float line = 0.5 + 0.5 * cos((L.y * uSize.y * uRect.w) * 3.14159265);
    c *= mix(1.0, 0.72 + 0.28 * line, crt);
    float m = mod(gl_FragCoord.x, 3.0);
    c *= mix(vec3(1.0), m < 1.0 ? vec3(1.08, 0.94, 0.94) : m < 2.0 ? vec3(0.94, 1.08, 0.94) : vec3(0.94, 0.94, 1.08), crt * 0.6);
  }
  if (uLook.y > 0.0) c += (hash(gl_FragCoord.xy + fract(uTime * 7.13) * 91.0) - 0.5) * uLook.y * 0.18;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// ---------------------------------------------------------------- Sonne am Himmel (nach dem Himmel, vor der Welt)
export const SUN_FS = `#version 300 es
precision highp float;
uniform vec4 uVP;            // Ausschnitt x, y (von unten), w, h in Pixeln
uniform vec2 uProj; uniform vec4 uCamRot; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec2 uSunP; uniform int uHdr;
out vec4 o;
void main() {
  vec2 ndc = (gl_FragCoord.xy - uVP.xy) / uVP.zw * 2.0 - 1.0;
  vec3 v = normalize(vec3(ndc.x / uProj.x, ndc.y / uProj.y, 1.0));
  // Blickrichtung zurück in die Welt (umgekehrt zu toView)
  float dy = v.y * uCamRot.z + v.z * uCamRot.w;
  float rz = -v.y * uCamRot.w + v.z * uCamRot.z;
  vec3 d = vec3(v.x * uCamRot.x - rz * uCamRot.y, dy, v.x * uCamRot.y + rz * uCamRot.x);
  float a = dot(normalize(d), uSunDir);
  float size = 0.018 * uSunP.x;
  float disc = smoothstep(cos(size), cos(size * 0.75), a);
  float halo = (pow(max(a, 0.0), 2500.0 / (uSunP.y + 0.01)) * 0.55 + pow(max(a, 0.0), 90.0) * 0.12) * uSunP.y;
  vec3 c = uSunCol * (disc * 1.8 + halo);
  if (uHdr == 0) c = min(c, vec3(1.0));
  o = vec4(c, 1.0);
}`;
export const SUN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 1.0, 1.0);   // ganz hinten: nur, wo noch Himmel ist
}`;

// ---------------------------------------------------------------- Partikel
export const PART_VS = `#version 300 es
precision highp float;
in vec2 aCorner;
in vec4 aA;   // Start x, y, z, Startzeit
in vec4 aB;   // Tempo x, y, z, Lebensdauer
in vec2 aC;   // Art, Zufall 0..1
uniform vec3 uCam; uniform vec4 uCamRot; uniform vec2 uProj; uniform float uTime; uniform int uAddPass;
uniform vec4 uPA[${FX_PART_TYPES}];   // Farbe am Anfang, Größe am Anfang
uniform vec4 uPB[${FX_PART_TYPES}];   // Farbe am Ende, Größe am Ende
uniform vec4 uPC[${FX_PART_TYPES}];   // Schwerkraft, Bremse, Boden, Boden an
uniform vec4 uPD[${FX_PART_TYPES}];   // Glanz, Form, additiv, Einblenden
out vec4 vCol; out vec2 vUV; flat out int vForm;
vec3 rotV(vec3 d) {
  float rx = d.x * uCamRot.x + d.z * uCamRot.y;
  float rz = -d.x * uCamRot.y + d.z * uCamRot.x;
  return vec3(rx, d.y * uCamRot.z - rz * uCamRot.w, d.y * uCamRot.w + rz * uCamRot.z);
}
void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); vUV = vec2(0.0); vForm = 0; }
void main() {
  int ty = int(aC.x + 0.5);
  vec4 A = uPA[ty], B = uPB[ty], C = uPC[ty], D = uPD[ty];
  float age = uTime - aA.w, life = aB.w;
  bool add = D.z > 0.5;
  if (life <= 0.0 || age < 0.0 || age > life || (uAddPass == 1) != add) { hide(); return; }
  float u = age / life;
  vec3 g = vec3(0.0, C.x, 0.0);
  float k = C.y;
  vec3 p, vel;
  if (k > 0.001) {
    float e = exp(-k * age);
    p = aA.xyz + (aB.xyz - g / k) * (1.0 - e) / k + g * age / k;
    vel = aB.xyz * e + g / k * (1.0 - e);
  } else {
    p = aA.xyz + aB.xyz * age + 0.5 * g * age * age;
    vel = aB.xyz + g * age;
  }
  if (C.w > 0.5 && p.y < C.z) { hide(); return; }
  float size = mix(A.w, B.w, u) * (0.7 + 0.6 * aC.y);
  int form = int(D.y + 0.5);
  vec3 view;
  if (form == 4) {
    // Welle: flacher Ring auf dem Boden (z. B. auf dem Wasser)
    view = rotV(p + vec3(aCorner.x, 0.0, aCorner.y) * size * 0.5 - uCam);
  } else {
    view = rotV(p - uCam);
    vec2 off = aCorner * size * 0.5;
    if (form == 2) {
      // Funke: in Flugrichtung gestreckt
      vec3 vv = rotV(vel);
      vec2 dir = vv.xy;
      float L = length(dir);
      if (L > 1e-4) {
        dir /= L;
        vec2 nrm = vec2(-dir.y, dir.x);
        off = dir * aCorner.x * max(size * 0.5, L * 0.035) + nrm * aCorner.y * size * 0.18;
      }
    }
    view.xy += off;
  }
  if (view.z < 0.1) { hide(); return; }
  gl_Position = vec4(view.x * uProj.x, view.y * uProj.y, (view.z * ${(2000 + 0.1).toFixed(1)} - ${(2 * 2000 * 0.1).toFixed(1)}) / ${(2000 - 0.1).toFixed(1)}, view.z);
  float fade = min(1.0, age * D.w) * (1.0 - u * u);
  vCol = vec4(mix(A.rgb, B.rgb, u) * D.x, fade);
  vUV = aCorner;
  vForm = form;
}`;
export const PART_FS = `#version 300 es
precision highp float;
precision highp int;
in vec4 vCol; in vec2 vUV; flat in int vForm; uniform int uAddPass; uniform int uHdr; out vec4 o;
void main() {
  float r = length(vUV), a;
  if (vForm == 1) a = 1.0;
  else if (vForm == 2) a = smoothstep(1.0, 0.2, abs(vUV.y)) * smoothstep(1.0, 0.5, abs(vUV.x));
  else if (vForm == 3 || vForm == 4) a = smoothstep(1.0, 0.86, r) * smoothstep(0.55, 0.78, r);
  else { a = smoothstep(1.0, 0.0, r); a *= a; }
  a *= vCol.a;
  if (a <= 0.003) discard;
  vec3 c = uHdr == 1 ? vCol.rgb : min(vCol.rgb, vec3(1.0));
  o = uAddPass == 1 ? vec4(c * a, 1.0) : vec4(c, a);
}`;

// ---------------------------------------------------------------- Schatten: Tiefe aus Sicht der Sonne
export const SHADOW_VS = `#version 300 es
precision highp float;
in vec3 aPos; in vec2 aUV; in vec4 aInst; in float aInstS;
uniform mat3 uRot; uniform vec3 uScale; uniform vec3 uTrans; uniform vec4 uWave; uniform int uInst;
uniform vec3 uShC; uniform vec3 uShR; uniform vec3 uShU; uniform vec3 uShF; uniform vec4 uShP;
out vec2 vUV;
#ifdef GIGA
in vec4 aJoint; in vec4 aWeight;
uniform int uSkin; uniform highp sampler2D uBones;
mat4 knochen(float j) { int i = int(j + 0.5); return mat4(texelFetch(uBones, ivec2(0, i), 0), texelFetch(uBones, ivec2(1, i), 0), texelFetch(uBones, ivec2(2, i), 0), texelFetch(uBones, ivec2(3, i), 0)); }
#endif
void main() {
  vec3 p0 = aPos;
#ifdef GIGA
  if (uSkin == 1) p0 = ((knochen(aJoint.x) * aWeight.x + knochen(aJoint.y) * aWeight.y + knochen(aJoint.z) * aWeight.z + knochen(aJoint.w) * aWeight.w) * vec4(aPos, 1.0)).xyz;
#endif
  vec3 w = uRot * (p0 * uScale);
  if (uInst == 1) { float c = cos(aInst.w), s = sin(aInst.w); w = vec3(w.x * c + w.z * s, w.y, -w.x * s + w.z * c) * aInstS + aInst.xyz; }
  w += uTrans;
  if (uWave.w > 0.5) w.y += uWave.x * (sin(w.x * uWave.y + uWave.z) + cos(w.z * uWave.y * 0.8 + uWave.z * 0.7)) * 0.5;
  vec3 d = w - uShC;
  gl_Position = vec4(dot(d, uShR) / uShP.x, dot(d, uShU) / uShP.x, dot(d, uShF) / uShP.y, 1.0);
  vUV = aUV;
}`;
export const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uTex; uniform int uTextured; uniform float uTile;
void main() { if (uTextured == 1 && texture(uTex, vUV * uTile).a < 0.5) discard; }`;

// Lichtrichtung → Basis der Schattenkarte (rechts, oben, vorwärts)
export function lightBasis(lx, ly, lz) {
  const F = [lx, ly, lz];
  let up = [0, 1, 0];
  if (Math.abs(ly) > 0.98) up = [0, 0, 1];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const R = norm(cross(F, up)), U = norm(cross(R, F));
  return { R, U, F };
}

// Kleiner, fester Zufallsgenerator: gleiche Partikel bei gleichem Ablauf (Tests, Wiederholungen)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
