# 8BOY 128 Licht-Paket (Meilenstein 4): Innenhof mit gebackener Lightmap und zwei Panoramen – Blender headless
#   blender --background --python tools/giga/licht_hof.py -- <zielordner> [--schnell]
# Erzeugt: hof.glb        der Innenhof als ein Modell, zweite UV-Ebene „Licht“ für die Lightmap (Maße in Metern)
#          hof-licht.png  Lightmap: Himmelslicht mit Verdeckung + Licht, das von Wänden und Boden zurückprallt
#                         (Sonne nur indirekt – das direkte Sonnenlicht und seine Schatten rechnet der 8BOY 128 live).
#                         Gespeichert als (Licht / 2) mit Gamma 2.2 → in der Kartridge lichtstaerke = 2.
#          hof-umgebung.png  Panorama aus der Hofmitte (für Spiegelungen auf Metall und Glanz)
#          himmel.png     Panorama nur vom Himmel (Hintergrund)
# Welt-Koordinaten des 8BOY 128 = Blender x, z, y. Sonne passend zu light3d(-0.4, -0.75, 0.5).
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
ziel = os.path.abspath(args[0])
schnell = '--schnell' in args
os.makedirs(ziel, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'None'

# Grafikkarte, wenn vorhanden
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for typ in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = typ
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == typ]
            if gpus:
                for d in prefs.devices: d.use = d.type == typ
                sc.cycles.device = 'GPU'
                print('LICHT Grafikkarte:', typ, gpus[0].name)
                break
        except Exception as e:
            print('LICHT', typ, 'nicht nutzbar:', e)
except Exception as e:
    print('LICHT nur Prozessor:', e)

# ---------------------------------------------------------------- Welt: Himmel als Verlauf (Richtung → Farbe)
welt = bpy.data.worlds.new('Himmel'); welt.use_nodes = True; sc.world = welt
nt = welt.node_tree; nt.nodes.clear()
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB')
bg = nt.nodes.new('ShaderNodeBackground')
out = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(tc.outputs['Generated'], sep.inputs[0])
# Z = -1 … 1 → 0 … 1
mapr = nt.nodes.new('ShaderNodeMapRange')
mapr.inputs['From Min'].default_value = -1; mapr.inputs['From Max'].default_value = 1
nt.links.new(sep.outputs['Z'], mapr.inputs['Value'])
nt.links.new(mapr.outputs['Result'], ramp.inputs['Fac'])
el = ramp.color_ramp.elements
el[0].position = 0.0; el[0].color = (0.10, 0.09, 0.08, 1)        # tief unten: Boden
el[1].position = 0.49; el[1].color = (0.22, 0.20, 0.17, 1)       # Boden am Horizont
for pos, col in [(0.5, (0.62, 0.74, 0.92, 1)), (0.62, (0.36, 0.55, 0.88, 1)), (1.0, (0.10, 0.26, 0.70, 1))]:
    e = el.new(pos); e.color = col
nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.0
nt.links.new(bg.outputs[0], out.inputs[0])

# ---------------------------------------------------------------- Materialien (nur Farben, Lightmap bringt die Tiefe)
def stoff(name, rgb, rauh=0.8):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rauh
    return m
M = {
    'stein': stoff('Stein', (0.26, 0.22, 0.18)),
    'rot': stoff('Putz rot', (0.55, 0.09, 0.04)),
    'weiss': stoff('Putz hell', (0.50, 0.46, 0.40)),
    'gelb': stoff('Putz gelb', (0.60, 0.38, 0.10)),
    'holz': stoff('Holz', (0.30, 0.15, 0.05)),
    'saeule': stoff('Säule', (0.62, 0.60, 0.55)),
    'dach': stoff('Dach', (0.36, 0.14, 0.08)),
    'gras': stoff('Gras', (0.16, 0.30, 0.08)),
    'wasser': stoff('Brunnen', (0.30, 0.34, 0.38), 0.3),
}
teile = []
def box(name, mitte, groesse, mat):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * groesse[0] + mitte[0], v.co.y * groesse[1] + mitte[1], v.co.z * groesse[2] + mitte[2]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o)
    me.materials.append(M[mat]); teile.append(o)
    return o
def zylinder(name, mitte, r, h, mat, n=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=h, location=(mitte[0], mitte[1], mitte[2] + h / 2))
    o = bpy.context.object; o.name = name
    o.data.materials.append(M[mat]); teile.append(o)
    try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    except Exception: pass
    return o

H, R = 4.0, 7.0   # Wandhöhe, halbe Hofbreite
box('Boden', (0, 0, -0.1), (2 * R, 2 * R, 0.2), 'stein')
box('Wand Nord', (0, R + 0.2, H / 2), (2 * R + 0.8, 0.4, H), 'rot')
box('Wand Ost', (R + 0.2, 0, H / 2), (0.4, 2 * R, H), 'weiss')
box('Wand West', (-R - 0.2, 0, H / 2), (0.4, 2 * R, H), 'gelb')
# Südwand mit Tor (3 m breit)
box('Wand Süd links', (-(R + 1.5) / 2 - 0.2, -R - 0.2, H / 2), (R - 1.5 + 0.4, 0.4, H), 'weiss')
box('Wand Süd rechts', ((R + 1.5) / 2 + 0.2, -R - 0.2, H / 2), (R - 1.5 + 0.4, 0.4, H), 'weiss')
box('Torbalken', (0, -R - 0.2, H - 0.5), (3.0, 0.4, 1.0), 'weiss')
box('Vorplatz', (0, -R - 3.4, -0.1), (8, 6, 0.2), 'gras')
# Arkade an der Westseite: Dach auf vier Säulen
box('Arkadendach', (-R + 1.3, 0, 3.15), (2.6, 2 * R, 0.3), 'dach')
for y in (-4.5, -1.5, 1.5, 4.5):
    zylinder(f'Säule {y}', (-R + 2.3, y, 0), 0.22, 3.0, 'saeule', 16)
# Treppe und Podest an der Ostseite
for i in range(4):
    box(f'Stufe {i}', (R - 1.25, -5.6 + i * 0.5, 0.15 * (i + 1)), (2.5, 0.5, 0.3 * (i + 1)), 'stein')
box('Podest', (R - 1.25, -1.5, 0.6), (2.5, 3.6, 1.2), 'stein')
# Brunnen in der Mitte
zylinder('Becken', (0, 1.5, 0), 1.5, 0.55, 'stein', 40)
zylinder('Wasser', (0, 1.5, 0), 1.3, 0.45, 'wasser', 40)
zylinder('Brunnensäule', (0, 1.5, 0), 0.25, 1.4, 'saeule', 20)
# Kisten
box('Kiste 1', (4.6, 5.2, 0.4), (0.8, 0.8, 0.8), 'holz')
box('Kiste 2', (5.5, 5.0, 0.4), (0.8, 0.8, 0.8), 'holz')
box('Kiste 3', (5.0, 5.15, 1.2), (0.8, 0.8, 0.8), 'holz')
box('Kiste 4', (-3.4, -5.6, 0.35), (0.7, 0.7, 0.7), 'holz')

# alles zu einem Modell
bpy.ops.object.select_all(action='DESELECT')
for o in teile: o.select_set(True)
bpy.context.view_layer.objects.active = teile[0]
bpy.ops.object.join()
hof = bpy.context.object; hof.name = 'Hof'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = hof.data
# UV0 (Platzhalter, wird zu TEXCOORD_0) und „Licht“ (TEXCOORD_1) – beide aus Smart-UV, Licht ohne Überlappung
# (Zylinder bringen eigene UVs mit – alle weg, damit „Licht“ sicher die zweite Ebene ist)
while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
for n in ('UV0', 'Licht'): me.uv_layers.new(name=n)
me.uv_layers.active = me.uv_layers['Licht']
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
try: bpy.ops.uv.pack_islands(margin=0.006, rotate=True)
except Exception as e: print('LICHT pack_islands:', e)
bpy.ops.object.mode_set(mode='OBJECT')
print('LICHT Dreiecke:', sum(len(p.vertices) - 2 for p in me.polygons))

# Lampe unter der Arkade (warm), Sonne
lampe = bpy.data.objects.new('Laterne', bpy.data.lights.new('Laterne', 'POINT'))
lampe.data.energy = 120; lampe.data.color = (1.0, 0.62, 0.30); lampe.data.shadow_soft_size = 0.15
lampe.location = (-R + 0.9, 0, 2.6); sc.collection.objects.link(lampe)
sonne = bpy.data.objects.new('Sonne', bpy.data.lights.new('Sonne', 'SUN'))
sonne.data.energy = math.pi; sonne.data.angle = math.radians(1.5); sc.collection.objects.link(sonne)
richtung = Vector((-0.4, 0.5, -0.75)).normalized()      # light3d(-0.4, -0.75, 0.5) in Blender-Achsen
sonne.rotation_euler = richtung.to_track_quat('-Z', 'Y').to_euler()

# ---------------------------------------------------------------- Lightmap backen
GROESSE = 512 if schnell else 1024
sc.cycles.samples = 64 if schnell else 512
def backbild(name):
    img = bpy.data.images.new(name, GROESSE, GROESSE, alpha=False, float_buffer=True)
    for m in hof.data.materials:
        nodes = m.node_tree.nodes
        n = nodes.get('Backziel') or nodes.new('ShaderNodeTexImage')
        n.name = 'Backziel'; n.image = img
        nodes.active = n
    return img
def backen(name, passes):
    img = backbild(name)
    bpy.ops.object.select_all(action='DESELECT'); hof.select_set(True); bpy.context.view_layer.objects.active = hof
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=passes, margin=6, margin_type='EXTEND', use_clear=True, uv_layer='Licht')
    px = np.empty(GROESSE * GROESSE * 4, dtype=np.float32); img.pixels.foreach_get(px)
    return px.reshape(GROESSE, GROESSE, 4)[:, :, :3]
# A: Himmel (mit Verdeckung) und Laterne, samt Abprall
sonne.hide_render = True; lampe.hide_render = False; bg.inputs['Strength'].default_value = 1.0
a = backen('LM Himmel', {'DIRECT', 'INDIRECT'})
# B: nur das, was von der Sonne zurückprallt
sonne.hide_render = False; lampe.hide_render = True; bg.inputs['Strength'].default_value = 0.0
b = backen('LM Sonne', {'INDIRECT'})
lm = a + b
print('LICHT Lightmap: Mittel %.3f, 99%% %.3f, max %.3f' % (lm.mean(), np.percentile(lm, 99), lm.max()))

def png(rgb, datei, oben_zuerst=False):
    """rgb: H×W×3 in 0..1, Zeile 0 unten (Blender) → PNG, 8 Bit"""
    import zlib, struct
    if not oben_zuerst: rgb = rgb[::-1]
    h, w = rgb.shape[:2]
    roh = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    zeilen = b''.join(b'\x00' + roh[r].tobytes() for r in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(os.path.join(ziel, datei), 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(zeilen, 9)) + chunk(b'IEND', b''))
srgb = lambda x: np.power(np.clip(x, 0, None), 1 / 2.2)
png(srgb(lm / 2.0), 'hof-licht.png')

# ---------------------------------------------------------------- Panoramen (equirektangular, Kamera Blick Blender +Y)
cd = bpy.data.cameras.new('Pano'); cd.type = 'PANO'
try: cd.panorama_type = 'EQUIRECTANGULAR'
except Exception: cd.cycles.panorama_type = 'EQUIRECTANGULAR'
kam = bpy.data.objects.new('Pano', cd); sc.collection.objects.link(kam); sc.camera = kam
kam.rotation_euler = (math.pi / 2, 0, 0)
sc.render.resolution_x, sc.render.resolution_y = (512, 256) if schnell else (1024, 512)
sc.render.resolution_percentage = 100
sc.cycles.samples = 32 if schnell else 128
sc.cycles.use_denoising = True
sc.render.image_settings.file_format = 'OPEN_EXR'
sc.render.image_settings.color_depth = '32'
def pano(datei, mit_hof):
    hof.hide_render = not mit_hof
    sonne.hide_render = False; lampe.hide_render = not mit_hof; bg.inputs['Strength'].default_value = 1.0
    tmp = os.path.join(ziel, '_pano.exr')
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px)
    bpy.data.images.remove(img); os.remove(tmp)
    rgb = px.reshape(h, w, 4)[:, :, :3]
    print('LICHT Panorama %s: Mittel %.3f, max %.3f' % (datei, rgb.mean(), rgb.max()))
    png(srgb(rgb), datei)
kam.location = (0, -1.0, 1.6)
pano('hof-umgebung.png', True)
kam.location = (0, 0, 1.6)
pano('himmel.png', False)

# ---------------------------------------------------------------- Modell ausgeben (ohne Backziele)
for m in hof.data.materials:
    n = m.node_tree.nodes.get('Backziel')
    if n: m.node_tree.nodes.remove(n)
bpy.ops.object.select_all(action='DESELECT'); hof.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(ziel, 'hof.glb'), export_format='GLB', use_selection=True, export_texcoords=True, export_normals=True, export_yup=True, export_apply=True)
print('LICHT fertig:', ziel)
