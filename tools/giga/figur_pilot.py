# 8BOY 128, Meilenstein 3: Figur „Pilot“ mit Skelett und Animationen – Blender headless
#   blender --background --python tools/giga/figur_pilot.py -- <ziel.glb> [jacke=r,g,b] [helm=r,g,b] [fahren]
#   „fahren“: zusätzlich die Posen Fahren und Jubeln (Fahrzeuge)
#   „spritzen“: Zielen, ZielGehen, ZielRennen, Werfen, Nass, Jubeln (Spritzspiel)
# Bauweise wie Baukasten-Figuren: feste Körperteile, jedes hängt zu 100 % an einem Knochen (robust, sauber in Low-Poly).
# Die Figur schaut nach +Y (Blender) – nach dem Import schaut sie in der Konsole nach +z.
# Animationen: Stehen, Gehen, Rennen, Winken, Springen (je eine Action → je eine glTF-Animation). Alles selbst gebaut (CC0).
import bpy, sys, math
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
ziel = args[0]
farbe = lambda k, d: tuple(float(v) for v in next((a.split('=')[1] for a in args if a.startswith(k + '=')), d).split(','))
FAHREN = 'fahren' in args
SPRITZEN = 'spritzen' in args
bpy.ops.wm.read_factory_settings(use_empty=True)
FPS = 24
bpy.context.scene.render.fps = FPS

def mat(name, rgb, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m
HAUT, JACKE, HOSE, SCHUH, HELM, VISIER = (mat('Haut', (0.85, 0.6, 0.45)), mat('Jacke', farbe('jacke', '0.9,0.25,0.08'), 0.5),
    mat('Hose', (0.08, 0.12, 0.25), 0.8), mat('Schuh', (0.95, 0.95, 0.95), 0.4), mat('Helm', farbe('helm', '0.05,0.45,0.85'), 0.25, 0.3), mat('Visier', (0.05, 0.05, 0.07), 0.1, 0.6))

# ---------------------------------------------------------------- Skelett
bpy.ops.object.armature_add(location=(0, 0, 0))
arm = bpy.context.object
arm.name = 'Pilot'
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
eb.remove(eb[0])
def knochen(name, kopf, schwanz, eltern=None):
    b = eb.new(name); b.head = kopf; b.tail = schwanz
    if eltern: b.parent = eb[eltern]; b.use_connect = False
    return b
knochen('Huefte', (0, 0, 0.95), (0, 0, 1.12))
knochen('Bauch', (0, 0, 1.12), (0, 0, 1.3), 'Huefte')
knochen('Brust', (0, 0, 1.3), (0, 0, 1.52), 'Bauch')
knochen('Hals', (0, 0, 1.52), (0, 0, 1.6), 'Brust')
knochen('Kopf', (0, 0, 1.6), (0, 0, 1.9), 'Hals')
for s, x in (('L', 1), ('R', -1)):
    knochen('Schulter.' + s, (0.06 * x, 0, 1.48), (0.2 * x, 0, 1.48), 'Brust')
    knochen('Oberarm.' + s, (0.2 * x, 0, 1.48), (0.27 * x, 0, 1.2), 'Schulter.' + s)
    knochen('Unterarm.' + s, (0.27 * x, 0, 1.2), (0.31 * x, 0, 0.95), 'Oberarm.' + s)
    knochen('Hand.' + s, (0.31 * x, 0, 0.95), (0.32 * x, 0, 0.85), 'Unterarm.' + s)
    knochen('Oberschenkel.' + s, (0.1 * x, 0, 0.95), (0.11 * x, 0, 0.52), 'Huefte')
    knochen('Unterschenkel.' + s, (0.11 * x, 0, 0.52), (0.11 * x, 0, 0.09), 'Oberschenkel.' + s)
    knochen('Fuss.' + s, (0.11 * x, 0, 0.09), (0.11 * x, 0.16, 0.02), 'Unterschenkel.' + s)
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- Körperteile (je Teil ein Knochen)
teile = []
def teil(art, knochen_name, loc, groesse, material, rot=(0, 0, 0), seg=16):
    if art == 'kugel': bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=max(8, seg // 2), radius=1, location=loc, rotation=rot)
    elif art == 'zyl': bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=1, depth=1, location=loc, rotation=rot)
    else: bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = groesse
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if art == 'box':
        mod = o.modifiers.new('rund', 'BEVEL'); mod.width = min(groesse) * 0.25; mod.segments = 3
        bpy.ops.object.modifier_apply(modifier='rund')
    bpy.ops.object.shade_smooth()
    o.data.materials.append(material)
    g = o.vertex_groups.new(name=knochen_name)
    g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    teile.append(o)
    return o
teil('box', 'Huefte', (0, 0, 1.0), (0.3, 0.2, 0.18), HOSE)
teil('box', 'Bauch', (0, 0, 1.2), (0.3, 0.19, 0.2), JACKE)
teil('box', 'Brust', (0, 0, 1.4), (0.38, 0.22, 0.26), JACKE)
teil('zyl', 'Hals', (0, 0, 1.56), (0.05, 0.05, 0.1), HAUT)
teil('kugel', 'Kopf', (0, 0.01, 1.73), (0.13, 0.14, 0.15), HAUT, seg=24)
teil('kugel', 'Kopf', (0, -0.01, 1.77), (0.145, 0.155, 0.14), HELM, seg=24)
teil('box', 'Kopf', (0, 0.12, 1.75), (0.18, 0.04, 0.07), VISIER)
for s, x in (('L', 1), ('R', -1)):
    teil('kugel', 'Schulter.' + s, (0.2 * x, 0, 1.47), (0.075, 0.075, 0.075), JACKE)
    teil('zyl', 'Oberarm.' + s, (0.235 * x, 0, 1.34), (0.055, 0.055, 0.27), JACKE, rot=(0, math.radians(-14 * x), 0))
    teil('zyl', 'Unterarm.' + s, (0.29 * x, 0, 1.08), (0.045, 0.045, 0.25), HAUT, rot=(0, math.radians(-9 * x), 0))
    teil('kugel', 'Hand.' + s, (0.315 * x, 0, 0.9), (0.055, 0.045, 0.065), HAUT)
    teil('zyl', 'Oberschenkel.' + s, (0.105 * x, 0, 0.74), (0.075, 0.075, 0.42), HOSE)
    teil('zyl', 'Unterschenkel.' + s, (0.11 * x, 0, 0.31), (0.06, 0.06, 0.42), HOSE)
    teil('box', 'Fuss.' + s, (0.11 * x, 0.05, 0.045), (0.11, 0.24, 0.09), SCHUH)
bpy.ops.object.select_all(action='DESELECT')
for o in teile: o.select_set(True)
bpy.context.view_layer.objects.active = teile[0]
bpy.ops.object.join()
koerper = bpy.context.object
koerper.name = 'Koerper'
koerper.parent = arm
mod = koerper.modifiers.new('Skelett', 'ARMATURE'); mod.object = arm

# ---------------------------------------------------------------- Animationen
arm.animation_data_create()
pb = arm.pose.bones
for b in pb: b.rotation_mode = 'XYZ'
R = math.radians
def clip(name, dauer, fn):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    n = int(round(dauer * FPS))
    for f in range(0, n + 1, 2):
        t = f / n                       # 0..1 über die Dauer
        for b in pb: b.rotation_euler = (0, 0, 0); b.location = (0, 0, 0)
        fn(t)
        for b in pb:
            b.keyframe_insert('rotation_euler', frame=f + 1)
            b.keyframe_insert('location', frame=f + 1)
    tr = arm.animation_data.nla_tracks.new(); tr.name = name
    tr.strips.new(name, 1, act)
    arm.animation_data.action = None
s = lambda t, k=1, ph=0: math.sin((t * k + ph) * 2 * math.pi)

def stehen(t):
    pb['Brust'].rotation_euler.x = R(2) * s(t)
    pb['Kopf'].rotation_euler.x = R(-2) * s(t, 1, 0.2)
    for sd, x in (('L', 1), ('R', -1)):
        pb['Oberarm.' + sd].rotation_euler.y = R(3) * x * s(t, 1, 0.1)
        pb['Unterarm.' + sd].rotation_euler.x = R(8)
    pb['Huefte'].location.y = 0.004 * s(t)
def gehen(t):
    w = s(t)
    pb['Huefte'].location.y = 0.025 * abs(s(t, 2, 0.25))            # Knochen-Y = nach oben (Hüfte zeigt nach oben)
    pb['Huefte'].rotation_euler.z = R(6) * w
    pb['Brust'].rotation_euler.z = R(-8) * w
    pb['Oberschenkel.L'].rotation_euler.x = R(28) * w
    pb['Oberschenkel.R'].rotation_euler.x = R(-28) * w
    pb['Unterschenkel.L'].rotation_euler.x = R(-35) * max(0, -s(t, 1, 0.15))
    pb['Unterschenkel.R'].rotation_euler.x = R(-35) * max(0, s(t, 1, 0.15))
    pb['Oberarm.L'].rotation_euler.x = R(-24) * w
    pb['Oberarm.R'].rotation_euler.x = R(24) * w
    for sd in 'LR': pb['Unterarm.' + sd].rotation_euler.x = R(-18)
def rennen(t):
    w = s(t)
    pb['Huefte'].location.y = 0.05 * abs(s(t, 2, 0.25))
    pb['Bauch'].rotation_euler.x = R(12)
    pb['Brust'].rotation_euler.z = R(-12) * w
    pb['Oberschenkel.L'].rotation_euler.x = R(50) * w - R(10)
    pb['Oberschenkel.R'].rotation_euler.x = R(-50) * w - R(10)
    pb['Unterschenkel.L'].rotation_euler.x = R(-80) * max(0, -s(t, 1, 0.1)) - R(15)
    pb['Unterschenkel.R'].rotation_euler.x = R(-80) * max(0, s(t, 1, 0.1)) - R(15)
    pb['Oberarm.L'].rotation_euler.x = R(-45) * w
    pb['Oberarm.R'].rotation_euler.x = R(45) * w
    for sd in 'LR': pb['Unterarm.' + sd].rotation_euler.x = R(-75)
def winken(t):
    stehen(t)
    pb['Oberarm.R'].rotation_euler.z = R(-150)
    pb['Unterarm.R'].rotation_euler.z = R(-20) + R(35) * s(t, 3)
    pb['Kopf'].rotation_euler.z = R(-10)
def springen(t):
    hoch = math.sin(min(1, max(0, (t - 0.25) / 0.6)) * math.pi)
    hocke = math.sin(min(1, t / 0.25) * math.pi) if t < 0.25 else (math.sin(min(1, (t - 0.85) / 0.15) * math.pi) if t > 0.85 else 0)
    pb['Huefte'].location.y = 0.45 * hoch - 0.12 * hocke
    for sd in 'LR':
        pb['Oberschenkel.' + sd].rotation_euler.x = R(45) * hocke + R(25) * hoch
        pb['Unterschenkel.' + sd].rotation_euler.x = R(-80) * hocke - R(45) * hoch
        pb['Fuss.' + sd].rotation_euler.x = R(30) * hocke
        pb['Oberarm.' + sd].rotation_euler.z = R(-120 if sd == 'R' else 120) * hoch
    pb['Bauch'].rotation_euler.x = R(18) * hocke
clip('Stehen', 2.0, stehen)
clip('Gehen', 1.0, gehen)
clip('Rennen', 0.66, rennen)
clip('Winken', 2.0, winken)
clip('Springen', 1.0, springen)
# Jetski: sitzend, Knie vorn, Oberkörper vorgebeugt, Hände am Lenker; Jubeln = beide Arme hoch
def fahren(t):
    pb['Huefte'].location.y = -0.36 + 0.012 * s(t)
    pb['Bauch'].rotation_euler.x = R(-24)         # Knochen-x negativ = nach vorn beugen
    pb['Brust'].rotation_euler.x = R(-16) + R(2) * s(t, 1, 0.3)
    pb['Kopf'].rotation_euler.x = R(20)
    for sd in 'LR':
        pb['Oberschenkel.' + sd].rotation_euler.x = R(78)
        pb['Unterschenkel.' + sd].rotation_euler.x = R(-100)
        pb['Fuss.' + sd].rotation_euler.x = R(22)
        pb['Oberarm.' + sd].rotation_euler.x = R(84)
        pb['Unterarm.' + sd].rotation_euler.x = R(-10)
    pb['Oberschenkel.L'].rotation_euler.z = R(-16); pb['Oberschenkel.R'].rotation_euler.z = R(16)
def jubeln(t):
    fahren(t)
    pb['Bauch'].rotation_euler.x = R(4); pb['Brust'].rotation_euler.x = R(6); pb['Kopf'].rotation_euler.x = R(-6)
    for sd, x in (('L', 1), ('R', -1)):
        pb['Oberarm.' + sd].rotation_euler.x = R(10)
        pb['Oberarm.' + sd].rotation_euler.z = R(-125) * x - R(10) * x * s(t, 2)
        pb['Unterarm.' + sd].rotation_euler.z = R(-15) * x * s(t, 2, 0.25)
if FAHREN:
    clip('Fahren', 1.0, fahren)
    clip('Jubeln', 1.0, jubeln)
# Spritzspiel: Spritze mit beiden Händen nach vorn (rechte Hand am Griff), dazu die Beine aus Stehen/Gehen/Rennen
def ziel_arme():
    pb['Oberarm.R'].rotation_euler.x = R(84); pb['Unterarm.R'].rotation_euler.x = R(-6)
    pb['Oberarm.L'].rotation_euler.x = R(70); pb['Oberarm.L'].rotation_euler.z = R(-24); pb['Unterarm.L'].rotation_euler.x = R(-38)
    pb['Kopf'].rotation_euler.z = R(4)
def zielen(t): stehen(t); ziel_arme()
def zielgehen(t): gehen(t); ziel_arme(); pb['Brust'].rotation_euler.z = 0
def zielrennen(t): rennen(t); ziel_arme(); pb['Brust'].rotation_euler.z = 0; pb['Bauch'].rotation_euler.x = R(-10)
def werfen(t):
    stehen(t)
    k = min(1.0, t / 0.45)                       # ausholen, dann über den Kopf nach vorn
    w = -70 + 220 * (max(0.0, (t - 0.25)) / 0.5 if t > 0.25 else 0) if t < 0.75 else 150
    pb['Oberarm.R'].rotation_euler.x = R(-70 * k if t < 0.25 else w)
    pb['Unterarm.R'].rotation_euler.x = R(-60 if t < 0.4 else -10)
    pb['Brust'].rotation_euler.z = R(-25 if t < 0.25 else 20)
    pb['Oberarm.L'].rotation_euler.x = R(40)
def nass(t):
    stehen(t)
    for sd, x in (('L', 1), ('R', -1)):
        pb['Oberarm.' + sd].rotation_euler.z = R(-95) * x - R(35) * x * s(t, 4, 0.25 if x > 0 else 0)
        pb['Unterarm.' + sd].rotation_euler.z = R(-30) * x * s(t, 4)
    pb['Kopf'].rotation_euler.y = R(18) * s(t, 3)
    pb['Brust'].rotation_euler.y = R(8) * s(t, 3, 0.2)
def jubeln_stehen(t):
    stehen(t)
    for sd, x in (('L', 1), ('R', -1)):
        pb['Oberarm.' + sd].rotation_euler.z = R(-125) * x - R(10) * x * s(t, 2)
    pb['Huefte'].location.y = 0.05 * abs(s(t, 2))
if SPRITZEN:
    clip('Zielen', 2.0, zielen)
    clip('ZielGehen', 1.0, zielgehen)
    clip('ZielRennen', 0.66, zielrennen)
    clip('Werfen', 0.8, werfen)
    clip('Nass', 1.0, nass)
    clip('Jubeln', 1.0, jubeln_stehen)

bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True); koerper.select_set(True)
bpy.ops.export_scene.gltf(filepath=ziel, export_format='GLB', use_selection=True, export_animations=True,
    export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_step=1, export_def_bones=False,
    export_skins=True, export_apply=False)
print('Figur:', ziel, 'Knochen', len(arm.data.bones), 'Ecken', len(koerper.data.vertices))
