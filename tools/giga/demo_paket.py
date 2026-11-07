# 8BOY 128 Demo-Paket (Meilenstein 2): Blender headless
#   blender --background --python tools/giga/demo_paket.py -- <zielordner>
# Erzeugt: kugel.glb (glatt, ohne Textur), kiste.glb (Holzkiste mit Farb-, Normal- und Rauheit/Metall-Textur),
#          fliesen-farbe.png, fliesen-normal.png, fliesen-rm.png (Bodenfliesen zum Kacheln). Alles selbst gebaut (CC0).
import bpy, sys, os, math
import numpy as np

ziel = sys.argv[sys.argv.index('--') + 1]
os.makedirs(ziel, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
N = 512
rng = np.random.default_rng(7)

def bild(name, rgb, nonlinear=True):
    """rgb: H×W×3 in 0..1 → Blender-Bild (als PNG eingebettet)"""
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    if not nonlinear:
        img.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), dtype=np.float32)
    px[:, :, :3] = rgb[::-1]          # Blender: Zeile 0 unten
    img.pixels.foreach_set(px.ravel())
    img.file_format = 'PNG'
    img.pack()
    return img

def png(rgb, datei):
    """rgb: H×W×3 in 0..1 → PNG (8 Bit, ohne Farbmanagement – Werte bleiben exakt)"""
    import zlib, struct
    h, w = rgb.shape[:2]
    roh = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    zeilen = b''.join(b'\x00' + roh[r].tobytes() for r in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(os.path.join(ziel, datei), 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(zeilen, 9)) + chunk(b'IEND', b''))

def hoehe_zu_normal(hm, staerke):
    gy, gx = np.gradient(hm)
    n = np.dstack([-gx * staerke, gy * staerke, np.ones_like(hm)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5

y, x = np.mgrid[0:N, 0:N] / N

# ---------------------------------------------------------------- Holzkiste
bretter = np.floor(y * 5)
mase = np.sin((x * 3 + bretter * 1.7) * 9 + np.sin(y * 40 + bretter) * 0.6) * 0.5 + 0.5
holz = np.dstack([0.55 + mase * 0.15, 0.33 + mase * 0.1, 0.16 + mase * 0.05])
fuge = (np.abs(np.mod(y * 5, 1) - 0.5) > 0.47)
rand = (x < 0.08) | (x > 0.92) | (y < 0.08) | (y > 0.92)
farbe = np.where(fuge[..., None], holz * 0.45, holz)
farbe = np.where(rand[..., None], np.array([0.42, 0.44, 0.47]), farbe)
for nx, ny in [(0.04, 0.04), (0.96, 0.04), (0.04, 0.96), (0.96, 0.96)]:       # Nieten
    farbe = np.where((((x - nx) ** 2 + (y - ny) ** 2) < 0.0004)[..., None], np.array([0.8, 0.8, 0.82]), farbe)
hm = mase * 0.15 - fuge * 0.6 + rand * 0.4
normal = hoehe_zu_normal(hm, 6.0)
rm = np.dstack([np.zeros_like(x), np.where(rand, 0.35, 0.75 - mase * 0.1), np.where(rand, 1.0, 0.0)])   # G = Rauheit, B = Metall
k_farbe, k_normal, k_rm = bild('kiste_farbe', farbe), bild('kiste_normal', normal, False), bild('kiste_rm', rm, False)

mat = bpy.data.materials.new('Kiste')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
def tex(img):
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; return t
t1, t2, t3 = tex(k_farbe), tex(k_normal), tex(k_rm)
nt.links.new(t1.outputs['Color'], bsdf.inputs['Base Color'])
nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(t2.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(t3.outputs['Color'], sep.inputs['Color'])
nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])

bpy.ops.mesh.primitive_cube_add(size=2)
kiste = bpy.context.object
kiste.data.materials.append(mat)
bpy.ops.object.select_all(action='DESELECT'); kiste.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(ziel, 'kiste.glb'), export_format='GLB', use_selection=True, export_apply=True)
bpy.data.objects.remove(kiste)

# ---------------------------------------------------------------- glatte Kugel (Materialreihe)
bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1)
k = bpy.context.object
bpy.ops.object.shade_smooth()
km = bpy.data.materials.new('Kugel'); km.use_nodes = True
km.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.9, 0.9, 0.9, 1)
k.data.materials.append(km)
bpy.ops.object.select_all(action='DESELECT'); k.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(ziel, 'kugel.glb'), export_format='GLB', use_selection=True, export_apply=True)

# ---------------------------------------------------------------- Bodenfliesen (kachelbar)
fx, fy = np.mod(x * 4, 1), np.mod(y * 4, 1)
fuge2 = (fx < 0.035) | (fy < 0.035)
feld = (np.floor(x * 4) + np.floor(y * 4)) % 2
grund = np.where(feld[..., None] > 0, np.array([0.78, 0.76, 0.72]), np.array([0.32, 0.36, 0.42]))
grund = grund * (0.92 + rng.random((N, N, 1)) * 0.08)
f_farbe = np.where(fuge2[..., None], np.array([0.18, 0.17, 0.16]), grund)
f_hm = np.where(fuge2, 0.0, 1.0) - rng.random((N, N)) * 0.04
f_normal = hoehe_zu_normal(f_hm, 3.0)
f_rm = np.dstack([np.zeros_like(x), np.where(fuge2, 0.9, np.where(feld > 0, 0.25, 0.4)), np.zeros_like(x)])
png(f_farbe, 'fliesen-farbe.png')
png(f_normal, 'fliesen-normal.png')
png(f_rm, 'fliesen-rm.png')
print('Demo-Paket fertig:', ziel)
