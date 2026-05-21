"""Convert a Character Creator FBX avatar to GLB and report morph targets.

Usage:
  blender --background --python scripts/convert-fbx-to-glb.py -- \
    --fbx avatar1_0.Fbx \
    --out public/avatar1_0.glb \
    --report public/avatar1_0.morph-report.json

The script intentionally avoids aggressive optimization. For lip sync and
Audio2Face work, the first export should preserve skinning, materials and morph
targets so the target names can be inspected and mapped.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fbx", default="avatar1_0.Fbx", help="Input FBX path.")
    parser.add_argument("--out", default="public/avatar1_0.glb", help="Output GLB path.")
    parser.add_argument(
        "--report",
        default="public/avatar1_0.morph-report.json",
        help="Output JSON report with meshes, bones, materials and shape keys.",
    )
    parser.add_argument(
        "--selected-only",
        action="store_true",
        help="Export only selected objects. By default exports the whole scene.",
    )
    parser.add_argument(
        "--upper-body",
        action="store_true",
        help="Export a lighter bust-style avatar by removing lower-body/accessory geometry.",
    )
    parser.add_argument(
        "--head-only",
        action="store_true",
        help="Export only the head/face region for facial animation inspection.",
    )
    parser.add_argument(
        "--face-only",
        action="store_true",
        help="Export only CC_Base_Body head geometry. Drops hair/brows/lashes to maximize FPS for morph debugging.",
    )
    parser.add_argument(
        "--a2f-morphs-only",
        action="store_true",
        help="Keep only the morph targets currently mapped from Audio2Face/ARKit in the browser demo.",
    )
    parser.add_argument(
        "--morph-normals",
        action="store_true",
        help="Export morph normals. This looks a bit nicer but heavily increases GLB size and WebGL cost.",
    )
    parser.add_argument(
        "--cut-ratio",
        type=float,
        default=None,
        help="Cut height as ratio from model bottom to top. Defaults to waist for --upper-body, neck for --head-only.",
    )
    argv = sys.argv
    script_args = argv[argv.index("--") + 1 :] if "--" in argv else []
    return parser.parse_args(script_args)


AUDIO2FACE_MORPHS = {
    "Basis",
    "V_None",
    "V_Open",
    "V_Explosive",
    "V_Dental_Lip",
    "V_Tight_O",
    "V_Tight",
    "V_Wide",
    "V_Affricate",
    "V_Lip_Open",
    "V_Tongue_up",
    "V_Tongue_Out",
    "Jaw_Open",
    "Jaw_Open_Extreme",
    "Jaw_Left",
    "Jaw_Right",
    "Jaw_Fwd",
    "Jaw_Chin_Raise_DL",
    "Jaw_Chin_Raise_DR",
    "Jaw_Clench_L",
    "Jaw_Clench_R",
    "Brow_Down_L",
    "Brow_Down_R",
    "Brow_Raise_In_L",
    "Brow_Raise_In_R",
    "Brow_Raise_Outer_L",
    "Brow_Raise_Outer_R",
    "Eye_Blink_L",
    "Eye_Blink_R",
    "Eye_Widen_L",
    "Eye_Widen_R",
    "Eye_Squint_Inner_L",
    "Eye_Squint_Inner_R",
    "Eye_Squint_L",
    "Eye_Squint_R",
    "Eye_Cheek_Raise_L",
    "Eye_Cheek_Raise_R",
    "Mouth_Cheek_Suck_L",
    "Mouth_Cheek_Suck_R",
    "Mouth_Cheek_Blow_L",
    "Mouth_Cheek_Blow_R",
    "Mouth_UpperLip_Raise_L",
    "Mouth_UpperLip_Raise_R",
    "Mouth_LowerLip_Depress_L",
    "Mouth_LowerLip_Depress_R",
    "Mouth_Corner_Pull_L",
    "Mouth_Corner_Pull_R",
    "Mouth_Stretch_L",
    "Mouth_Stretch_R",
    "Mouth_Dimple_L",
    "Mouth_Dimple_R",
    "Mouth_Corner_Depress_L",
    "Mouth_Corner_Depress_R",
    "Mouth_Left",
    "Mouth_Right",
    "Mouth_Lips_Purse_UL",
    "Mouth_Lips_Purse_UR",
    "Mouth_Lips_Purse_DL",
    "Mouth_Lips_Purse_DR",
    "Mouth_Lips_Towards_UL",
    "Mouth_Lips_Towards_UR",
    "Mouth_Lips_Towards_DL",
    "Mouth_Lips_Towards_DR",
    "Mouth_Funnel_UL",
    "Mouth_Funnel_UR",
    "Mouth_Funnel_DL",
    "Mouth_Funnel_DR",
    "Mouth_Lips_Tighten_UL",
    "Mouth_Lips_Tighten_UR",
    "Mouth_Lips_Tighten_DL",
    "Mouth_Lips_Tighten_DR",
    "Mouth_Lips_Press_L",
    "Mouth_Lips_Press_R",
    "Mouth_Lips_Thin_UL",
    "Mouth_Lips_Thin_UR",
    "Mouth_Lips_Thin_DL",
    "Mouth_Lips_Thin_DR",
    "Mouth_LowerLip_RollIn_L",
    "Mouth_LowerLip_RollIn_R",
    "Mouth_UpperLip_RollIn_L",
    "Mouth_UpperLip_RollIn_R",
    "Mouth_LowerLip_Towards_Teeth_L",
    "Mouth_LowerLip_Towards_Teeth_R",
    "Mouth_UpperLip_Towards_Teeth_L",
    "Mouth_UpperLip_Towards_Teeth_R",
    "Mouth_UpperLip_Shift_Left",
    "Mouth_UpperLip_Shift_Right",
    "Mouth_LowerLip_Shift_Left",
    "Mouth_LowerLip_Shift_Right",
    "Nose_Wrinkle_L",
    "Nose_Wrinkle_R",
    "Nose_Wrinkle_Upper_L",
    "Nose_Wrinkle_Upper_R",
    "Nose_Nasolabial_Deepen_L",
    "Nose_Nasolabial_Deepen_R",
    "Nose_Nostril_Dilate_L",
    "Nose_Nostril_Dilate_R",
    "Tongue_Out",
    "Tongue_Up",
    "Tongue_Down",
    "Tongue_Left",
    "Tongue_Right",
    "Tongue_Narrow",
    "Tongue_Wide",
}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_fbx(path: Path) -> None:
    bpy.ops.import_scene.fbx(
        filepath=str(path),
        use_image_search=True,
        use_custom_normals=True,
        automatic_bone_orientation=False,
    )


def collect_report() -> dict:
    meshes = []
    armatures = []
    materials = set()

    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE":
            armatures.append(
                {
                    "name": obj.name,
                    "bones": [bone.name for bone in obj.data.bones],
                }
            )
            continue

        if obj.type != "MESH":
            continue

        shape_keys = []
        if obj.data.shape_keys:
            shape_keys = [key.name for key in obj.data.shape_keys.key_blocks]

        material_names = [slot.material.name for slot in obj.material_slots if slot.material]
        materials.update(material_names)
        meshes.append(
            {
                "name": obj.name,
                "vertex_count": len(obj.data.vertices),
                "materials": material_names,
                "shape_keys": shape_keys,
                "shape_key_count": len(shape_keys),
                "has_morph_targets": len(shape_keys) > 1,
            }
        )

    return {
        "meshes": meshes,
        "armatures": armatures,
        "materials": sorted(materials),
        "summary": {
            "mesh_count": len(meshes),
            "armature_count": len(armatures),
            "material_count": len(materials),
            "meshes_with_morphs": [mesh["name"] for mesh in meshes if mesh["has_morph_targets"]],
        },
    }


def get_scene_z_bounds() -> tuple[float, float]:
    values = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        values.extend((obj.matrix_world @ Vector(corner)).z for corner in obj.bound_box)

    if not values:
        return 0.0, 0.0

    return min(values), max(values)


def remove_objects_by_name(names: set[str]) -> None:
    for obj in list(bpy.context.scene.objects):
        if obj.name in names:
            bpy.data.objects.remove(obj, do_unlink=True)


def remove_vertices_below_world_z(obj, cut_z: float) -> int:  # noqa: ANN001
    if obj.type != "MESH" or not obj.data.vertices:
        return 0

    if obj.data.shape_keys:
        obj.active_shape_key_index = 0

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="VERT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")

    selected = 0
    for vertex in obj.data.vertices:
        vertex.select = (obj.matrix_world @ vertex.co).z < cut_z
        if vertex.select:
            selected += 1

    obj.data.update()

    if selected == 0:
        return 0

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")

    bpy.ops.object.material_slot_remove_unused()
    return selected


def make_upper_body_export(cut_ratio: float) -> dict:
    """Remove lower-body geometry for browser-friendly avatar tests."""
    remove_objects_by_name({"Sport_Sneakers", "Slim_Fit_Trousers", "Sphere01", "default"})

    min_z, max_z = get_scene_z_bounds()
    cut_z = min_z + ((max_z - min_z) * cut_ratio)
    trimmed = {}
    trim_meshes = {
        "CC_Base_Body",
        "RS_Regular_Fit_Shirt",
        "CC_Base_EyeOcclusion",
        "CC_Base_TearLine",
        "Eyelash_Low",
        "Eyelash_Up",
        "Brows",
        "Stubble",
        "Classic_Slick_Back",
    }

    for obj in bpy.context.scene.objects:
        if obj.name in trim_meshes:
            removed = remove_vertices_below_world_z(obj, cut_z)
            if removed:
                trimmed[obj.name] = removed

    return {
        "mode": "upper_body",
        "cut_ratio": cut_ratio,
        "cut_z": cut_z,
        "removed_vertices_by_mesh": trimmed,
    }


def make_head_only_export(cut_ratio: float) -> dict:
    """Remove body/clothes and keep the facial rig for close-up tests."""
    remove_objects_by_name({"Sport_Sneakers", "Slim_Fit_Trousers", "Sphere01", "default", "RS_Regular_Fit_Shirt"})

    min_z, max_z = get_scene_z_bounds()
    cut_z = min_z + ((max_z - min_z) * cut_ratio)
    trimmed = {}
    keep_meshes = {
        "CC_Base_Body",
        "CC_Base_EyeOcclusion",
        "CC_Base_TearLine",
        "Eyelash_Low",
        "Eyelash_Up",
        "Brows",
        "Stubble",
        "Classic_Slick_Back",
    }

    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj.name not in keep_meshes:
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        if obj.name in keep_meshes:
            removed = remove_vertices_below_world_z(obj, cut_z)
            if removed:
                trimmed[obj.name] = removed

    return {
        "mode": "head_only",
        "cut_ratio": cut_ratio,
        "cut_z": cut_z,
        "removed_vertices_by_mesh": trimmed,
    }


def make_face_only_export(cut_ratio: float) -> dict:
    """Keep only CC_Base_Body head geometry for maximum morph debug performance."""
    min_z, max_z = get_scene_z_bounds()
    cut_z = min_z + ((max_z - min_z) * cut_ratio)
    removed_objects = []
    trimmed = {}

    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj.name != "CC_Base_Body":
            removed_objects.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        if obj.name == "CC_Base_Body":
            removed = remove_vertices_below_world_z(obj, cut_z)
            if removed:
                trimmed[obj.name] = removed

    return {
        "mode": "face_only",
        "cut_ratio": cut_ratio,
        "cut_z": cut_z,
        "removed_objects": removed_objects,
        "removed_vertices_by_mesh": trimmed,
    }


def keep_shape_keys(names: set[str]) -> dict:
    removed = {}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.data.shape_keys:
            continue

        removed[obj.name] = []
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)

        key_blocks = obj.data.shape_keys.key_blocks
        for index in range(len(key_blocks) - 1, -1, -1):
            key_name = key_blocks[index].name
            if key_name in names:
                continue
            obj.active_shape_key_index = index
            bpy.ops.object.shape_key_remove()
            removed[obj.name].append(key_name)

    return removed


def export_glb(path: Path, selected_only: bool, morph_normals: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=selected_only,
        export_skins=True,
        export_morph=True,
        export_morph_normal=morph_normals,
        export_morph_tangent=False,
        export_materials="EXPORT",
        export_animations=False,
        export_yup=True,
    )


def main() -> None:
    args = parse_args()
    fbx_path = Path(args.fbx).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()

    clear_scene()
    import_fbx(fbx_path)
    transform_report = None
    if args.face_only:
        transform_report = make_face_only_export(args.cut_ratio if args.cut_ratio is not None else 0.69)
    elif args.head_only:
        transform_report = make_head_only_export(args.cut_ratio if args.cut_ratio is not None else 0.69)
    elif args.upper_body:
        transform_report = make_upper_body_export(args.cut_ratio if args.cut_ratio is not None else 0.47)

    if args.a2f_morphs_only:
        removed_shape_keys = keep_shape_keys(AUDIO2FACE_MORPHS)
        if transform_report is None:
            transform_report = {}
        transform_report["shape_key_filter"] = "audio2face"
        transform_report["removed_shape_keys_by_mesh"] = removed_shape_keys

    report = collect_report()
    if transform_report:
        report["transform"] = transform_report

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    export_glb(out_path, selected_only=args.selected_only, morph_normals=args.morph_normals)
    print(f"GLB exported: {out_path}")
    print(f"Morph report written: {report_path}")


if __name__ == "__main__":
    main()
