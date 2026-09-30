# Build a MakeHuman (MPFB) character headlessly and export it as a skinned GLB.
# usage: python3 tools/make_character.py spec.json out.glb
# spec: {"name", "phenotype": {...}, "skin", "eyes_mat", "eyebrows", "eyelashes", "hair", "clothes": [...], "proxy", "rig"}
import sys, json, os
import bpy

spec = json.load(open(sys.argv[-2]))
out = sys.argv[-1]

# start from an empty scene
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
from bl_ext.user_default.mpfb.services.humanservice import HumanService

info = HumanService._create_default_human_info_dict()
info["name"] = spec.get("name", "human")
ph = info["phenotype"]
for k, v in spec.get("phenotype", {}).items():
    ph[k] = v
info["rig"] = spec.get("rig", "game_engine")
info["eyes"] = "low-poly/low-poly.mhclo"
info["eyebrows"] = spec.get("eyebrows", "eyebrow001/eyebrow001.mhclo")
info["eyelashes"] = spec.get("eyelashes", "eyelashes01/eyelashes01.mhclo")
info["hair"] = spec.get("hair", "")
info["proxy"] = spec.get("proxy", "")
info["clothes"] = spec.get("clothes", [])
info["skin_mhmat"] = spec["skin"]
info["skin_material_type"] = "MAKESKIN"
info["eyes_material_type"] = "MAKESKIN"
info["clothes_material_type"] = "MAKESKIN"
info["targets"] = spec.get("targets", [])

settings = HumanService.get_default_deserialization_settings()
settings["subdiv_levels"] = 0
settings["mask_helpers"] = True
basemesh = HumanService.deserialize_from_dict(info, settings)

# eye colour: swap the eye texture for the requested iris
eye_mat = spec.get("eyes_mat")
if eye_mat:
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and 'eye' in ob.name.lower() and 'brow' not in ob.name.lower() and 'lash' not in ob.name.lower():
            for slot in ob.material_slots:
                m = slot.material
                if not m or not m.use_nodes: continue
                for n in m.node_tree.nodes:
                    if n.type == 'TEX_IMAGE' and n.image and 'eye' in n.image.name.lower():
                        p = bpy.path.abspath(n.image.filepath)
                        np = os.path.join(os.path.dirname(p), eye_mat + '_eye.png')
                        if os.path.exists(np): n.image = bpy.data.images.load(np)

# with a proxy body, the full-resolution base mesh is only a fitting helper: don't export it
objs = [o for o in bpy.data.objects]
rig = next((o for o in objs if o.type == 'ARMATURE'), None)
for o in objs:
    print("OBJ", o.name, o.type, len(o.data.vertices) if o.type == 'MESH' else '', [s.material.name for s in o.material_slots if s.material] if o.type == 'MESH' else '')
keep = []
for o in objs:
    if o.type == 'ARMATURE': keep.append(o); continue
    if o.type != 'MESH': continue
    if info["proxy"] and o == basemesh: continue
    keep.append(o)
# match the animation library's bone names (vertex groups follow the rename)
if rig:
    for old, new in (("Root", "root"), ("head", "Head")):
        if old in rig.data.bones: rig.data.bones[old].name = new
bpy.ops.object.select_all(action='DESELECT')
for o in keep: o.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True,
                          export_animations=False, export_skins=True, export_yup=True,
                          export_image_format='AUTO', export_texcoords=True, export_normals=True)
print("EXPORTED", out, os.path.getsize(out))
