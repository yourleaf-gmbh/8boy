# Probe-Jetski für das Asset-System (8BOY 128): Blender headless
#   blender --background --python tools/giga/jetski_test.py -- <ziel.glb>
import bpy, sys
ziel = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(name, rgb, metal=0.0, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    return m
lack, sitz, chrom = mat('Lack', (0.9, 0.08, 0.35), 0.1, 0.25), mat('Sitz', (0.05, 0.05, 0.07), 0, 0.8), mat('Chrom', (0.8, 0.8, 0.85), 1, 0.2)
# Rumpf: abgerundeter, vorne spitzer Kasten
bpy.ops.mesh.primitive_cube_add(size=1)
r = bpy.context.object; r.name = 'Rumpf'; r.scale = (0.7, 2.2, 0.45); r.location = (0, 0, 0.25)
bpy.ops.object.transform_apply(scale=True)
for v in r.data.vertices:
    if v.co.y > 0.5: v.co.x *= 0.35; v.co.z += 0.08
mod = r.modifiers.new('Rund', 'BEVEL'); mod.width = 0.12; mod.segments = 3
r.data.materials.append(lack)
# Sitz und Lenker
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.4, 0.58)); s = bpy.context.object; s.scale = (0.45, 1.1, 0.18); s.data.materials.append(sitz)
mod = s.modifiers.new('Rund', 'BEVEL'); mod.width = 0.06; mod.segments = 2
bpy.ops.mesh.primitive_cylinder_add(radius=0.04, depth=0.9, location=(0, 0.45, 0.85), rotation=(0, 1.5708, 0)); l = bpy.context.object; l.data.materials.append(chrom)
bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=0.45, location=(0, 0.42, 0.62)); st = bpy.context.object; st.data.materials.append(chrom)
bpy.ops.export_scene.gltf(filepath=ziel, export_format='GLB', export_apply=True)
print('GLB:', ziel)
