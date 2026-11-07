// 8BOY 64 Grafikchip: dieselben 3D-Befehle wie beim 8BOY 32, aber gerechnet von der echten Grafikkarte (WebGL2).
// Unterschiede zum Software-Chip des 8BOY 32 (js/gfx3d.js) – genau das, was den Sprung zur GPU ausmacht:
//   - Tiefenspeicher in Hardware, Texturen perspektivisch korrekt (kein Verziehen), Eckpunkte ohne Einrasten
//   - Licht pro Pixel statt pro Eckpunkt, dazu bis zu 8 Lampen (lamp3d)
//   - Texturfilter umschaltbar: Pixel, glatt, Mipmaps (filter3d)
//   - Fehlersuche: Drahtgitter, Tiefenspeicher-Ansicht, Zähler (debug3d, stats3d)
//   - retro3d(true) holt zum Vergleich den PS1-Look zurück (Einrasten + affine Texturen)
// Stufe 2 (Effekte, Bausteine in js/gpufx.js): Nachbearbeitung über Render-to-Texture (post3d), Partikel mit Instancing
// (part3d, emit3d, parts3d), Instanzlisten (inst3d, drawi3d), Sonnenschatten (shadow3d), leuchtende, glänzende und
// additive Materialien (memit, mshine, madd), Wasser (mwater, caustic3d), Sonne und Bodennebel (sun3d, hfog3d),
// Qualitätsstufen (fx3d).
// Modell-Paket: echte Farben je Ecke (statt Palettennummer) und eine eigene Textur je Modell (modelload, js/model-pack.js).
// Festes Datenblatt wie bei einer echten Konsole: höchstens 64.000 Dreiecke und 8 Lampen je Bild, 16.384 Partikel.
// Das 3D-Bild liegt in einem eigenen Canvas; main.js legt das 2D-Bild (Farbe 0 = durchsichtig) darüber.
import { builtinModel, prepare, customModel } from './gfx3d.js';
import {
  FX_MAX_PARTS, FX_PART_TYPES, FX_INST_LISTS, FX_INST_MAX, FX_FORMS, FX_QUALITY, FX_POST,
  FULL_VS, BRIGHT_FS, DOWN_FS, UP_FS, RAYS_FS, COMP_FS, FXAA_FS, SUN_VS, SUN_FS, PART_VS, PART_FS, SHADOW_VS, SHADOW_FS, lightBasis, rng,
  AO_FS, PANO_FS, PANO_GLSL,
} from './gpufx.js';

const TRANSPARENT = 255;
const MAX_MODELS = 64;
export const GPU_MAX_TRIS = 64000;
export const GIGA_MAX_TRIS = 500000;
export const GPU_MAX_LAMPS = 8;
export { FX_MAX_PARTS };
const NEAR = 0.1, FAR = 2000;
// feste Plätze der Eckpunkt-Daten, damit alle Programme dieselben Modell-Puffer nutzen
const LOC = { aPos: 0, aNrm: 1, aUV: 2, aCol: 3, aBary: 4, aInst: 5, aInstS: 6, aJoint: 7, aWeight: 8, aUV2: 9 };

const VS = `#version 300 es
precision highp float;
precision highp int;
in vec3 aPos; in vec3 aNrm; in vec2 aUV; in float aCol; in vec3 aBary; in vec4 aInst; in float aInstS;
uniform mat3 uRot; uniform vec3 uScale; uniform vec3 uTrans;
uniform vec3 uCam; uniform vec4 uCamRot;   // cos(-gier), sin(-gier), cos(nick), sin(nick)
uniform vec2 uProj;                        // Brennweite / halbe Breite bzw. Höhe des Ausschnitts
uniform vec4 uWave;                        // Höhe, 2π/Länge, Phase, an
uniform int uMode;                         // 0 Modell, 1 Aufsteller, 2 Linie
uniform int uInst;                         // Instanzliste: je Instanz x, y, z, Gier und Größe
uniform vec3 uAnchor;
uniform vec4 uRetro;                       // an, Breite, Höhe des Ausschnitts
uniform sampler2D uPal;
uniform int uTextured;
out vec3 vWorld; out vec3 vNrm; out vec3 vUVw; out float vZ; out vec3 vBary; out vec3 vCol;
#ifdef GIGA
// 8BOY 128: Figuren mit Skelett – je Ecke bis zu 4 Knochen; Knochen-Matrizen als Textur (4 Texel je Knochen)
in vec4 aJoint; in vec4 aWeight;
uniform int uSkin; uniform highp sampler2D uBones;
mat4 knochen(float j) { int i = int(j + 0.5); return mat4(texelFetch(uBones, ivec2(0, i), 0), texelFetch(uBones, ivec2(1, i), 0), texelFetch(uBones, ivec2(2, i), 0), texelFetch(uBones, ivec2(3, i), 0)); }
in vec2 aUV2; out vec2 vUV2;   // Lightmap
#endif
// Farbe je Ecke: 0–255 = Palettennummer, negativ = echte Farbe -(0xRRGGBB + 1) (Modell-Paket)
vec3 colOf(float a) {
  if (a < -0.5) { int v = int(-a + 0.5) - 1; return vec3(float((v >> 16) & 255), float((v >> 8) & 255), float(v & 255)) / 255.0; }
  return texelFetch(uPal, ivec2(int(a + 0.5), 0), 0).rgb;
}
vec3 toView(vec3 p) {
  vec3 d = p - uCam;
  float rx = d.x * uCamRot.x + d.z * uCamRot.y;
  float rz = -d.x * uCamRot.y + d.z * uCamRot.x;
  return vec3(rx, d.y * uCamRot.z - rz * uCamRot.w, d.y * uCamRot.w + rz * uCamRot.z);
}
void main() {
  vec3 world, view;
  vec3 p0 = aPos, n0 = aNrm;
#ifdef GIGA
  if (uSkin == 1 && uMode == 0) {
    mat4 M = knochen(aJoint.x) * aWeight.x + knochen(aJoint.y) * aWeight.y + knochen(aJoint.z) * aWeight.z + knochen(aJoint.w) * aWeight.w;
    p0 = (M * vec4(aPos, 1.0)).xyz;
    n0 = mat3(M) * aNrm;
  }
#endif
  vec3 nrm = uMode == 0 ? uRot * (n0 / uScale) : vec3(0.0, 1.0, 0.0);
  if (uMode == 1) {
    world = uAnchor;
    view = toView(uAnchor);
    view.xy += aPos.xy;
  } else {
    if (uMode == 2) world = aPos;
    else {
      world = uRot * (p0 * uScale);
      if (uInst == 1) {
        float c = cos(aInst.w), s = sin(aInst.w);
        world = vec3(world.x * c + world.z * s, world.y, -world.x * s + world.z * c) * aInstS + aInst.xyz;
        nrm = vec3(nrm.x * c + nrm.z * s, nrm.y, -nrm.x * s + nrm.z * c);
      }
      world += uTrans;
    }
    if (uWave.w > 0.5) world.y += uWave.x * (sin(world.x * uWave.y + uWave.z) + cos(world.z * uWave.y * 0.8 + uWave.z * 0.7)) * 0.5;
    view = toView(world);
  }
  vec4 clip = vec4(view.x * uProj.x, view.y * uProj.y, (view.z * ${(FAR + NEAR).toFixed(1)} - ${(2 * FAR * NEAR).toFixed(1)}) / ${(FAR - NEAR).toFixed(1)}, view.z);
  if (uMode == 2) clip.z -= 0.002 * clip.w;   // Linien liegen knapp vor den Flächen
  if (uRetro.x > 0.5 && clip.w > 0.0) {
    // PS1-Look: Eckpunkte rasten auf ganze Pixel ein
    vec2 px = floor((clip.xy / clip.w * 0.5 + 0.5) * uRetro.yz + 0.5);
    clip.xy = ((px / uRetro.yz) * 2.0 - 1.0) * clip.w;
  }
  gl_Position = clip;
  vWorld = world;
  // Normalen mit der Streckung umrechnen (gespiegelte Modelle: Normale spiegelt mit)
  vNrm = nrm;
  // affin (PS1) = im Bild linear: uv·w und w mitgeben, im Fragment teilen
  vUVw = uRetro.x > 0.5 ? vec3(aUV * clip.w, clip.w) : vec3(aUV, 1.0);
  vZ = view.z;
  vBary = aBary;
  vCol = uTextured == 1 ? vec3(1.0) : colOf(aCol);   // 2 = Modell-Textur × Eckfarbe
#ifdef GIGA
  vUV2 = aUV2;
#endif
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 vWorld; in vec3 vNrm; in vec3 vUVw; in float vZ; in vec3 vBary; in vec3 vCol;
uniform sampler2D uTex; uniform int uTextured; uniform float uTile; uniform int uFlip;
uniform int uGlow; uniform vec4 uLight;
uniform int uLamps; uniform vec4 uLampPos[${GPU_MAX_LAMPS}]; uniform vec3 uLampCol[${GPU_MAX_LAMPS}];
uniform vec4 uFog; uniform vec3 uFogCol;
uniform float uAlpha; uniform int uWaveN; uniform int uDebug; uniform int uMode; uniform int uBoth; uniform vec3 uCam;
// Stufe 2
uniform int uHdr; uniform float uTime; uniform float uEmit; uniform vec2 uShine; uniform vec3 uSunCol;
uniform int uWater; uniform vec4 uWaterP; uniform vec4 uWave; uniform vec3 uSkyT; uniform vec3 uSkyB;
uniform vec4 uCaus; uniform vec4 uHFog; uniform vec3 uHFogCol;
uniform int uGiga; uniform sampler2D uNormTex; uniform sampler2D uRMTex; uniform ivec2 uMatTex; uniform vec4 uMat; uniform vec3 uMatTon;
uniform int uShadow; uniform highp sampler2DShadow uShMap; uniform vec3 uShC; uniform vec3 uShR; uniform vec3 uShU; uniform vec3 uShF; uniform vec4 uShP; uniform int uPcf;
out vec4 outColor;
// Sonnenschatten: wie tief liegt dieser Punkt aus Sicht der Sonne? Mehrere Proben = weiche Kanten
float sunVis(vec3 n, float ndl) {
  if (uShadow == 0) return 1.0;
  vec3 p = vWorld + n * uShP.w * 1.2;
  vec3 d = p - uShC;
  vec3 lp = vec3(dot(d, uShR), dot(d, uShU), dot(d, uShF));
  vec2 uv = lp.xy / uShP.x * 0.5 + 0.5;
  float edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
  if (edge > 0.5) return 1.0;
  float z = lp.z / uShP.y * 0.5 + 0.5 - (uShP.w * (1.0 + 2.5 * (1.0 - ndl))) / (2.0 * uShP.y);
  vec2 ts = vec2(1.0 / float(textureSize(uShMap, 0).x));
  float s = 0.0, n2 = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    if (abs(x) > uPcf || abs(y) > uPcf) continue;
    s += texture(uShMap, vec3(uv + vec2(x, y) * ts * 1.25, z));
    n2 += 1.0;
  }
  float v = s / n2;
  v = mix(v, 1.0, smoothstep(0.42, 0.5, edge));
  return mix(1.0, v, uShP.z);
}
// Lichtmuster am Grund unter Wasser (Kaustik)
float caustic(vec2 p, float t) {
  float a = sin(p.x * 2.1 + t * 1.3 + sin(p.y * 1.7 + t)) + sin(p.y * 2.3 - t * 1.1 + sin(p.x * 1.9 - t * 0.8));
  float b = sin((p.x + p.y) * 1.6 + t * 0.9) + sin((p.x - p.y) * 1.8 - t * 1.2);
  float c = 1.0 - abs(a * 0.5) * abs(b * 0.5);
  return pow(clamp(c, 0.0, 1.0), 6.0);
}

#ifdef GIGA
// 8BOY 128: Materialien in linearem Licht (HDR) – GGX-Glanz, Fresnel, Umgebung aus dem Himmelsverlauf oder Panorama
in vec2 vUV2;
uniform sampler2D uLMTex; uniform vec4 uLMP;       // Lightmap: an, Stärke
uniform sampler2D uEnvTex; uniform vec4 uEnvP;     // Umgebungs-Panorama: an, Stärke, Mip-Stufen
uniform vec4 uCasC[3]; uniform vec4 uCasP[3]; uniform int uCasN; uniform int uCasDbg;   // Schatten-Kaskaden: Mitte; Ausdehnung, Tiefe, Texel
const float PI = 3.14159265;
vec3 lin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
${PANO_GLSL}
vec3 skyGrad(vec3 d) { return mix(lin(uSkyB), lin(uSkyT), clamp(d.y * 0.5 + 0.5, 0.0, 1.0)); }
// Umgebung in Richtung d, je rauer desto unschärfer (höhere Mip-Stufe des Panoramas)
vec3 envAt(vec3 d, float rough) { return uEnvP.x > 0.5 ? lin(textureLod(uEnvTex, panoUV(d), rough * uEnvP.z).rgb) * uEnvP.y : skyGrad(d); }
// diffuses Umgebungslicht: fünf Proben um die Normale auf einer groben Stufe (16×8 bei 1024×512) – oben ≠ unten
vec3 skyEnv(vec3 n) {
  if (uEnvP.x < 0.5) return skyGrad(n);
  vec3 t = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), b = cross(n, t);
  float l = max(uEnvP.z - 3.0, 0.0);
  vec3 s = lin(textureLod(uEnvTex, panoUV(n), l).rgb) * 2.0;
  s += lin(textureLod(uEnvTex, panoUV(n + t), l).rgb) + lin(textureLod(uEnvTex, panoUV(n - t), l).rgb);
  s += lin(textureLod(uEnvTex, panoUV(n + b), l).rgb) + lin(textureLod(uEnvTex, panoUV(n - b), l).rgb);
  return s / 6.0 * uEnvP.y;
}
// Kaskadierte Sonnenschatten: drei Karten nebeneinander, nah = fein, fern = grob; die feinste, die den Punkt enthält
float sunVisCas(vec3 n, float ndl, out int ci) {
  ci = -1;
  if (uShadow == 0) return 1.0;
  float ts = 1.0 / float(textureSize(uShMap, 0).y);
  for (int i = 0; i < 3; i++) {
    if (i >= uCasN) break;
    vec4 Cc = uCasC[i], Pp = uCasP[i];
    vec3 d = vWorld + n * Pp.z * 1.5 - Cc.xyz;
    vec3 lp = vec3(dot(d, uShR), dot(d, uShU), dot(d, uShF));
    vec2 uv = lp.xy / Pp.x * 0.5 + 0.5;
    float edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
    if (edge > 0.47 && i < uCasN - 1) continue;
    if (edge > 0.5) return 1.0;
    ci = i;
    float z = lp.z / Pp.y * 0.5 + 0.5 - (Pp.z * (1.0 + 2.5 * (1.0 - ndl))) / (2.0 * Pp.y);
    float s = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 q = clamp(uv + vec2(float(x), float(y)) * ts * 1.25, ts, 1.0 - ts);
      s += texture(uShMap, vec3((q.x + float(i)) / float(uCasN), q.y, z));
    }
    float v = s / 9.0;
    if (i == uCasN - 1) v = mix(v, 1.0, smoothstep(0.42, 0.5, edge));
    return mix(1.0, v, uShP.z);
  }
  return 1.0;
}
// Normal-Map ohne Tangenten: Bezugssystem aus den Ableitungen von Position und UV (Schüler, „Normal Mapping Without Precomputed Tangents“)
vec3 normalAusMap(vec3 n, vec3 p, vec2 uv, vec3 m) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 du1 = dFdx(uv), du2 = dFdy(uv);
  vec3 dp2p = cross(dp2, n), dp1p = cross(n, dp1);
  vec3 T = dp2p * du1.x + dp1p * du2.x;
  vec3 B = dp2p * du1.y + dp1p * du2.y;
  float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  return normalize(mat3(T * inv, B * inv, n) * m);
}
float ggxD(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float smithV(float nl, float nv, float a) { float k = a * 0.5; return 0.25 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k)); }
vec3 brdf(vec3 n, vec3 v, vec3 l, vec3 alb, float rough, float metal) {
  vec3 h = normalize(l + v);
  float nl = max(dot(n, l), 0.0), nv = max(dot(n, v), 1e-3), nh = max(dot(n, h), 0.0), vh = max(dot(v, h), 0.0);
  float a = max(rough * rough, 0.002);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - vh, 5.0);
  vec3 spec = ggxD(nh, a) * smithV(nl, nv, a) * F;
  vec3 diff = (1.0 - F) * (1.0 - metal) * alb / PI;
  return (diff + spec) * nl;
}
#endif
void main() {
  vec3 base = vCol;
  float alpha = uAlpha;
  if (uTextured >= 1) {
    vec2 uv = vUVw.xy / vUVw.z;
    if (uFlip == 1) uv.x = 1.0 - uv.x;
    vec4 t = texture(uTex, uv * uTile);
    if (t.a < 0.5) discard;
    base *= t.rgb;
  }
  vec3 c = base;
  vec3 sunCol = uSunCol;
#ifdef GIGA
  // 8BOY 128: HD-Meer – große Wellen (mwave) plus feine aus vier Richtungen, Spiegelung aus Panorama/Himmel (Fresnel),
  //   Streulicht in den Kämmen, Schaum auf den Spitzen, scharfer Sonnenglanz; alles in linearem Licht
  if (uGiga == 1 && uMode == 0 && uWater == 1 && uDebug == 0) {
    vec3 n = vec3(0.0, 1.0, 0.0);
    float kamm = 0.0;
    if (uWave.w > 0.5) {
      float k = uWave.y, ph = uWave.z, A = uWave.x * 0.5;
      n = normalize(vec3(-A * k * cos(vWorld.x * k + ph), 1.0, A * k * 0.8 * sin(vWorld.z * k * 0.8 + ph * 0.7)));
      kamm = (sin(vWorld.x * k + ph) + cos(vWorld.z * k * 0.8 + ph * 0.7)) * 0.5;
    }
    float t = uTime;
    vec2 q = vWorld.xz, g = vec2(0.0);
    // sechs Wellenzüge mit krummen Längen und leicht verbogenen Fronten – kein sichtbares Muster
    const vec2 D1 = vec2(0.8, 0.6), D2 = vec2(-0.5, 0.86), D3 = vec2(0.96, -0.28), D4 = vec2(-0.2, -0.98), D5 = vec2(0.42, 0.91), D6 = vec2(-0.93, -0.37);
    vec2 qb = q + vec2(sin(q.y * 0.11 + t * 0.2), cos(q.x * 0.13 - t * 0.17)) * 3.0;
    g += D1 * cos(dot(qb, D1) * 0.73 + t * 1.2) * 0.20;
    g += D2 * cos(dot(qb, D2) * 1.37 - t * 1.7) * 0.15;
    g += D3 * cos(dot(q, D3) * 2.31 + t * 2.3) * 0.10;
    g += D4 * cos(dot(qb, D4) * 3.71 - t * 2.9) * 0.07;
    g += D5 * cos(dot(q, D5) * 5.93 + t * 3.6) * 0.045;
    g += D6 * cos(dot(qb, D6) * 9.17 - t * 4.4) * 0.03;
    float nah = exp(-vZ / 70.0);                     // feine Wellen in der Ferne ausblenden (kein Flimmern)
    n = normalize(n + vec3(-g.x, 0.0, -g.y) * uWaterP.z * (0.25 + 0.75 * nah));
    vec3 V = normalize(uCam - vWorld);
    float nv = max(dot(n, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
    vec3 R = reflect(-V, n); R.y = abs(R.y);
    vec3 refl = envAt(R, 0.02);
    vec3 L = normalize(-uLight.xyz);
    float ndl = max(dot(n, L), 0.0);
    int ci;
    float vis = sunVisCas(n, ndl, ci);
    vec3 sonne = lin(sunCol) * (1.0 - uLight.w) * 1.6;
    vec3 wasser = lin(base);
    vec3 koerper = wasser * (skyEnv(vec3(0.0, 1.0, 0.0)) * 0.35 + sonne * (0.15 + 0.35 * ndl) * vis);
    // Streulicht: Licht scheint durch die dünnen Kämme (vor allem gegen die Sonne gesehen)
    float sss = pow(max(dot(V, -L), 0.0), 3.0) * 0.6 + 0.25;
    koerper += wasser * sonne * max(kamm, 0.0) * sss * 0.9 * vis;
    vec3 col = mix(koerper, refl * uWaterP.x, F);
    col += sonne * (pow(max(dot(R, L), 0.0), 900.0) * 40.0 + pow(max(dot(R, L), 0.0), 80.0) * 0.6) * vis;
    for (int i = 0; i < ${GPU_MAX_LAMPS}; i++) {
      if (i >= uLamps) break;
      vec3 d = uLampPos[i].xyz - vWorld;
      float dist = length(d), att = clamp(1.0 - dist / uLampPos[i].w, 0.0, 1.0);
      col += wasser * lin(uLampCol[i]) * att * att + lin(uLampCol[i]) * att * pow(max(dot(R, d / max(dist, 1e-4)), 0.0), 80.0) * 3.0;
    }
    // Schaum auf den Wellenspitzen: weiß, vom Himmel und der Sonne beleuchtet
    float schaum = smoothstep(0.62, 0.95, kamm + (g.x + g.y) * 0.9 * nah) * 0.55;
    col = mix(col, (skyEnv(vec3(0.0, 1.0, 0.0)) * 0.6 + sonne * (0.4 + 0.6 * ndl) * vis) * 0.85, schaum);
    if (uHFog.z > 0.5) {
      float f = (1.0 - exp(-vZ * uHFog.y)) * clamp(exp(-(vWorld.y - uHFog.x) * uHFog.w), 0.0, 1.0);
      col = mix(col, lin(uHFogCol), f);
    }
    if (uFog.z > 0.5) col = mix(col, lin(uFogCol), clamp((vZ - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0));
    outColor = vec4(max(col, vec3(0.0)), mix(uWaterP.y, 1.0, max(F, schaum)));
    return;
  }
  // 8BOY 128: physikalisch basiertes Licht für Modelle (Wasser, Leuchtendes, Linien und Fehlersuche wie gehabt)
  if (uGiga == 1 && uMode == 0 && uGlow == 0 && uWater == 0 && uDebug == 0) {
    vec3 alb = lin(base) * lin(uMatTon);
    vec2 uvg = vUVw.xy / vUVw.z * uTile;
    vec3 n = normalize(vNrm);
    if (uBoth == 1 && dot(n, uCam - vWorld) < 0.0) n = -n;
    if (uMatTex.x == 1) {
      vec3 m = texture(uNormTex, uvg).xyz * 2.0 - 1.0;
      m.xy *= uMat.z;
      n = normalAusMap(n, vWorld, uvg, normalize(m));
    }
    float rough = uMat.x, metal = uMat.y;
    if (uMatTex.y == 1) { vec4 rm = texture(uRMTex, uvg); rough *= rm.g; metal *= rm.b; }
    rough = clamp(rough, 0.04, 1.0);
    vec3 V = normalize(uCam - vWorld);
    vec3 L = normalize(-uLight.xyz);
    int ci;
    float vis = sunVisCas(n, max(dot(n, L), 0.0), ci);
    vec3 sun = lin(sunCol) * PI * (1.0 - uLight.w) * 1.6;
    vec3 col = brdf(n, V, L, alb, rough, metal) * sun * vis;
    for (int i = 0; i < ${GPU_MAX_LAMPS}; i++) {
      if (i >= uLamps) break;
      vec3 d = uLampPos[i].xyz - vWorld;
      float dist = length(d);
      float att = clamp(1.0 - dist / uLampPos[i].w, 0.0, 1.0);
      col += brdf(n, V, d / max(dist, 1e-4), alb, rough, metal) * lin(uLampCol[i]) * PI * att * att;
    }
    // Umgebung: diffus aus dem Himmel über der Normalen, Glanz aus der Spiegelrichtung (je rauer, desto weicher)
    vec3 F0 = mix(vec3(0.04), alb, metal);
    float nv = max(dot(n, V), 0.0);
    vec3 Fr = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - nv, 5.0);
    vec3 R = reflect(-V, n);
    vec3 envSpec = uEnvP.x > 0.5 ? envAt(R, rough) : mix(skyEnv(R), skyEnv(n), rough * rough);
    // Lightmap (aus Blender gebacken): ersetzt das diffuse Umgebungslicht und verdeckt Spiegelungen in Ecken
    vec3 amb = skyEnv(n) * uLight.w * 1.3;
    float occ = 1.0;
    if (uLMP.x > 0.5) { amb = lin(texture(uLMTex, vUV2).rgb) * uLMP.y; occ = clamp(dot(amb, vec3(0.3333)) / max(uLMP.y * 0.25, 1e-3), 0.25, 1.0); }
    col += (1.0 - Fr) * (1.0 - metal) * alb * amb + Fr * envSpec * (uEnvP.x > 0.5 ? 1.0 : uLight.w * 1.3) * (0.5 + 0.5 * vis) * occ;
    col += alb * uEmit * 2.0;
    if (uHFog.z > 0.5) {
      float f = (1.0 - exp(-vZ * uHFog.y)) * clamp(exp(-(vWorld.y - uHFog.x) * uHFog.w), 0.0, 1.0);
      col = mix(col, lin(uHFogCol), f);
    }
    if (uFog.z > 0.5) col = mix(col, lin(uFogCol), clamp((vZ - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0));
    if (uCasDbg == 1 && ci >= 0) col = mix(col, ci == 0 ? vec3(1.0, 0.15, 0.1) : ci == 1 ? vec3(0.1, 1.0, 0.2) : vec3(0.15, 0.3, 1.0), 0.35);
    outColor = vec4(max(col, vec3(0.0)), alpha);
    return;
  }
#endif
  if (uMode == 0 && uWater == 1) {
    // Wasser: Wellen-Normale, Spiegelung des Himmels (Fresnel), Glitzern der Sonne
    vec3 n = vec3(0.0, 1.0, 0.0);
    if (uWave.w > 0.5) {
      float k = uWave.y, ph = uWave.z, A = uWave.x * 0.5;
      n = normalize(vec3(-A * k * cos(vWorld.x * k + ph), 1.0, A * k * 0.8 * sin(vWorld.z * k * 0.8 + ph * 0.7)));
    }
    float t = uTime;
    vec2 q = vWorld.xz;
    n.xz += vec2(sin(q.x * 3.1 + t * 2.0) + sin((q.x + q.y) * 5.3 - t * 2.7) * 0.5, cos(q.y * 2.7 - t * 1.7) + sin((q.y - q.x) * 4.9 + t * 2.3) * 0.5) * 0.06 * uWaterP.z;
    n = normalize(n);
    vec3 V = normalize(uCam - vWorld);
    float ndv = max(dot(n, V), 0.0);
    float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, n);
    vec3 sky = mix(uSkyB, uSkyT, clamp(R.y * 1.6 + 0.15, 0.0, 1.0));
    float ndl = max(0.0, -dot(n, uLight.xyz));
    float vis = sunVis(n, ndl);
    vec3 deep = base * (uLight.w + (1.0 - uLight.w) * ndl * 0.7 * vis);
    for (int i = 0; i < ${GPU_MAX_LAMPS}; i++) {
      if (i >= uLamps) break;
      vec3 d = uLampPos[i].xyz - vWorld;
      float dist = length(d);
      float att = clamp(1.0 - dist / uLampPos[i].w, 0.0, 1.0);
      deep += base * uLampCol[i] * att * att;
      // Lampen spiegeln sich im Wasser
      deep += uLampCol[i] * att * pow(max(dot(R, d / max(dist, 0.0001)), 0.0), 60.0) * 1.5;
    }
    c = mix(deep, sky, fres * uWaterP.x);
    c += sunCol * pow(max(dot(R, -uLight.xyz), 0.0), 220.0) * 5.0 * vis;
    alpha = mix(uWaterP.y, 1.0, fres);
  } else if (uMode == 0 && uGlow == 0) {
    vec3 n = normalize(vNrm);
    if (uWaveN == 1) { n = normalize(cross(dFdx(vWorld), dFdy(vWorld))); if (n.y < 0.0) n = -n; }
    // beidseitige Flächen: die Seite, die wir sehen, bekommt das Licht
    else if (uBoth == 1 && dot(n, uCam - vWorld) < 0.0) n = -n;
    float ndl = max(0.0, -dot(n, uLight.xyz));
    float vis = sunVis(n, ndl);
    float L = uLight.w + (1.0 - uLight.w) * ndl * vis;
    vec3 lamp = vec3(0.0), spec = vec3(0.0);
    vec3 V = normalize(uCam - vWorld);
    for (int i = 0; i < ${GPU_MAX_LAMPS}; i++) {
      if (i >= uLamps) break;
      vec3 d = uLampPos[i].xyz - vWorld;
      float dist = length(d);
      float att = clamp(1.0 - dist / uLampPos[i].w, 0.0, 1.0);
      vec3 ld = d / max(dist, 0.0001);
      lamp += uLampCol[i] * att * att * max(0.0, dot(n, ld));
      if (uShine.x > 0.0) spec += uLampCol[i] * att * pow(max(dot(n, normalize(ld + V)), 0.0), uShine.y) * uShine.x;
    }
    c = base * L + base * lamp;
    if (uShine.x > 0.0) c += spec + sunCol * pow(max(dot(n, normalize(-uLight.xyz + V)), 0.0), uShine.y) * uShine.x * vis * step(0.0, ndl - 0.001);
    if (uCaus.z > 0.5 && vWorld.y < uCaus.x) c += base * caustic(vWorld.xz * 1.3, uTime * 1.6) * uCaus.y * (0.4 + 0.6 * vis) * clamp((uCaus.x - vWorld.y) * 3.0, 0.0, 1.0);
  }
  c += base * uEmit;
  if (uHFog.z > 0.5 && uMode != 2) {
    float f = (1.0 - exp(-vZ * uHFog.y)) * clamp(exp(-(vWorld.y - uHFog.x) * uHFog.w), 0.0, 1.0);
    c = mix(c, uHFogCol, f);
  }
  if (uFog.z > 0.5 && uMode != 2) c = mix(c, uFogCol, clamp((vZ - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0));
  if (uDebug == 1) {
    // Drahtgitter: nur die Kanten jedes Dreiecks
    float e = min(min(vBary.x, vBary.y), vBary.z);
    float w = fwidth(e) * 1.2;
    c = e < w ? mix(vec3(0.35, 1.0, 0.55), base, 0.25) : vec3(0.03, 0.05, 0.08);
    alpha = uAlpha;
  } else if (uDebug == 2) {
    float g = 1.0 - clamp(vZ / 40.0, 0.0, 1.0);
    c = vec3(g);
    alpha = uAlpha;
  }
#ifdef GIGA
  if (uGiga == 1) c = lin(c);
#endif
  outColor = vec4(uHdr == 1 ? max(c, vec3(0.0)) : min(c, vec3(1.0)), alpha);
}`;

const SKY_VS = `#version 300 es
in vec2 aPos; out float vT;
void main() { vT = aPos.y * -0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
in float vT; uniform vec3 uTop; uniform vec3 uBottom; uniform int uGiga; out vec4 outColor;
void main() { vec3 c = mix(uTop, uBottom, vT); outColor = vec4(uGiga == 1 ? pow(c, vec3(2.2)) : c, 1.0); }`;

function compile(gl, vs, fs, attribs = LOC) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  for (const [n, i] of Object.entries(attribs)) gl.bindAttribLocation(p, i, n);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Programm: ' + gl.getProgramInfoLog(p));
  return p;
}

// Gibt es WebGL2? Ohne Grafikkarte (oder mit abgeschaltetem WebGL) läuft der 8BOY 64 nicht.
export function createGpu(canvas) {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, preserveDrawingBuffer: true, premultipliedAlpha: false }); } catch { gl = null; }
  if (!gl) return { ok: false };
  let progs;
  try {
    progs = {
      mesh: compile(gl, VS, FS), meshGiga: compile(gl, VS.replace('#version 300 es\n', '#version 300 es\n#define GIGA\n'), FS.replace('#version 300 es\n', '#version 300 es\n#define GIGA\n')), sky: compile(gl, SKY_VS, SKY_FS, { aPos: 0 }),
      sun: compile(gl, SUN_VS, SUN_FS, {}), part: compile(gl, PART_VS, PART_FS, { aCorner: 0, aA: 1, aB: 2, aC: 3 }),
      shadow: compile(gl, SHADOW_VS, SHADOW_FS), shadowGiga: compile(gl, SHADOW_VS.replace('#version 300 es\n', '#version 300 es\n#define GIGA\n'), SHADOW_FS),
      bright: compile(gl, FULL_VS, BRIGHT_FS, {}), down: compile(gl, FULL_VS, DOWN_FS, {}), up: compile(gl, FULL_VS, UP_FS, {}),
      rays: compile(gl, FULL_VS, RAYS_FS, {}), comp: compile(gl, FULL_VS, COMP_FS, {}), fxaa: compile(gl, FULL_VS, FXAA_FS, {}),
      ao: compile(gl, FULL_VS, AO_FS, {}), pano: compile(gl, SUN_VS, PANO_FS, {}),
    };
  } catch (e) { return { ok: false, error: e.message }; }
  const renderer = (() => {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  })();
  return { ok: true, gl, canvas, renderer, attach: (ctx) => attachGpu(gl, canvas, progs, ctx, renderer) };
}

// Startwert der Qualitätsstufe: ?fx=0..3 in der Adresse, sonst nach Gerät (CPU-Nachbildung und Handys: niedrig)
function defaultQuality(renderer) {
  const m = /[?&]fx=([0-3])\b/.exec(globalThis.location?.search || '');
  if (m) return +m[1];
  if (/swiftshader|llvmpipe|software/i.test(renderer || '')) return 1;
  if ((globalThis.navigator?.maxTouchPoints || 0) > 0 && Math.min(globalThis.screen?.width || 9999, globalThis.screen?.height || 9999) < 900) return 1;
  return 2;
}

function attachGpu(gl, canvas, P, ctx, renderer) {
  // 8BOY 128 (1280×720): HD-Generation – Materialien, HDR immer an, ACES, FXAA, 500.000 Dreiecke
  const giga = () => ctx.W >= 1280;
  const maxTris = () => (giga() ? GIGA_MAX_TRIS : GPU_MAX_TRIS);
  // 8BOY 128 rechnet mit der 128er-Fassung des Shaders (gewählt bei jedem Zurücksetzen, also beim Konsolenwechsel)
  let prog = P.mesh;
  const skyProg = P.sky;
  const UC = new WeakMap();
  const uni = (p, n) => {
    let c = UC.get(p);
    if (!c) { c = {}; UC.set(p, c); }
    if (!(n in c)) c[n] = gl.getUniformLocation(p, n);
    return c[n];
  };
  const STRIDE = 12 * 4;   // pos 3, normal 3, uv 2, farbe 1, baryzentrisch 3
  const floatOK = !!gl.getExtension('EXT_color_buffer_float');

  function makeVAO(data, usage = gl.STATIC_DRAW) {
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const at = (loc, n, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, STRIDE, off * 4); };
    at(LOC.aPos, 3, 0); at(LOC.aNrm, 3, 3); at(LOC.aUV, 2, 6); at(LOC.aCol, 1, 8); at(LOC.aBary, 3, 9);
    gl.bindVertexArray(null);
    return { vao, buf };
  }

  // Himmel: ein Rechteck über den ganzen Bildschirm
  const skyVAO = gl.createVertexArray(), skyBuf = gl.createBuffer();
  gl.bindVertexArray(skyVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const emptyVAO = gl.createVertexArray();   // Vollbild-Dreieck aus gl_VertexID

  // Aufsteller und Linien: kleine Puffer, die je Aufruf neu befüllt werden
  const quad = makeVAO(new Float32Array(6 * 12), gl.DYNAMIC_DRAW);
  const lineVAO = makeVAO(new Float32Array(2 * 12), gl.DYNAMIC_DRAW);
  const quadData = new Float32Array(6 * 12), lineData = new Float32Array(2 * 12);

  // Palette als 256×1-Textur (mit pal()-Umfärbungen), damit Modellfarben live mitgehen
  const palTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, palTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const palBytes = new Uint8Array(256 * 4), palSeen = new Int32Array(256).fill(-1);
  let palVersion = 0;
  const palRGB = (c) => { const p = ctx.palette, r = ctx.remap; return p[r[c] ?? c] ?? p[c] ?? 0; };
  function syncPalette() {
    const n = ctx.palette.length;
    let changed = false;
    for (let i = 0; i < 256; i++) {
      const c = i < n ? palRGB(i) : 0;
      if (palSeen[i] !== c) { palSeen[i] = c; changed = true; palBytes[i * 4] = c >> 16 & 255; palBytes[i * 4 + 1] = c >> 8 & 255; palBytes[i * 4 + 2] = c & 255; palBytes[i * 4 + 3] = 255; }
    }
    if (!changed) return;
    palVersion++;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, palTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, palBytes);
    gl.activeTexture(gl.TEXTURE0);
  }

  // Platzhalter-Tiefentextur für den Schatten-Sampler, solange kein Schatten an ist
  const dummyShadow = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, dummyShadow);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 1, 1, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, new Uint32Array([0xffffffff]));
  shadowParams(dummyShadow);
  function shadowParams(t) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    // nicht auf der aktiven Einheit liegen lassen: dort erwartet uTex eine normale Textur (sonst „sampler type“-Fehler)
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // Sprites als Texturen (je Palette/Bank), neu gebaut, wenn sich das Sprite oder die Palette ändert
  let filter = 'pixel';
  const texCache = new WeakMap();
  function spriteTex(n, bank) {
    const sp = ctx.sprites[n];
    if (!sp) return null;
    let per = texCache.get(sp);
    if (!per) { per = new Map(); texCache.set(sp, per); }
    const key = bank & 7;
    let e = per.get(key);
    if (!e) { e = { tex: gl.createTexture(), ver: -1, filter: '' }; per.set(key, e); }
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    if (e.ver !== palVersion) {
      const px = new Uint8Array(sp.w * sp.h * 4), off = key * 32;
      for (let i = 0; i < sp.w * sp.h; i++) {
        const t = sp.data[i];
        if (t === TRANSPARENT) continue;
        const c = palRGB((t + off) & 255);
        px[i * 4] = c >> 16 & 255; px[i * 4 + 1] = c >> 8 & 255; px[i * 4 + 2] = c & 255; px[i * 4 + 3] = 255;
      }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sp.w, sp.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      e.ver = palVersion; e.filter = ''; e.mip = false;
    }
    if (e.filter !== filter) {
      if (filter === 'mip' && !e.mip) { gl.generateMipmap(gl.TEXTURE_2D); e.mip = true; }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter === 'mip' ? gl.LINEAR_MIPMAP_LINEAR : filter === 'glatt' ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === 'pixel' ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      e.filter = filter;
    }
    return e.tex;
  }

  // -------------------------------------------------------------- Modelle
  const models = new Array(MAX_MODELS).fill(null);
  function upload(m) {
    const n = m.f.length, d = new Float32Array(n * 3 * 12);
    m.f.forEach((f, k) => {
      for (let j = 0; j < 3; j++) {
        const p = f.i[j], o = (k * 3 + j) * 12;
        d[o] = m.v[p * 3]; d[o + 1] = m.v[p * 3 + 1]; d[o + 2] = m.v[p * 3 + 2];
        const nr = m.smooth ? [m.vn[p * 3], m.vn[p * 3 + 1], m.vn[p * 3 + 2]] : m.fn[k];
        d[o + 3] = nr[0]; d[o + 4] = nr[1]; d[o + 5] = nr[2];
        d[o + 6] = f.uv[j * 2]; d[o + 7] = f.uv[j * 2 + 1];
        d[o + 8] = f.cc ? -((f.cc[j] & 0xffffff) + 1) : f.c & 255;
        d[o + 9] = j === 0 ? 1 : 0; d[o + 10] = j === 1 ? 1 : 0; d[o + 11] = j === 2 ? 1 : 0;
      }
    });
    if (m.gpu) { gl.deleteBuffer(m.gpu.buf); if (m.gpu.skinBuf) gl.deleteBuffer(m.gpu.skinBuf); if (m.gpu.uv2Buf) gl.deleteBuffer(m.gpu.uv2Buf); gl.deleteVertexArray(m.gpu.vao); }
    m.gpu = makeVAO(d);
    m.count = n * 3;
    // Umkugel in Modell-Koordinaten
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < m.v.length; k++) { const a = k % 3; if (m.v[k] < lo[a]) lo[a] = m.v[k]; if (m.v[k] > hi[a]) hi[a] = m.v[k]; }
    m.bound = lo[0] === Infinity ? null : { c: [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2), r: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 };
    if (m.f[0]?.uv2) {
      // 8BOY 128: zweite UV-Ebene für die Lightmap
      const ud = new Float32Array(n * 3 * 2);
      m.f.forEach((f, k) => { for (let j = 0; j < 6; j++) ud[k * 6 + j] = f.uv2 ? f.uv2[j] : 0; });
      gl.bindVertexArray(m.gpu.vao);
      const ub = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, ub);
      gl.bufferData(gl.ARRAY_BUFFER, ud, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(LOC.aUV2); gl.vertexAttribPointer(LOC.aUV2, 2, gl.FLOAT, false, 8, 0);
      gl.bindVertexArray(null);
      m.gpu.uv2Buf = ub;
    }
    if (m.skin) {
      // Figur: je Ecke 4 Knochen-Nummern und 4 Gewichte
      const sd = new Float32Array(n * 3 * 8), J = m.skin.joints, Wt = m.skin.weights;
      m.f.forEach((f, k) => {
        for (let j = 0; j < 3; j++) {
          const p = f.i[j], o = (k * 3 + j) * 8;
          for (let c = 0; c < 4; c++) { sd[o + c] = J[p * 4 + c]; sd[o + 4 + c] = Wt[p * 4 + c]; }
        }
      });
      gl.bindVertexArray(m.gpu.vao);
      const sb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, sb);
      gl.bufferData(gl.ARRAY_BUFFER, sd, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(LOC.aJoint); gl.vertexAttribPointer(LOC.aJoint, 4, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(LOC.aWeight); gl.vertexAttribPointer(LOC.aWeight, 4, gl.FLOAT, false, 32, 16);
      gl.bindVertexArray(null);
      m.gpu.skinBuf = sb;
    }
  }
  function dropModel(m) {
    freeLods(m);
    if (m?.gpu) { gl.deleteBuffer(m.gpu.buf); if (m.gpu.skinBuf) gl.deleteBuffer(m.gpu.skinBuf); if (m.gpu.uv2Buf) gl.deleteBuffer(m.gpu.uv2Buf); gl.deleteVertexArray(m.gpu.vao); }
    if (m?.gtex) gl.deleteTexture(m.gtex.tex);
  }
  function setModel(n, m) {
    if (n < 0 || n >= MAX_MODELS) throw new Error(`Modell-Nummer 0-${MAX_MODELS - 1}`);
    dropModel(models[n]);
    upload(m);
    if (m.img) {
      // eigene Textur des Modells (Modell-Paket): RGBA, wiederholend, Mipmaps
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, m.img.w, m.img.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, m.img.rgba);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.bindTexture(gl.TEXTURE_2D, null);
      m.gtex = { tex: t, filter: '' };
    }
    models[n] = m;
  }
  // Modell aus dem Modell-Paket (meshToChip): Normalen, Farben und Textur kommen mit
  function modelMesh(n, m) { setModel(n, prepare(m)); return m.f.length; }
  // Modell-Texturen: Standard glatt mit Mipmaps; filter3d("pixel"/"glatt"/"mip") gilt, sobald die Kartridge es setzt
  let filterSet = false;
  function modelTex(m) {
    const g = m.gtex, want = filterSet ? filter : 'mip';
    gl.bindTexture(gl.TEXTURE_2D, g.tex);
    if (g.filter !== want) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, want === 'mip' ? gl.LINEAR_MIPMAP_LINEAR : want === 'glatt' ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, want === 'pixel' ? gl.NEAREST : gl.LINEAR);
      g.filter = want;
    }
    return g.tex;
  }
  function model(n, form, color = 7) {
    const m = builtinModel(form, color);
    if (!m) throw new Error(`unbekannte Form "${form}" (wuerfel, ebene, gitter, pyramide, kugel, zylinder, kegel, ring)`);
    setModel(n, prepare(m));
  }
  function modelData(n, pts, faces, smooth = false, both = false, colors = null) {
    if (n < 0 || n >= MAX_MODELS) throw new Error(`Modell-Nummer 0-${MAX_MODELS - 1}`);
    setModel(n, customModel(pts, faces, smooth, both, colors));
  }
  // 8BOY 128: echte Texturen (Plätze 0–63) aus Bilddateien – Farben wie im Bild, Mipmaps, anisotrop gefiltert
  const gtexSlots = new Array(64).fill(null);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const texReady = (k) => (k === undefined || k === null ? null : gtexSlots[k | 0]?.tex || null);
  async function texload(k, bytes, mime = '') {
    k |= 0;
    if (k < 0 || k >= 64) throw new Error('Textur-Platz 0–63');
    const slot = { tex: null, laedt: true };
    gtexSlots[k] = slot;
    try {
      const bmp = await createImageBitmap(new Blob([bytes], mime ? { type: mime } : undefined), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      if (gtexSlots[k] !== slot) return;   // inzwischen ersetzt
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      gl.bindTexture(gl.TEXTURE_2D, null);
      bmp.close?.();
      slot.tex = t; slot.w = bmp.width; slot.h = bmp.height;
    } catch (e) { slot.fehler = e.message; }
    slot.laedt = false;
  }
  const texstate = (k) => { const s = gtexSlots[k | 0]; return !s ? 'leer' : s.laedt ? 'laedt' : s.tex ? 'bereit' : 'fehler'; };
  // Material eines Modells: farbe/normal/rm = Textur-Plätze, rauheit 0–1, metall 0–1, normalstaerke, emission, kachel, ton (0xRRGGBB),
  //   licht = Lightmap-Platz (zweite UV-Ebene aus Blender), lichtstaerke, umgebung = eigenes Panorama (sonst env3d)
  function mmat(n, o = {}) {
    const m = models[n];
    if (!m) return;
    m.mat = { farbe: o.farbe, normal: o.normal, rm: o.rm, rauheit: o.rauheit ?? 0.6, metall: o.metall ?? 0, normalstaerke: o.normalstaerke ?? 1, emission: o.emission, kachel: o.kachel || 1, ton: o.ton,
      licht: o.licht, lichtstaerke: o.lichtstaerke ?? 1, umgebung: o.umgebung };
  }
  // 8BOY 128: Figuren – Netz mit Knochen, Pose als Matrizen (aus js/skin.js), je Bild in eine Gleitkomma-Textur
  const boneTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, boneTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  function bindBones(m, sp) {
    const on = !!(m.skin && m.pose && giga());
    gl.uniform1i(uni(sp, 'uSkin'), on ? 1 : 0);
    if (!on) return;
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, boneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, m.pose.length / 16, 0, gl.RGBA, gl.FLOAT, m.pose);
    gl.uniform1i(uni(sp, 'uBones'), 7);
    gl.activeTexture(gl.TEXTURE0);
  }
  function modelSkin(n, chip, pose) { setModel(n, prepare(chip)); models[n].pose = pose; return chip.f.length; }
  function mpose(n, pose) { const m = models[n]; if (m && m.skin) m.pose = pose; }
  function mtex(n, sprite, bank = 0, tile = 1) {
    const m = models[n];
    if (!m) return;
    m.tex = sprite === undefined || sprite === null ? null : sprite | 0;
    m.bank = bank | 0;
    m.tile = tile > 0 ? tile : 1;
  }
  function malpha(n, a = 1) { const m = models[n]; if (m) m.alpha = Math.max(0, Math.min(1, a)); }
  function mglow(n, on = true) { const m = models[n]; if (m) m.glow = !!on; }
  function mcolor(n, color) { const m = models[n]; if (m) { m.f.forEach((f) => { f.c = color; f.cc = null; }); upload(m); } }
  function mwave(n, amp = 0, len = 1, phase = 0) { const m = models[n]; if (m) m.wave = amp ? { amp, len: Math.max(0.01, len), phase } : null; }
  // Stufe 2: Materialien
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function memit(n, k = 1) { const m = models[n]; if (m) m.emit = clamp(+k || 0, 0, 16); }
  function mshine(n, k = 1, hard = 32) { const m = models[n]; if (m) m.shine = k > 0 ? { k: clamp(k, 0, 8), hard: clamp(hard, 1, 512) } : null; }
  function madd(n, on = true) { const m = models[n]; if (m) m.add = !!on; }
  function mshadow(n, on = true) { const m = models[n]; if (m) m.noShadow = !on; }
  function mwater(n, on = true, refl = 1, base = 0.7, ripple = 1) {
    const m = models[n];
    if (m) m.water = on ? { refl: clamp(refl, 0, 2), base: clamp(base, 0, 1), ripple: clamp(ripple, 0, 4) } : null;
  }

  // -------------------------------------------------------------- Kamera, Licht, Nebel, Lampen
  const cam = { x: 0, y: 0, z: -5, yaw: 0, pitch: 0, fov: 60 };
  const light = { x: -0.4, y: -0.8, z: 0.45, amb: 0.35 };
  let fog = null, view = null, retro = false, debug = 0, showStats = false;
  const lamps = new Array(GPU_MAX_LAMPS).fill(null);
  function normLight() { const l = Math.hypot(light.x, light.y, light.z) || 1; light.x /= l; light.y /= l; light.z /= l; }
  normLight();
  function camera3d(x, y, z, yaw = 0, pitch = 0, fov = 60) { Object.assign(cam, { x, y, z, yaw, pitch, fov: Math.max(10, Math.min(150, fov)) }); }
  function light3d(x, y, z, amb = 0.35) { Object.assign(light, { x, y, z, amb: Math.max(0, Math.min(1, amb)) }); normLight(); }
  function fog3d(near, far, rgb = 0) {
    if (near === undefined) { fog = null; return; }
    fog = { near, far: Math.max(near + 0.01, far), r: rgb >> 16 & 255, g: rgb >> 8 & 255, b: rgb & 255 };
  }
  // Lampe 0–7: Punktlicht mit Farbe (0xRRGGBB) und Reichweite; lamp3d(n) schaltet sie aus
  function lamp3d(n, x, y, z, rgb = 0xffffff, range = 5) {
    n |= 0;
    if (n < 0 || n >= GPU_MAX_LAMPS) throw new Error(`Der Grafikchip hat ${GPU_MAX_LAMPS} Lampen: Nummer 0–${GPU_MAX_LAMPS - 1}`);
    lamps[n] = x === undefined ? null : { x, y, z, r: (rgb >> 16 & 255) / 255, g: (rgb >> 8 & 255) / 255, b: (rgb & 255) / 255, range: Math.max(0.01, range) };
  }
  function filter3d(mode = 'pixel') { filter = ['pixel', 'glatt', 'mip'].includes(mode) ? mode : 'pixel'; filterSet = true; }
  function debug3d(mode) {
    debug = mode === 'draht' ? 1 : mode === 'tiefe' ? 2 : 0;
    casDbg = mode === 'kaskaden';
    if (mode === 'zahlen') showStats = true; else if (!mode || mode === 'aus') showStats = false;
  }
  function retro3d(on = true) { retro = !!on; }
  const rgbOf = (c) => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];

  // Stufe 2: Sonne, Bodennebel, Kaustik, Schatten, Qualität
  let sun = null, hfog = null, caus = null, shadow = null;
  // 8BOY 128, Licht und Tiefe: Umgebungsverdeckung (an), Umgebungs-Panorama für Spiegelungen/Himmel, Kaskaden sichtbar machen
  const AO_START = { k: 0.8, r: 0.7 };
  let ao = { ...AO_START }, env = null, casDbg = false, aoRan = false;
  function ao3d(k = AO_START.k, r = AO_START.r) { ao = k > 0 ? { k: clamp(k, 0, 2), r: clamp(r, 0.05, 10) } : null; }
  function env3d(k, staerke = 1, himmel = false) { env = k === undefined || k === null ? null : { slot: k | 0, k: clamp(staerke, 0, 16), himmel: !!himmel }; }
  let quality = defaultQuality(renderer);
  const Q = () => FX_QUALITY[quality];
  function sun3d(rgb, size = 1, halo = 1) { sun = rgb === undefined ? null : { col: rgbOf(rgb), size: clamp(size, 0.1, 8), halo: clamp(halo, 0, 4) }; }
  function hfog3d(h, dens = 0.05, rgb = 0xc0c8d0, falloff = 0.6) {
    hfog = h === undefined ? null : { h, dens: Math.max(0, dens), col: rgbOf(rgb), falloff: Math.max(0.01, falloff) };
  }
  function caustic3d(h, k = 1) { caus = h === undefined ? null : { h, k: clamp(k, 0, 4) }; }
  function shadow3d(on = true, range = 30, strength = 0.65) {
    if (!on) { shadow = null; return; }
    shadow = { range: clamp(range, 4, 200), strength: clamp(strength, 0, 1) };
  }
  function fx3d(q) {
    if (q !== undefined && q !== null) {
      const nq = clamp(q | 0, 0, 3);
      if (nq !== quality) { quality = nq; dropShadowMaps(); partMaxChanged(); }
    }
    return quality;
  }

  const vp = () => view || { x: 0, y: 0, w: ctx.W, h: ctx.H };
  const vkey = () => (view ? `${view.x},${view.y},${view.w},${view.h}` : 'all');
  function view3d(x, y, w, h) { view = x === undefined ? null : { x: Math.max(0, x | 0), y: Math.max(0, y | 0), w: Math.max(1, w | 0), h: Math.max(1, h | 0) }; }
  const focal = () => (vp().h / 2) / Math.tan(cam.fov * Math.PI / 360);

  // -------------------------------------------------------------- Nachbearbeitung: Einstellungen
  // post3d(art, …) ohne view3d gilt fürs ganze Bild; mit view3d nur in diesem Ausschnitt (geteilter Bildschirm).
  const POST_KEYS = FX_POST;
  const postGlobal = {}, postRegions = new Map();
  function post3d(art, a, b, c) {
    if (art === undefined || art === null) { for (const k of Object.keys(postGlobal)) delete postGlobal[k]; postRegions.clear(); return; }
    const key = vkey();
    const target = key === 'all' ? postGlobal : (postRegions.get(key) || postRegions.set(key, {}).get(key));
    if (art === 'aus') { for (const k of Object.keys(target)) delete target[k]; return; }
    if (!POST_KEYS.includes(art)) throw new Error(`post3d: unbekannter Effekt "${art}" (${POST_KEYS.join(', ')} oder "aus")`);
    const off = a !== undefined && a !== null && +a <= 0 && art !== 'farbe' && art !== 'toenung';
    let v = null;
    switch (art) {
      case 'gluehen': v = { k: clamp(a ?? 0.8, 0, 8), thr: clamp(b ?? 0.75, 0, 4), r: clamp(c ?? 1, 0.3, 3) }; break;
      case 'farbe': v = { exp: clamp(a ?? 1, 0, 8), sat: clamp(b ?? 1, 0, 4), con: clamp(c ?? 1, 0, 4) }; break;
      case 'toenung': v = (b ?? 0.5) > 0 ? { col: rgbOf(a ?? 0x4080ff), k: clamp(b ?? 0.5, 0, 1) } : null; break;
      case 'flimmern': v = { k: clamp(a ?? 1, 0, 10), speed: clamp(b ?? 1, 0, 10) }; break;
      case 'unschaerfe': v = { focus: Math.max(0, a ?? 8), range: Math.max(0.1, b ?? 10) }; break;
      default: v = clamp(a ?? 1, 0, art === 'strahlen' ? 4 : 2);
    }
    if (off || v === null) delete target[art]; else target[art] = v;
  }
  const postWanted = () => (giga() && floatOK) || Q().post && (Object.keys(postGlobal).length > 0 || [...postRegions.values()].some((r) => Object.keys(r).length));

  // -------------------------------------------------------------- Render-Ziele
  let scene = null;   // { fbo, color, depth, w, h }
  const fmt = () => (floatOK ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
  function colorTex(w, h) {
    const t = gl.createTexture(), f = fmt();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, f.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(w, h, withDepth = false) {
    const fbo = gl.createFramebuffer(), color = colorTex(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    let depth = null;
    if (withDepth) {
      depth = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, depth);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    }
    return { fbo, color, depth, w, h };
  }
  function freeTarget(t) { if (!t) return; gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.color); if (t.depth) gl.deleteTexture(t.depth); }
  let chain = [], raysT = null, blurT = [], ldrT = null, aoT = null;
  function ensureTargets() {
    if (scene && scene.w === ctx.W && scene.h === ctx.H) return;
    freeTarget(scene); chain.forEach(freeTarget); freeTarget(raysT); blurT.forEach(freeTarget); freeTarget(ldrT); freeTarget(aoT);
    ldrT = target(ctx.W, ctx.H);   // 8BOY 128: fertiges Bild vor der Kantenglättung
    aoT = target(Math.max(1, ctx.W >> 1), Math.max(1, ctx.H >> 1));   // 8BOY 128: Umgebungsverdeckung
    scene = target(ctx.W, ctx.H, true);
    chain = [];
    for (let i = 1; i <= 6; i++) chain.push(target(Math.max(1, ctx.W >> i), Math.max(1, ctx.H >> i)));
    raysT = target(Math.max(1, ctx.W >> 1), Math.max(1, ctx.H >> 1));
    blurT = [1, 2, 3].map((k) => target(Math.max(1, ctx.W >> k), Math.max(1, ctx.H >> k)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  let postFrame = false, dirty = false;
  const hdr = () => (postFrame && floatOK ? 1 : 0);
  const bindTarget = () => gl.bindFramebuffer(gl.FRAMEBUFFER, postFrame ? scene.fbo : null);

  // -------------------------------------------------------------- Bild beginnen
  let tris = 0, trisLast = 0, calls = 0, callsLast = 0, over = false, overLast = false;
  let frameNo = 0;
  const time = () => frameNo / 60;
  let sky = { top: [0, 0, 0], bottom: [0, 0, 0] };
  const sunPending = new Set();
  const usedKeys = new Map();   // Ausschnitte dieses Bildes → Kamera (für Lichtstrahlen und Schatten)
  let usedLast = 1;
  function ensureSize() {
    if (canvas.width !== ctx.W || canvas.height !== ctx.H) { canvas.width = ctx.W; canvas.height = ctx.H; }
  }
  // Himmel als Verlauf malen und Tiefenspeicher leeren – im ganzen Bild oder nur im Ausschnitt V
  function paintSky(top, bottom, V) {
    ensureSize();
    ctx.state.use3d = true;
    bindTarget();
    if (V) {
      gl.viewport(V.x, ctx.H - V.y - V.h, V.w, V.h);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(V.x, ctx.H - V.y - V.h, V.w, V.h);
    } else { gl.viewport(0, 0, ctx.W, ctx.H); gl.disable(gl.SCISSOR_TEST); }
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.useProgram(skyProg);
    sky = { top: rgbOf(top), bottom: rgbOf(bottom) };
    gl.uniform3fv(uni(skyProg, 'uTop'), sky.top);
    gl.uniform3fv(uni(skyProg, 'uBottom'), sky.bottom);
    gl.uniform1i(uni(skyProg, 'uGiga'), giga() ? 1 : 0);
    gl.bindVertexArray(skyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.clear(gl.DEPTH_BUFFER_BIT);   // mit Scissor: nur im Ausschnitt
    if (sun || env?.himmel) sunPending.add(V ? vkey() : 'all');
  }
  function cls3d(top = 0, bottom = top) {
    trisLast = tris; tris = 0; callsLast = calls; calls = 0; overLast = over; over = false;
    culledLast = culled; culled = 0; lodLast = lodDraws; lodDraws = 0;
    usedLast = Math.max(1, usedKeys.size);
    usedKeys.clear();
    sunPending.clear();
    frameNo++;
    swapShadowMaps();
    postFrame = postWanted();
    if (postFrame) ensureTargets();
    dirty = true;
    paintSky(top, bottom, null);
  }
  // Geteilter Bildschirm: Himmel nur in der Ansicht von view3d, ohne ein neues Bild zu beginnen (Zähler laufen weiter)
  function sky3d(top = 0, bottom = top) { paintSky(top, bottom, vp()); }

  // Sonne: erst, wenn die Kamera des Ausschnitts feststeht (nach sky3d/cls3d, vor dem ersten Modell)
  function drawSun() {
    const key = vkey();
    if (!(sun || env?.himmel) || !(sunPending.has(key) || sunPending.has('all'))) return;
    sunPending.delete(key); sunPending.delete('all');
    const V = vp(), F = focal();
    const et = env?.himmel && giga() ? texReady(env.slot) : null;
    if (et) {
      gl.useProgram(P.pano);
      gl.viewport(V.x, ctx.H - V.y - V.h, V.w, V.h);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(V.x, ctx.H - V.y - V.h, V.w, V.h);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.uniform4f(uni(P.pano, 'uVP'), V.x, ctx.H - V.y - V.h, V.w, V.h);
      gl.uniform2f(uni(P.pano, 'uProj'), F / (V.w / 2), F / (V.h / 2));
      gl.uniform4f(uni(P.pano, 'uCamRot'), Math.cos(-cam.yaw), Math.sin(-cam.yaw), Math.cos(cam.pitch), Math.sin(cam.pitch));
      gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, et); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(uni(P.pano, 'uEnvTex'), 9);
      gl.uniform1f(uni(P.pano, 'uK'), env.k);
      gl.bindVertexArray(emptyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
    }
    if (!sun) return;
    gl.useProgram(P.sun);
    gl.viewport(V.x, ctx.H - V.y - V.h, V.w, V.h);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(V.x, ctx.H - V.y - V.h, V.w, V.h);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform4f(uni(P.sun, 'uVP'), V.x, ctx.H - V.y - V.h, V.w, V.h);
    gl.uniform2f(uni(P.sun, 'uProj'), F / (V.w / 2), F / (V.h / 2));
    gl.uniform4f(uni(P.sun, 'uCamRot'), Math.cos(-cam.yaw), Math.sin(-cam.yaw), Math.cos(cam.pitch), Math.sin(cam.pitch));
    gl.uniform3f(uni(P.sun, 'uSunDir'), -light.x, -light.y, -light.z);
    gl.uniform3fv(uni(P.sun, 'uSunCol'), sun.col);
    gl.uniform2f(uni(P.sun, 'uSunP'), sun.size, sun.halo);
    gl.uniform1i(uni(P.sun, 'uHdr'), hdr());
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  function markUsed() {
    const key = vkey();
    if (!usedKeys.has(key)) usedKeys.set(key, { V: { ...vp() }, cam: { ...cam } });
    else Object.assign(usedKeys.get(key).cam, cam);
  }

  // Gemeinsame Einstellungen für alles, was in die Welt gezeichnet wird
  function begin(mode) {
    ensureSize();
    syncPalette();
    ctx.state.use3d = true;
    bindTarget();
    markUsed();
    drawSun();
    const V = vp(), F = focal();
    gl.useProgram(prog);
    gl.viewport(V.x, ctx.H - V.y - V.h, V.w, V.h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(V.x, ctx.H - V.y - V.h, V.w, V.h);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.uniform1i(uni(prog, 'uMode'), mode);
    gl.uniform3f(uni(prog, 'uCam'), cam.x, cam.y, cam.z);
    gl.uniform4f(uni(prog, 'uCamRot'), Math.cos(-cam.yaw), Math.sin(-cam.yaw), Math.cos(cam.pitch), Math.sin(cam.pitch));
    gl.uniform2f(uni(prog, 'uProj'), F / (V.w / 2), F / (V.h / 2));
    gl.uniform4f(uni(prog, 'uRetro'), retro ? 1 : 0, V.w, V.h, 0);
    gl.uniform4f(uni(prog, 'uLight'), light.x, light.y, light.z, light.amb);
    gl.uniform4f(uni(prog, 'uFog'), fog ? fog.near : 0, fog ? fog.far : 1, fog ? 1 : 0, 0);
    gl.uniform3f(uni(prog, 'uFogCol'), fog ? fog.r / 255 : 0, fog ? fog.g / 255 : 0, fog ? fog.b / 255 : 0);
    gl.uniform1i(uni(prog, 'uDebug'), debug);
    gl.uniform1i(uni(prog, 'uPal'), 1);
    gl.uniform1i(uni(prog, 'uTex'), 0);
    gl.uniform1i(uni(prog, 'uShMap'), 2);
    gl.uniform1i(uni(prog, 'uGiga'), giga() ? 1 : 0);
    gl.uniform1i(uni(prog, 'uNormTex'), 5); gl.uniform1i(uni(prog, 'uRMTex'), 6);
    gl.uniform2i(uni(prog, 'uMatTex'), 0, 0);
    gl.uniform4f(uni(prog, 'uMat'), 0.6, 0, 1, 0);
    gl.uniform3f(uni(prog, 'uMatTon'), 1, 1, 1);
    gl.uniform1i(uni(prog, 'uLMTex'), 8); gl.uniform1i(uni(prog, 'uEnvTex'), 9);
    gl.uniform4f(uni(prog, 'uLMP'), 0, 1, 0, 0);
    setEnv(null);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.activeTexture(gl.TEXTURE0);
    let n = 0;
    const pos = [], col = [];
    for (const l of lamps) if (l) { pos.push(l.x, l.y, l.z, l.range); col.push(l.r, l.g, l.b); n++; }
    gl.uniform1i(uni(prog, 'uLamps'), n);
    if (n) { gl.uniform4fv(uni(prog, 'uLampPos[0]'), pos); gl.uniform3fv(uni(prog, 'uLampCol[0]'), col); }
    // Stufe 2: Grundwerte (Materialien setzt draw3d)
    gl.uniform1i(uni(prog, 'uHdr'), hdr());
    gl.uniform1f(uni(prog, 'uTime'), time());
    gl.uniform3fv(uni(prog, 'uSunCol'), sun ? sun.col : [1, 1, 1]);
    gl.uniform3fv(uni(prog, 'uSkyT'), sky.top);
    gl.uniform3fv(uni(prog, 'uSkyB'), sky.bottom);
    gl.uniform4f(uni(prog, 'uCaus'), caus ? caus.h : 0, caus ? caus.k : 0, caus ? 1 : 0, 0);
    gl.uniform4f(uni(prog, 'uHFog'), hfog ? hfog.h : 0, hfog ? hfog.dens : 0, hfog ? 1 : 0, hfog ? hfog.falloff : 1);
    gl.uniform3fv(uni(prog, 'uHFogCol'), hfog ? hfog.col : [0, 0, 0]);
    gl.uniform1f(uni(prog, 'uEmit'), 0);
    gl.uniform2f(uni(prog, 'uShine'), 0, 1);
    gl.uniform1i(uni(prog, 'uWater'), 0);
    gl.uniform1i(uni(prog, 'uInst'), 0);
    gl.uniform1i(uni(prog, 'uCasDbg'), casDbg ? 1 : 0);
    setShadowUniforms(mode === 0);
  }
  // Panorama für Spiegelungen und Umgebungslicht: eigenes des Modells, sonst env3d
  function setEnv(own) {
    const k = own ?? env?.slot, t = k === undefined || k === null ? null : texReady(k);
    const g = t ? gtexSlots[k | 0] : null;
    gl.uniform4f(uni(prog, 'uEnvP'), t ? 1 : 0, env ? env.k : 1, g ? Math.log2(Math.max(g.w, g.h)) - 1 : 0, 0);
    if (t) { gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, t); gl.activeTexture(gl.TEXTURE0); }
  }
  function setTexture(n, bank) {
    const t = n === null || n === undefined ? null : spriteTex(n, bank);
    gl.uniform1i(uni(prog, 'uTextured'), t ? 1 : 0);
    if (t) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); }
    return t;
  }
  function blendFor(alpha, add = false, water = false) {
    if (add) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false); }
    else if (water) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true); }
    else if (alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); } else { gl.disable(gl.BLEND); gl.depthMask(true); }
    gl.uniform1f(uni(prog, 'uAlpha'), alpha);
  }

  // -------------------------------------------------------------- Schatten (Shadow Map je Ausschnitt)
  // Die Karte eines Bildes wird beim Zeichnen gefüllt und im nächsten Bild benutzt (eine 1/60 s Versatz, dafür
  // nur ein Durchgang). Je Ausschnitt zwei Karten im Wechsel.
  const shadowSets = new Map();
  function dropShadowMaps() {
    for (const s of shadowSets.values()) for (let i = 0; i < 2; i++) { gl.deleteFramebuffer(s.fbo[i]); gl.deleteTexture(s.tex[i]); }
    shadowSets.clear();
  }
  // 8BOY 128: drei Kaskaden nebeneinander in einer Karte (nah fein, fern grob), je Kaskade halbe Kartengröße
  const CASCADES = [0.14, 0.4, 1];
  function shadowSet(key) {
    let s = shadowSets.get(key);
    const cas = giga() ? CASCADES.length : 1;
    const full = usedLast > 2 ? Q().shadow >> 1 : Q().shadow;
    const size = Math.max(512, cas > 1 ? full >> 1 : full);
    if (s && (s.size !== size || s.cas !== cas)) { for (let i = 0; i < 2; i++) { gl.deleteFramebuffer(s.fbo[i]); gl.deleteTexture(s.tex[i]); } s = null; }
    if (!s) {
      s = { size, cas, tex: [], fbo: [], mat: [null, null], written: [-9, -9], read: 0 };
      for (let i = 0; i < 2; i++) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size * cas, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        shadowParams(t);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
        gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
        s.tex.push(t); s.fbo.push(f);
      }
      shadowSets.set(key, s);
      bindTarget();
    }
    return s;
  }
  function swapShadowMaps() {
    for (const s of shadowSets.values()) { const w = 1 - s.read; if (s.written[w] === frameNo - 1) s.read = w; }
  }
  const shadowOn = () => !!shadow && Q().shadow > 0 && debug === 0;
  function setShadowUniforms(model) {
    const s = model && shadowOn() ? shadowSets.get(vkey()) : null;
    const ok = s && s.written[s.read] === frameNo - 1 && s.mat[s.read];
    gl.uniform1i(uni(prog, 'uShadow'), ok ? 1 : 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, ok ? s.tex[s.read] : dummyShadow);
    gl.activeTexture(gl.TEXTURE0);
    if (!ok) return;
    const M = s.mat[s.read];
    gl.uniform3fv(uni(prog, 'uShC'), M.C); gl.uniform3fv(uni(prog, 'uShR'), M.R); gl.uniform3fv(uni(prog, 'uShU'), M.U); gl.uniform3fv(uni(prog, 'uShF'), M.F);
    gl.uniform4f(uni(prog, 'uShP'), M.ext, M.depth, shadow.strength, M.texel);
    gl.uniform1i(uni(prog, 'uPcf'), Q().pcf);
    if (giga()) {
      gl.uniform1i(uni(prog, 'uCasN'), M.cas.length);
      gl.uniform4fv(uni(prog, 'uCasC[0]'), M.cas.flatMap((c) => [...c.C, 0]));
      gl.uniform4fv(uni(prog, 'uCasP[0]'), M.cas.flatMap((c) => [c.ext, c.depth, c.texel, 0]));
    }
  }
  // Modell zusätzlich in die Schattenkarte dieses Bildes zeichnen
  function shadowCast(m, rot, scale, x, y, z, inst, G = m, sph) {
    if (!shadowOn() || m.noShadow || m.glow || m.add || m.water || (m.alpha ?? 1) < 1) return;
    const key = vkey(), s = shadowSet(key), w = 1 - s.read;
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (s.written[w] !== frameNo) {
      // Karte(n) für dieses Bild anlegen: um die Kamera herum, in Blickrichtung verschoben, auf Texel gerastert
      const B = lightBasis(light.x, light.y, light.z);
      const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
      const cas = (s.cas > 1 ? CASCADES : [1]).map((k) => {
        const ext = shadow.range * k, texel = (2 * ext) / s.size;
        const c = [cam.x + fx * ext * 0.55, cam.y, cam.z + fz * ext * 0.55];
        const r = Math.floor(dot(c, B.R) / texel) * texel, u = Math.floor(dot(c, B.U) / texel) * texel, f = dot(c, B.F);
        const C = [0, 1, 2].map((i) => B.R[i] * r + B.U[i] * u + B.F[i] * f);
        return { C, ext, depth: Math.max(shadow.range * 2, 60), texel };
      });
      s.mat[w] = { ...cas[0], R: B.R, U: B.U, F: B.F, cas };
      s.written[w] = frameNo;
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo[w]);
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, s.size * s.cas, s.size);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
    } else gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo[w]);
    const M = s.mat[w], sp = giga() ? P.shadowGiga : P.shadow;
    gl.useProgram(sp);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, s.size, s.size);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.uniformMatrix3fv(uni(sp, 'uRot'), false, rot);
    gl.uniform3f(uni(sp, 'uScale'), scale[0], scale[1], scale[2]);
    gl.uniform3f(uni(sp, 'uTrans'), x, y, z);
    const wv = m.wave;
    gl.uniform4f(uni(sp, 'uWave'), wv ? wv.amp : 0, wv ? Math.PI * 2 / wv.len : 0, wv ? wv.phase : 0, wv ? 1 : 0);
    gl.uniform1i(uni(sp, 'uInst'), inst ? 1 : 0);
    if (giga()) bindBones(m, sp);
    gl.uniform3fv(uni(sp, 'uShR'), M.R); gl.uniform3fv(uni(sp, 'uShU'), M.U); gl.uniform3fv(uni(sp, 'uShF'), M.F);
    const own = (m.tex === null || m.tex === undefined) && m.gtex;
    const t = own ? modelTex(m) : m.tex !== null && m.tex !== undefined ? spriteTex(m.tex, m.bank || 0) : null;
    gl.uniform1i(uni(sp, 'uTextured'), t ? 1 : 0);
    gl.uniform1i(uni(sp, 'uTex'), 0);
    gl.uniform1f(uni(sp, 'uTile'), own ? 1 : m.tile ?? 1);
    if (t) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); }
    gl.bindVertexArray(G.gpu.vao);
    const ws = inst ? null : sph !== undefined ? sph : worldSphere(m, rot, scale, x, y, z);
    const wc = ws ? ws.c : null, wr = ws ? ws.r : 0;
    M.cas.forEach((c, i) => {
      if (wc) {
        const d = [wc[0] - c.C[0], wc[1] - c.C[1], wc[2] - c.C[2]];
        if (Math.abs(dot(d, M.R)) > c.ext + wr || Math.abs(dot(d, M.U)) > c.ext + wr) return;
      }
      gl.viewport(i * s.size, 0, s.size, s.size);
      gl.uniform3fv(uni(sp, 'uShC'), c.C);
      gl.uniform4f(uni(sp, 'uShP'), c.ext, c.depth, 0, 0);
      if (inst) { bindInst(inst); gl.drawArraysInstanced(gl.TRIANGLES, 0, G.count, inst.draw); unbindInst(); } else gl.drawArrays(gl.TRIANGLES, 0, G.count);
    });
  }
  // Umkugel eines Modells in der Welt (Figuren bewegen sich über ihre Ruhelage hinaus: mehr Spielraum)
  function worldSphere(m, rot, scale, x, y, z) {
    if (!m.bound || m.wave) return null;
    const b = m.bound, p = [b.c[0] * scale[0], b.c[1] * scale[1], b.c[2] * scale[2]];
    return {
      c: [rot[0] * p[0] + rot[3] * p[1] + rot[6] * p[2] + x, rot[1] * p[0] + rot[4] * p[1] + rot[7] * p[2] + y, rot[2] * p[0] + rot[5] * p[1] + rot[8] * p[2] + z],
      r: b.r * Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2])) * (m.skin ? 1.6 : 1),
    };
  }

  // -------------------------------------------------------------- Modell zeichnen
  const rotOf = (yaw, pitch, roll) => {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    const rot = (px, py, pz) => {
      const x1 = px * cr - py * sr, y1 = px * sr + py * cr, z1 = pz;
      const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
      return [x1 * cyw + z2 * syw, y2, -x1 * syw + z2 * cyw];
    };
    return [...rot(1, 0, 0), ...rot(0, 1, 0), ...rot(0, 0, 1)];
  };
  const nz = (v) => (Math.abs(v) < 1e-4 ? (v < 0 ? -1e-4 : 1e-4) : v);
  function drawModel(m, x, y, z, yaw, pitch, roll, scale, inst, opt = null) {
    const rot = rotOf(yaw, pitch, roll);
    const s0 = typeof scale === 'object' ? scale : [scale, scale, scale];
    const s = [nz(s0[0]), nz(s0[1]), nz(s0[2])];
    const G = opt?.geo || m;
    ensureSize(); bindTarget();
    shadowCast(m, rot, s, x, y, z, inst, G, opt ? opt.sph : undefined);
    if (opt && !opt.sicht) return;   // nicht im Bild – Schatten wirft es trotzdem
    begin(0);
    gl.uniformMatrix3fv(uni(prog, 'uRot'), false, rot);
    gl.uniform3f(uni(prog, 'uScale'), s[0], s[1], s[2]);
    gl.uniform3f(uni(prog, 'uTrans'), x, y, z);
    const wv = m.wave;
    gl.uniform4f(uni(prog, 'uWave'), wv ? wv.amp : 0, wv ? Math.PI * 2 / wv.len : 0, wv ? wv.phase : 0, wv ? 1 : 0);
    gl.uniform1i(uni(prog, 'uWaveN'), wv && !m.water ? 1 : 0);
    gl.uniform1i(uni(prog, 'uGlow'), m.glow ? 1 : 0);
    gl.uniform1i(uni(prog, 'uBoth'), m.both ? 1 : 0);
    gl.uniform1f(uni(prog, 'uTile'), m.tile ?? 1);
    gl.uniform1i(uni(prog, 'uFlip'), 0);
    gl.uniform1f(uni(prog, 'uEmit'), m.emit || 0);
    gl.uniform2f(uni(prog, 'uShine'), m.shine ? m.shine.k : 0, m.shine ? m.shine.hard : 1);
    gl.uniform1i(uni(prog, 'uWater'), m.water ? 1 : 0);
    if (m.water) gl.uniform4f(uni(prog, 'uWaterP'), m.water.refl, m.water.base, m.water.ripple, 0);
    gl.uniform1i(uni(prog, 'uInst'), inst ? 1 : 0);
    if (giga()) bindBones(m, prog);
    const mat = giga() ? m.mat : null;
    if (giga()) {
      const tn = mat && texReady(mat.normal), trm = mat && texReady(mat.rm);
      gl.uniform2i(uni(prog, 'uMatTex'), tn ? 1 : 0, trm ? 1 : 0);
      gl.uniform4f(uni(prog, 'uMat'), mat ? mat.rauheit : (m.shine ? Math.max(0.15, 1 - m.shine.k) : 0.6), mat ? mat.metall : 0, mat ? mat.normalstaerke : 1, 0);
      if (tn) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, tn); }
      if (trm) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, trm); }
      gl.activeTexture(gl.TEXTURE0);
      if (mat && mat.emission !== undefined) gl.uniform1f(uni(prog, 'uEmit'), mat.emission);
      const ton = mat && mat.ton !== undefined ? mat.ton : 0xffffff;
      gl.uniform3f(uni(prog, 'uMatTon'), (ton >> 16 & 255) / 255, (ton >> 8 & 255) / 255, (ton & 255) / 255);
      const tlm = mat && m.gpu.uv2Buf ? texReady(mat.licht) : null;
      gl.uniform4f(uni(prog, 'uLMP'), tlm ? 1 : 0, mat ? mat.lichtstaerke : 1, 0, 0);
      if (tlm) { gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, tlm); gl.activeTexture(gl.TEXTURE0); }
      setEnv(mat && mat.umgebung !== undefined && mat.umgebung !== null ? mat.umgebung : null);
    }
    const tAlb = mat && texReady(mat.farbe);
    if (tAlb) {
      gl.uniform1i(uni(prog, 'uTextured'), 2);
      gl.uniform1f(uni(prog, 'uTile'), mat.kachel || 1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tAlb);
    } else if ((m.tex === null || m.tex === undefined) && m.gtex) {
      gl.uniform1i(uni(prog, 'uTextured'), 2);
      gl.uniform1f(uni(prog, 'uTile'), 1);
      gl.activeTexture(gl.TEXTURE0); modelTex(m);
    } else setTexture(m.tex ?? null, m.bank || 0);
    if (m.both || m.water) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CW); }
    blendFor(m.alpha ?? 1, !!m.add, !!m.water);
    gl.bindVertexArray(G.gpu.vao);
    if (inst) { bindInst(inst); gl.drawArraysInstanced(gl.TRIANGLES, 0, G.count, inst.draw); unbindInst(); } else gl.drawArrays(gl.TRIANGLES, 0, G.count);
    if (m.add || m.water) { gl.disable(gl.BLEND); gl.depthMask(true); }
  }
  // 8BOY 128, große Welten: nur zeichnen, was im Blickfeld liegt (Umkugel gegen die vier Seiten), fern einfacher (LOD)
  let culled = 0, culledLast = 0, lodDraws = 0, lodLast = 0;
  const LOD_START = [10, 28, 70];   // Abstand in Umkugel-Radien
  function sichtbar(sph) {
    const V = vp(), F = focal(), v = toViewOf(cam, sph.c[0], sph.c[1], sph.c[2]), r = sph.r;
    if (v[2] < NEAR - r || v[2] > FAR + r) return false;
    const tx = (V.w / 2) / F, ty = (V.h / 2) / F;
    return Math.abs(v[0]) - v[2] * tx <= r * Math.sqrt(1 + tx * tx) && Math.abs(v[1]) - v[2] * ty <= r * Math.sqrt(1 + ty * ty);
  }
  function drawGiga(m, x, y, z, yaw, pitch, roll, scale) {
    const s0 = typeof scale === 'object' ? scale : [scale, scale, scale];
    const sph = worldSphere(m, rotOf(yaw, pitch, roll), [nz(s0[0]), nz(s0[1]), nz(s0[2])], x, y, z);
    let G = m;
    if (sph && m.lods?.length) {
      const d = Math.hypot(sph.c[0] - cam.x, sph.c[1] - cam.y, sph.c[2] - cam.z);
      for (let i = 0; i < m.lods.length; i++) if (d > (m.lodDist?.[i] ?? sph.r * LOD_START[i])) G = m.lods[i];
    }
    const sicht = !sph || sichtbar(sph);
    if (sicht) {
      if (tris + G.f.length > maxTris()) { over = true; ctx.state.use3d = true; return; }
      tris += G.f.length; calls++;
      if (G !== m) lodDraws++;
    } else culled++;
    drawModel(m, x, y, z, yaw, pitch, roll, scale, null, { geo: G, sph, sicht });
  }
  // Detailstufen eines Modells: einfachere Netze (aus dem Asset-Paket: name.lod1, name.lod2 …), Abstände in Welt-Einheiten
  function freeLods(m) { for (const l of m?.lods || []) { gl.deleteBuffer(l.gpu.buf); if (l.gpu.uv2Buf) gl.deleteBuffer(l.gpu.uv2Buf); gl.deleteVertexArray(l.gpu.vao); } if (m) m.lods = null; }
  function modelLods(n, chips) {
    const m = models[n];
    if (!m || m.skin) return;
    freeLods(m);
    m.lods = chips.map((c) => { const l = prepare(c); upload(l); return l; });
  }
  function mlod(n, ...d) { const m = models[n]; if (m) m.lodDist = d.length && d.every((v) => v > 0) ? d : null; }
  function draw3d(n, x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, scale = 1) {
    const m = models[n | 0];
    if (!m) return;
    if (giga()) { drawGiga(m, x, y, z, yaw, pitch, roll, scale); return; }
    const nt = m.f.length;
    if (tris + nt > maxTris()) { over = true; ctx.state.use3d = true; return; }   // Datenblatt: mehr schafft der Chip nicht
    tris += nt; calls++;
    drawModel(m, x, y, z, yaw, pitch, roll, scale, null);
  }

  // -------------------------------------------------------------- Instanzlisten: ein Modell, viele Plätze, ein Aufruf
  const instLists = new Array(FX_INST_LISTS).fill(null);
  function inst3d(k, list) {
    k |= 0;
    if (k < 0 || k >= FX_INST_LISTS) throw new Error(`Instanzliste 0–${FX_INST_LISTS - 1}`);
    const old = instLists[k];
    if (!list || !list.length) { if (old) gl.deleteBuffer(old.buf); instLists[k] = null; return 0; }
    const n = Math.min(FX_INST_MAX, Math.floor(list.length / 5));
    const d = new Float32Array(n * 5);
    for (let i = 0; i < n * 5; i++) d[i] = +list[i] || 0;
    for (let i = 0; i < n; i++) if (!d[i * 5 + 4]) d[i * 5 + 4] = 1;   // Größe 0 → 1
    const buf = old?.buf || gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    instLists[k] = { buf, count: n, draw: n };
    return n;
  }
  function bindInst(inst) {
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buf);
    gl.enableVertexAttribArray(LOC.aInst); gl.vertexAttribPointer(LOC.aInst, 4, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(LOC.aInst, 1);
    gl.enableVertexAttribArray(LOC.aInstS); gl.vertexAttribPointer(LOC.aInstS, 1, gl.FLOAT, false, 20, 16); gl.vertexAttribDivisor(LOC.aInstS, 1);
  }
  function unbindInst() {
    gl.disableVertexAttribArray(LOC.aInst); gl.vertexAttribDivisor(LOC.aInst, 0);
    gl.disableVertexAttribArray(LOC.aInstS); gl.vertexAttribDivisor(LOC.aInstS, 0);
  }
  function drawi3d(n, k, x = 0, y = 0, z = 0) {
    const m = models[n | 0], inst = instLists[k | 0];
    if (!m || !inst) return;
    const nt = m.f.length;
    const fit = Math.min(inst.count, Math.floor((maxTris() - tris) / Math.max(1, nt)));
    if (fit < inst.count) over = true;
    if (fit <= 0) { ctx.state.use3d = true; return; }
    tris += nt * fit; calls++;
    inst.draw = fit;
    drawModel(m, x, y, z, 0, 0, 0, 1, inst);
  }

  // Punkt der Welt auf dem Bildschirm – gleiche Rechnung wie im Software-Chip
  function toViewOf(c, x, y, z) {
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const cy = Math.cos(-c.yaw), sy = Math.sin(-c.yaw);
    const rx = dx * cy + dz * sy, rz = -dx * sy + dz * cy;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    return [rx, dy * cp - rz * sp, dy * sp + rz * cp];
  }
  const toView = (x, y, z) => toViewOf(cam, x, y, z);
  function pos3d(x, y, z) {
    const v = toView(x, y, z);
    if (v[2] < NEAR) return null;
    const F = focal(), V = vp();
    return [V.x + V.w / 2 + v[0] / v[2] * F, V.y + V.h / 2 - v[1] / v[2] * F, v[2]];
  }

  // Aufsteller: Sprite zur Kamera gedreht, Fußpunkt bei x, y, z
  function bill3d(n, x, y, z, size = 1, bank = 0, flip = false) {
    const sp = ctx.sprites[n | 0];
    if (!sp) return;
    if (toView(x, y, z)[2] < NEAR) return;
    if (tris + 2 > maxTris()) { over = true; return; }
    begin(1);
    tris += 2; calls++;
    const k = size / Math.max(sp.w, sp.h), w = sp.w * k / 2, h = sp.h * k;
    const corners = [[-w, 0, 0, 1], [w, 0, 1, 1], [w, h, 1, 0], [-w, 0, 0, 1], [w, h, 1, 0], [-w, h, 0, 0]];
    corners.forEach(([px, py, u, v], i) => {
      const o = i * 12;
      quadData.fill(0, o, o + 12);
      quadData[o] = px; quadData[o + 1] = py; quadData[o + 6] = u; quadData[o + 7] = v; quadData[o + 9 + (i % 3)] = 1;
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, quad.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, quadData);
    gl.uniform3f(uni(prog, 'uAnchor'), x, y, z);
    gl.uniform4f(uni(prog, 'uWave'), 0, 0, 0, 0);
    gl.uniform1i(uni(prog, 'uWaveN'), 0);
    gl.uniform1i(uni(prog, 'uGlow'), 1);
    gl.uniform1f(uni(prog, 'uTile'), 1);
    gl.uniform1i(uni(prog, 'uFlip'), flip ? 1 : 0);
    setTexture(n | 0, bank);
    gl.disable(gl.CULL_FACE);
    blendFor(1);
    gl.bindVertexArray(quad.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function line3d(x1, y1, z1, x2, y2, z2, color = 7) {
    begin(2);
    calls++;
    lineData.fill(0);
    lineData[0] = x1; lineData[1] = y1; lineData[2] = z1; lineData[8] = color & 255;
    lineData[12] = x2; lineData[13] = y2; lineData[14] = z2; lineData[20] = color & 255;
    gl.bindBuffer(gl.ARRAY_BUFFER, lineVAO.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineData);
    gl.uniform4f(uni(prog, 'uWave'), 0, 0, 0, 0);
    gl.uniform1i(uni(prog, 'uGlow'), 1);
    setTexture(null);
    gl.disable(gl.CULL_FACE);
    blendFor(1);
    gl.bindVertexArray(lineVAO.vao);
    gl.drawArrays(gl.LINES, 0, 2);
  }

  // -------------------------------------------------------------- Partikel
  // 16 Arten (part3d), ein Ringspeicher mit festen Plätzen. Je Teilchen 10 Zahlen: Start, Tempo, Startzeit,
  // Leben, Art, Zufall. Die Bahn rechnet der Eckpunkt-Shader aus dem Alter – die CPU schreibt nur neue Teilchen.
  const PF = 10;
  const partData = new Float32Array(FX_MAX_PARTS * PF);
  const partBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
  gl.bufferData(gl.ARRAY_BUFFER, partData.byteLength, gl.DYNAMIC_DRAW);
  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  const partVAO = gl.createVertexArray();
  gl.bindVertexArray(partVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
  for (const [loc, n, off] of [[1, 4, 0], [2, 4, 4], [3, 2, 8]]) {
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, PF * 4, off * 4); gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindVertexArray(null);
  const partTypes = new Array(FX_PART_TYPES).fill(null);
  const typeU = { A: new Float32Array(FX_PART_TYPES * 4), B: new Float32Array(FX_PART_TYPES * 4), C: new Float32Array(FX_PART_TYPES * 4), D: new Float32Array(FX_PART_TYPES * 4) };
  let partHead = 0, partUsed = 0, partDirtyLo = Infinity, partDirtyHi = -1, partRand = rng(8), partLast = 0;
  const partMax = () => Q().parts;
  function partMaxChanged() { partHead = 0; partUsed = 0; partData.fill(0); partDirtyLo = 0; partDirtyHi = FX_MAX_PARTS - 1; }
  function part3d(t, o = {}) {
    t |= 0;
    if (t < 0 || t >= FX_PART_TYPES) throw new Error(`Partikel-Art 0–${FX_PART_TYPES - 1}`);
    if (o === null) { partTypes[t] = null; return; }
    const pc = (c) => rgbOf(palRGB((c ?? 7) & 255));
    const formName = (o.form ?? 'punkt').toString();
    const form = Math.max(0, FX_FORMS.indexOf(formName));
    const T = {
      c0: pc(o.farbe ?? 7), c1: pc(o.farbe2 ?? o.farbe ?? 7), s0: Math.max(0, o.groesse ?? 0.2), s1: Math.max(0, o.groesse2 ?? o.groesse ?? 0.2),
      life: clamp(o.leben ?? 1, 0.02, 30), rand: clamp(o.zufall ?? 0.3, 0, 1), spread: Math.max(0, o.streuung ?? 1),
      grav: o.schwerkraft ?? 0, drag: Math.max(0, o.bremse ?? 0), floor: o.boden, glow: clamp(o.glanz ?? 1, 0, 16), form,
      add: o.add ?? true, fadeIn: Math.max(0.5, o.einblenden ?? 14), radius: Math.max(0, o.radius ?? 0),
    };
    partTypes[t] = T;
    typeU.A.set([...T.c0, T.s0], t * 4); typeU.B.set([...T.c1, T.s1], t * 4);
    typeU.C.set([T.grav, T.drag, T.floor ?? 0, T.floor === undefined || T.floor === null ? 0 : 1], t * 4);
    typeU.D.set([T.glow, form, T.add ? 1 : 0, T.fadeIn], t * 4);
  }
  function emit3d(t, x, y, z, count = 1, vx = 0, vy = 0, vz = 0) {
    const T = partTypes[t | 0];
    if (!T) return;
    const n = Math.min(2048, Math.max(0, count | 0)), max = partMax(), now = time();
    for (let i = 0; i < n; i++) {
      const slot = partHead, o = slot * PF;
      partHead = (partHead + 1) % max;
      partUsed = Math.max(partUsed, slot + 1);
      // zufällige Richtung in der Kugel, Stärke = Streuung
      let dx, dy, dz, l;
      do { dx = partRand() * 2 - 1; dy = partRand() * 2 - 1; dz = partRand() * 2 - 1; l = dx * dx + dy * dy + dz * dz; } while (l > 1 || l < 1e-6);
      const sp = T.spread * (0.35 + 0.65 * partRand()) / Math.sqrt(l);
      let px = x, py = y, pz = z;
      if (T.radius > 0) { const rr = T.radius * partRand(); px += dx / Math.sqrt(l) * rr; py += dy / Math.sqrt(l) * rr; pz += dz / Math.sqrt(l) * rr; }
      partData[o] = px; partData[o + 1] = py; partData[o + 2] = pz;
      partData[o + 3] = now - partRand() / 60;   // über das Bild verteilt: kein „Puls“ bei Dauerstrom
      partData[o + 4] = vx + dx * sp; partData[o + 5] = vy + dy * sp; partData[o + 6] = vz + dz * sp;
      partData[o + 7] = T.life * (1 - T.rand * partRand());
      partData[o + 8] = t | 0; partData[o + 9] = partRand();
      partDirtyLo = Math.min(partDirtyLo, slot); partDirtyHi = Math.max(partDirtyHi, slot);
    }
  }
  function partsAlive() {
    const now = time();
    let n = 0;
    for (let i = 0; i < partUsed; i++) { const o = i * PF; if (partData[o + 7] > 0 && now >= partData[o + 3] && now - partData[o + 3] <= partData[o + 7]) n++; }
    return n;
  }
  function parts3d() {
    if (!partUsed) return;
    ensureSize(); syncPalette();
    ctx.state.use3d = true;
    bindTarget();
    markUsed();
    drawSun();
    if (partDirtyHi >= partDirtyLo) {
      gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, partDirtyLo * PF * 4, partData, partDirtyLo * PF, (partDirtyHi - partDirtyLo + 1) * PF);
      partDirtyLo = Infinity; partDirtyHi = -1;
    }
    const V = vp(), F = focal(), pp = P.part;
    gl.useProgram(pp);
    gl.viewport(V.x, ctx.H - V.y - V.h, V.w, V.h);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(V.x, ctx.H - V.y - V.h, V.w, V.h);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.uniform3f(uni(pp, 'uCam'), cam.x, cam.y, cam.z);
    gl.uniform4f(uni(pp, 'uCamRot'), Math.cos(-cam.yaw), Math.sin(-cam.yaw), Math.cos(cam.pitch), Math.sin(cam.pitch));
    gl.uniform2f(uni(pp, 'uProj'), F / (V.w / 2), F / (V.h / 2));
    gl.uniform1f(uni(pp, 'uTime'), time());
    gl.uniform1i(uni(pp, 'uHdr'), hdr());
    gl.uniform4fv(uni(pp, 'uPA[0]'), typeU.A); gl.uniform4fv(uni(pp, 'uPB[0]'), typeU.B);
    gl.uniform4fv(uni(pp, 'uPC[0]'), typeU.C); gl.uniform4fv(uni(pp, 'uPD[0]'), typeU.D);
    gl.bindVertexArray(partVAO);
    gl.enable(gl.BLEND);
    const kinds = partTypes.filter(Boolean);
    if (kinds.some((T) => !T.add)) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1i(uni(pp, 'uAddPass'), 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, partUsed); calls++;
    }
    if (kinds.some((T) => T.add)) {
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform1i(uni(pp, 'uAddPass'), 1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, partUsed); calls++;
    }
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  // -------------------------------------------------------------- Nachbearbeitung: Bild zusammensetzen
  // gfx.present ruft finish(), bevor main.js das 3D-Bild über den 2D-Inhalt legt.
  const fullPass = (p, tgt) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fbo : null);
    gl.viewport(0, 0, tgt ? tgt.w : ctx.W, tgt ? tgt.h : ctx.H);
    gl.useProgram(p);
    gl.bindVertexArray(emptyVAO);
  };
  const bindTex = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
  function regionsUsed() {
    const out = [];
    for (const [key, u] of usedKeys) if (key !== 'all') out.push({ key, V: u.V, cam: u.cam, p: { ...postGlobal, ...(postRegions.get(key) || {}) } });
    return out;
  }
  function sunUV(c, V) {
    const v = toViewOf(c, c.x - light.x * 1000, c.y - light.y * 1000, c.z - light.z * 1000);
    if (v[2] <= 0.1) return null;
    const F = (V.h / 2) / Math.tan(c.fov * Math.PI / 360);
    const sx = V.x + V.w / 2 + v[0] / v[2] * F, sy = V.y + V.h / 2 - v[1] / v[2] * F;
    return [sx / ctx.W, 1 - sy / ctx.H];
  }
  let postMs = 0;
  function finish() {
    if (!postFrame || !dirty) return;
    dirty = false;
    const t0 = performance.now();
    const q = Q(), W = ctx.W, H = ctx.H;
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.depthMask(true);
    const regs = regionsUsed();
    const all = [postGlobal, ...regs.map((r) => r.p)];
    const glow = all.map((p) => p.gluehen).filter(Boolean);
    // Glühen: helle Stellen → kleiner und kleiner → wieder groß und aufaddiert
    const levels = Math.min(q.bloom, chain.length);
    if (glow.length && levels > 0) {
      const thr = Math.min(...glow.map((g) => g.thr)), rad = Math.max(...glow.map((g) => g.r));
      fullPass(P.bright, chain[0]);
      bindTex(0, scene.color);
      gl.uniform1i(uni(P.bright, 'uSrc'), 0);
      gl.uniform2f(uni(P.bright, 'uTexel'), 1 / W, 1 / H);
      gl.uniform2f(uni(P.bright, 'uThr'), thr, Math.max(0.05, thr * 0.5));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (let i = 1; i < levels; i++) {
        fullPass(P.down, chain[i]);
        bindTex(0, chain[i - 1].color);
        gl.uniform1i(uni(P.down, 'uSrc'), 0);
        gl.uniform2f(uni(P.down, 'uTexel'), 1 / chain[i - 1].w, 1 / chain[i - 1].h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = levels - 1; i > 0; i--) {
        fullPass(P.up, chain[i - 1]);
        bindTex(0, chain[i].color);
        gl.uniform1i(uni(P.up, 'uSrc'), 0);
        gl.uniform2f(uni(P.up, 'uTexel'), 1 / chain[i].w, 1 / chain[i].h);
        gl.uniform1f(uni(P.up, 'uRadius'), rad);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }
    // Tiefenunschärfe: auf halbe, Viertel- und Achtel-Größe weichgezeichnet (beim Vergrößern wird es weich)
    const dofOn = q.dof && all.some((p) => p.unschaerfe);
    if (dofOn) {
      let src = scene.color, sw = W, sh = H;
      for (const tg of blurT) {
        fullPass(P.down, tg);
        bindTex(0, src);
        gl.uniform1i(uni(P.down, 'uSrc'), 0);
        gl.uniform2f(uni(P.down, 'uTexel'), 1 / sw, 1 / sh);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = tg.color; sw = tg.w; sh = tg.h;
      }
    }
    // Lichtstrahlen je Ausschnitt (eigene Kamera, eigene Sonne auf dem Bildschirm)
    const rayList = [];
    if (q.rays > 0) {
      if (!regs.length && postGlobal.strahlen && usedKeys.has('all')) rayList.push({ V: { x: 0, y: 0, w: W, h: H }, cam: usedKeys.get('all').cam });
      for (const r of regs) if (r.p.strahlen) rayList.push(r);
    }
    if (rayList.length) {
      fullPass(P.rays, raysT);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      bindTex(0, scene.color); bindTex(1, scene.depth);
      gl.uniform1i(uni(P.rays, 'uSrc'), 0); gl.uniform1i(uni(P.rays, 'uDepth'), 1);
      gl.uniform1i(uni(P.rays, 'uSteps'), q.rays);
      gl.uniform1f(uni(P.rays, 'uThr'), hdr() ? 0.7 : 0.8);
      gl.enable(gl.SCISSOR_TEST);
      for (const r of rayList) {
        const s = sunUV(r.cam, r.V);
        if (!s) continue;
        const rx = r.V.x / W, ry = 1 - (r.V.y + r.V.h) / H, rw = r.V.w / W, rh = r.V.h / H;
        gl.scissor(Math.floor(rx * raysT.w), Math.floor(ry * raysT.h), Math.ceil(rw * raysT.w), Math.ceil(rh * raysT.h));
        gl.uniform2f(uni(P.rays, 'uSun'), s[0], s[1]);
        gl.uniform4f(uni(P.rays, 'uRect'), rx, ry, rw, rh);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.SCISSOR_TEST);
    }
    // 8BOY 128: Umgebungsverdeckung je Ausschnitt (eigene Kamera) aus dem Tiefenbild
    const fx = giga();
    aoRan = !!(fx && ao && q.post && usedKeys.size);
    if (aoRan) {
      fullPass(P.ao, aoT);
      gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      bindTex(4, scene.depth);
      gl.uniform1i(uni(P.ao, 'uDepth'), 4);
      gl.uniform2f(uni(P.ao, 'uSize'), W, H);
      gl.uniform2f(uni(P.ao, 'uP'), ao.r, ao.k);
      gl.enable(gl.SCISSOR_TEST);
      for (const u of usedKeys.values()) {
        const V = u.V, F = (V.h / 2) / Math.tan(u.cam.fov * Math.PI / 360);
        const rx = V.x / W, ry = (H - V.y - V.h) / H, rw = V.w / W, rh = V.h / H;
        gl.scissor(Math.floor(rx * aoT.w), Math.floor(ry * aoT.h), Math.ceil(rw * aoT.w), Math.ceil(rh * aoT.h));
        gl.uniform2f(uni(P.ao, 'uProj'), F / (V.w / 2), F / (V.h / 2));
        gl.uniform4f(uni(P.ao, 'uRect'), rx, ry, rw, rh);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.SCISSOR_TEST);
    }
    // Zusammensetzen ins sichtbare Bild: erst alles mit den globalen Werten, dann je Ausschnitt
    // (8BOY 128: erst in ein Zwischenbild, danach Kantenglättung)
    fullPass(P.comp, fx ? ldrT : null);
    bindTex(0, scene.color); bindTex(1, chain[0].color); bindTex(2, raysT.color); bindTex(3, blurT[2].color); bindTex(4, scene.depth);
    const C = P.comp;
    gl.uniform1i(uni(C, 'uScene'), 0); gl.uniform1i(uni(C, 'uBloom'), 1); gl.uniform1i(uni(C, 'uRays'), 2); gl.uniform1i(uni(C, 'uBlur'), 3); gl.uniform1i(uni(C, 'uDepth'), 4);
    gl.uniform2f(uni(C, 'uSize'), W, H);
    gl.uniform1f(uni(C, 'uTime'), time());
    gl.uniform3fv(uni(C, 'uSunCol'), sun ? sun.col : [1, 0.95, 0.85]);
    gl.uniform1i(uni(C, 'uTM'), fx ? 1 : 0);
    bindTex(5, aoT.color);
    gl.uniform1i(uni(C, 'uAO'), 5);
    gl.uniform4f(uni(C, 'uAOP'), aoRan ? ao.k > 1 ? 1 : ao.k : 0, aoRan ? 1 : 0, 1 / aoT.w, 1 / aoT.h);
    const comp = (p, rect, rays) => {
      const g = levels > 0 ? p.gluehen : null, f = p.farbe, t = p.toenung, fl = p.flimmern, u = q.dof ? p.unschaerfe : null;
      gl.uniform4f(uni(C, 'uRect'), rect[0], rect[1], rect[2], rect[3]);
      gl.uniform4f(uni(C, 'uBloomP'), g ? g.k : 0, g ? 1 : 0, 0, 0);
      gl.uniform4f(uni(C, 'uColorP'), f ? f.exp : 1, f ? f.sat : 1, f ? f.con : 1, f ? 1 : 0);
      gl.uniform4f(uni(C, 'uTint'), t ? t.col[0] : 1, t ? t.col[1] : 1, t ? t.col[2] : 1, t ? t.k : 0);
      gl.uniform4f(uni(C, 'uLook'), p.vignette || 0, p.korn || 0, p.roehre || 0, 0);
      gl.uniform4f(uni(C, 'uDist'), fl ? fl.k : 0, fl ? fl.speed : 1, p.tropfen || 0, 0);
      gl.uniform4f(uni(C, 'uDof'), u ? u.focus : 0, u ? u.range : 1, u ? 1 : 0, 0);
      gl.uniform4f(uni(C, 'uRaysP'), rays ? p.strahlen : 0, rays ? 1 : 0, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    comp(postGlobal, [0, 0, 1, 1], !regs.length && rayList.length > 0);
    if (regs.length) {
      gl.enable(gl.SCISSOR_TEST);
      for (const r of regs) {
        const V = r.V;
        gl.scissor(V.x, H - V.y - V.h, V.w, V.h);
        comp(r.p, [V.x / W, (H - V.y - V.h) / H, V.w / W, V.h / H], !!r.p.strahlen && rayList.includes(r));
      }
      gl.disable(gl.SCISSOR_TEST);
    }
    if (fx) {
      fullPass(P.fxaa, null);
      bindTex(0, ldrT.color);
      gl.uniform1i(uni(P.fxaa, 'uSrc'), 0);
      gl.uniform2f(uni(P.fxaa, 'uTexel'), 1 / W, 1 / H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // Texturen lösen: das nächste Bild malt wieder in scene – nichts darf sie dann noch lesen (Rückkopplung)
    for (let i = 5; i >= 0; i--) bindTex(i, null);
    gl.bindVertexArray(null);
    postMs = performance.now() - t0;
  }

  function reset() {
    prog = giga() ? P.meshGiga : P.mesh;
    for (let i = 0; i < MAX_MODELS; i++) {
      dropModel(models[i]);
      models[i] = null;
    }
    Object.assign(cam, { x: 0, y: 0, z: -5, yaw: 0, pitch: 0, fov: 60 });
    Object.assign(light, { x: -0.4, y: -0.8, z: 0.45, amb: 0.35 });
    normLight();
    lamps.fill(null);
    fog = null; view = null; retro = false; debug = 0; showStats = false; filter = 'pixel'; filterSet = false;
    ctx.state.use3d = false;
    tris = trisLast = calls = callsLast = 0; over = overLast = false;
    // Stufe 2
    sun = null; hfog = null; caus = null; shadow = null;
    ao = { ...AO_START }; env = null; casDbg = false; aoRan = false;
    quality = defaultQuality(renderer);
    post3d();
    postFrame = false; dirty = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    dropShadowMaps();
    for (let i = 0; i < FX_INST_LISTS; i++) if (instLists[i]) { gl.deleteBuffer(instLists[i].buf); instLists[i] = null; }
    partTypes.fill(null); partMaxChanged(); partUsed = 0; partRand = rng(8);
    usedKeys.clear(); sunPending.clear();
  }

  return {
    reset, model, modelData, modelMesh, mtex, texload, texstate, mmat, modelSkin, mpose, malpha, mglow, mcolor, mwave, view3d, camera3d, light3d, fog3d, cls3d, sky3d, draw3d, pos3d, bill3d, line3d,
    lamp3d, filter3d, debug3d, retro3d,
    // Stufe 2
    memit, mshine, madd, mshadow, mwater, post3d, part3d, emit3d, parts3d, inst3d, drawi3d, shadow3d, sun3d, hfog3d, caustic3d, fx3d, finish, ao3d, env3d, modelLods, mlod,
    tris3d: () => trisLast,
    stats3d: () => ({ calls: callsLast, tris: trisLast, limit: overLast, parts: partsAlive(), post: postFrame, postMs, quality, ao: aoRan, kaskaden: [...shadowSets.values()][0]?.cas || 0, weg: culledLast, fern: lodLast }),
    // für main.js: Zähler anzeigen und Grenzen-Hinweis
    get showStats() { return showStats; }, get overLimit() { return over || overLast; },
    get frameTris() { return tris; }, get frameCalls() { return calls; },
    gpu: true, canvas, gl, hdr: floatOK,
  };
}
