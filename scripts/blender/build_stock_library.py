"""Build and publish the 25 original Orbit Foundry stock specimens.

Run this inside Blender (Python Console or Blender MCP) with:

    import importlib.util
    path = "/Users/asherwin/repos/meow-sci/poc-planets/scripts/blender/build_stock_library.py"
    spec = importlib.util.spec_from_file_location("orbit_foundry_stock_builder", path)
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    STOCK_BUILD_RESULT = builder.build_stock_library()

The script regenerates the source atlases, creates an isolated editable gallery
scene with metre-authored meshes and display-only normalized transforms, writes
the native/browser registry, renders a contact sheet and category views, and
copies only the new gallery scene and its dependencies into the canonical blend.
"""
import inspect
import importlib.util
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
GEOMETRY = ROOT / "scripts/blender/stock_geometry.py"
SECONDARY = ROOT / "scripts/blender/stock_secondary_geometry.py"
EXPANSION = ROOT / "scripts/blender/stock_expansion_geometry.py"
MANIFEST = ROOT / "scripts/blender/stock_expansion_manifest.json"
EXPORTER = ROOT / "scripts/blender/stock_export.py"
REGISTRY = ROOT / "src/lib/stock-meshes.json"
ASSET_DIR = ROOT / "assets/stock"
ATLAS_DIR = Path("/tmp/orbit-foundry-stock-atlases")
CANONICAL_BLEND = ASSET_DIR / "orbit-foundry-field-specimens.blend"
GALLERY_IMAGE = ASSET_DIR / "gallery.png"
ORIGINAL_ORDER = (
    "basalt_spires", "layered_sandstone", "glacial_shard", "wind_pine",
    "umbrella_tree", "alien_lantern", "ribbon_fern", "coral_fan",
)
EXPANSION_ORDER = tuple(item["id"] for item in json.loads(MANIFEST.read_text()))
REGISTRY_ORDER = ORIGINAL_ORDER + EXPANSION_ORDER
PINE_LOD_DENSITIES = (1.0, 0.58, 0.14, 0.09, 0.035)
STRUCTURAL_LOD_IDS = set(EXPANSION_ORDER) | {"wind_pine", "umbrella_tree"}
GALLERY_DISPLAY_EXTENT_M = 1.38


def _load_module(name, path):
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _fresh_modules():
    geometry = _load_module("stock_geometry", GEOMETRY)
    secondary = _load_module("stock_secondary_geometry", SECONDARY)
    # Both geometry modules import this stable public name when looking up the
    # shared Shape accumulator and tube/card helpers.
    sys.modules["stock_geometry"] = geometry
    expansion = _load_module("stock_expansion_geometry", EXPANSION)
    return geometry, secondary, expansion


def _definitions(geometry, secondary, expansion):
    definitions = (
        ("basalt_spires", "Basalt organ pipes", "Fractured hexagonal columns for volcanic ridges.", "rock",
         geometry.build_basalt_spires, geometry.BASALT_PALETTE),
        ("wind_pine", "Windward pine", "A wind-bent conifer with layered needle cushions.", "tree",
         geometry.build_wind_pine, geometry.PINE_PALETTE),
    ) + tuple(secondary.DEFINITIONS) + tuple(expansion.DEFINITIONS)
    metadata = {
        "basalt_spires": {"materialFamily": "basalt_spires", "cutout": False},
        "layered_sandstone": {"materialFamily": "layered_sandstone", "cutout": False},
        "glacial_shard": {"materialFamily": "glacial_shard", "cutout": False},
        "wind_pine": {"materialFamily": "wind_pine", "foliageStyle": "needles", "cutout": True},
        "umbrella_tree": {"materialFamily": "umbrella_tree", "foliageStyle": "compound", "cutout": True},
        "alien_lantern": {"materialFamily": "alien_lantern", "cutout": False},
        "ribbon_fern": {"materialFamily": "ribbon_fern", "cutout": False},
        "coral_fan": {"materialFamily": "coral_fan", "cutout": False},
    }
    by_id = {definition[0]: definition for definition in definitions}
    if set(by_id) != set(REGISTRY_ORDER):
        raise ValueError(f"Stock definition IDs do not match the stable registry: {sorted(by_id)}")
    ordered = []
    for asset_id in REGISTRY_ORDER:
        definition = by_id[asset_id]
        if len(definition) < 7:
            definition = (*definition, metadata[asset_id])
        ordered.append(definition)
    return ordered


def _triangle_count(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def _clear_scene(scene):
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for child in list(scene.collection.children):
        scene.collection.children.unlink(child)
        if child.users == 0:
            bpy.data.collections.remove(child)


def build_all_assets(scene_name="Orbit Foundry · Field Specimens"):
    """Stage all 25 original specimens and their five-level structural LODs."""
    geometry, secondary, expansion = _fresh_modules()
    definitions = _definitions(geometry, secondary, expansion)
    scene = bpy.data.scenes.get(scene_name) or bpy.data.scenes.new(scene_name)
    _clear_scene(scene)
    if bpy.context.window is not None:
        bpy.context.window.scene = scene

    collection = bpy.data.collections.new("Field specimens · 25 original assets")
    scene.collection.children.link(collection)
    lod_collection = bpy.data.collections.new("Native structural LOD sources · hidden in render")
    scene.collection.children.link(lod_collection)
    lod_collection.hide_render = True
    geometry._configure_studio(scene, collection)
    label_material = bpy.data.materials.new("Field specimen labels · charcoal")
    label_material.use_nodes = True
    label_shader = next(node for node in label_material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    label_shader.inputs["Base Color"].default_value = geometry._hex_color("#25292b")
    label_shader.inputs["Roughness"].default_value = 0.9

    # Source mesh coordinates remain authored in metres. Only the gallery
    # object transform is normalized by its largest dimension, preventing
    # wide low groundcover from dominating its cell. True bounds and height
    # remain attached to each specimen for inspection/export.
    spacing = 4.0
    columns = 5
    x_positions = tuple((index - (columns - 1) * 0.5) * spacing for index in range(columns))
    y_positions = tuple(((len(definitions) - 1) // columns * 0.5 - index // columns) * spacing
                        for index in range(len(definitions)))
    objects = []
    labels = []
    details_by_id = {}
    lod_sources = {}
    l0_objects = {}

    for index, definition in enumerate(definitions):
        asset_id, name, _description, category, build, palette, metadata = definition
        shape, details = _build_shape(build, asset_id, 0)
        bounds = _shape_bounds(shape)
        source_height = bounds[2][1] - bounds[2][0]
        if source_height <= 1e-5:
            raise ValueError(f"{asset_id}: source geometry has no measurable height")
        source_extent = max(bounds[axis][1] - bounds[axis][0] for axis in range(3))
        display_scale = GALLERY_DISPLAY_EXTENT_M / source_extent
        obj = geometry.create_stock_object(
            scene, collection, asset_id, name, shape, palette, category, metadata=metadata,
        )
        obj.scale = (display_scale, display_scale, display_scale)
        obj.location = (x_positions[index % columns], y_positions[index], -bounds[2][0] * display_scale)
        obj["source_definition_order"] = index
        obj["source_dimensions_m"] = [round(bounds[axis][1] - bounds[axis][0], 6) for axis in range(3)]
        obj["source_height_m"] = round(source_height, 6)
        obj["gallery_display_scale"] = round(display_scale, 8)
        objects.append(obj)
        l0_objects[asset_id] = obj
        details_by_id[asset_id] = details

        label_curve = bpy.data.curves.new(f"{asset_id} · metre label", type="FONT")
        label_curve.body = f"{name}\n{source_height:.2f} m"
        label_curve.align_x = "CENTER"
        label_curve.align_y = "CENTER"
        label_curve.size = 0.175
        label_curve.space_line = 0.95
        label_curve.materials.append(label_material)
        label_obj = bpy.data.objects.new(f"Label · {asset_id}", label_curve)
        collection.objects.link(label_obj)
        label_obj.location = (obj.location.x, obj.location.y - 1.63, 0.004)
        label_obj["stock_id"] = asset_id
        label_obj["gallery_display_only"] = True
        labels.append(label_obj)

    # Structural sources avoid decimating cutout foliage or tiny groundcover.
    # Each source is independently built from the same deterministic design.
    by_id = {definition[0]: definition for definition in definitions}
    for asset_id in sorted(STRUCTURAL_LOD_IDS, key=REGISTRY_ORDER.index):
        definition = next(item for item in definitions if item[0] == asset_id)
        _id, name, _description, category, build, palette, metadata = definition
        levels = [l0_objects[asset_id]]
        for level in range(1, 5):
            shape, _details = _build_shape(build, asset_id, level)
            lod = geometry.create_stock_object(
                scene, lod_collection, asset_id,
                f"{name} · structural LOD {level}", shape, palette, category, metadata=metadata,
            )
            lod.hide_render = True
            lod.hide_set(True)
            lod["lod_role"] = f"LOD{level} structural source"
            levels.append(lod)
        lod_sources[asset_id] = levels

    # The 5x5 display scene uses normalized specimen transforms, while source
    # mesh coordinates and all exported dimensions remain in authored metres.
    camera = scene.camera
    camera.location = (0.0, -22.5, 25.0)
    camera.rotation_euler = (Vector((0.0, 0.0, 0.12)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = 23.8
    scene.render.resolution_x = 2000
    scene.render.resolution_y = 2000
    scene.render.resolution_percentage = 100

    for selected in list(bpy.context.selected_objects):
        selected.select_set(False)
    active = l0_objects["wind_pine"]
    active.select_set(True)
    bpy.context.view_layer.objects.active = active

    result = {
        "scene": scene.name,
        "objects": [obj.name for obj in objects],
        "labels": labels,
        "triangle_counts": {obj["stock_id"]: _triangle_count(obj) for obj in objects},
        "details": details_by_id,
        "structural_lods": {
            asset_id: [_triangle_count(obj) for obj in sources]
            for asset_id, sources in lod_sources.items()
        },
        "registry_order": list(REGISTRY_ORDER),
        "definitions": definitions,
        "lod_sources": lod_sources,
        "gallery_objects": objects,
        "gallery_labels": labels,
    }
    scene["stock_gallery_order"] = json.dumps(REGISTRY_ORDER)
    scene["stock_asset_count"] = len(objects)
    scene["source_geometry_units"] = "metres"
    scene["gallery_display_extent_m"] = GALLERY_DISPLAY_EXTENT_M
    print("FIELD_SPECIMENS", json.dumps({key: value for key, value in result.items()
                                         if key not in ("definitions", "lod_sources", "gallery_objects", "gallery_labels", "labels")},
                                        separators=(",", ":")))
    return result


def _shape_bounds(shape):
    return tuple((min(vertex[axis] for vertex in shape.vertices),
                  max(vertex[axis] for vertex in shape.vertices)) for axis in range(3))


def _build_shape(build, asset_id, lod_level=0):
    """Call a builder with only the options its public signature supports."""
    parameters = inspect.signature(build).parameters
    kwargs = {}
    if "lod_level" in parameters:
        kwargs["lod_level"] = lod_level
    if asset_id == "wind_pine":
        if "seed" in parameters:
            kwargs["seed"] = 581
        if "foliage_density" in parameters:
            kwargs["foliage_density"] = PINE_LOD_DENSITIES[lod_level]
    elif asset_id == "umbrella_tree":
        if "seed" in parameters:
            kwargs["seed"] = 2309
        if "foliage_density" in parameters:
            kwargs["foliage_density"] = None
    elif asset_id == "basalt_spires" and "seed" in parameters:
        kwargs["seed"] = 943
    return build(**kwargs)


def export_staged_registry(result, destination=REGISTRY):
    """Write and validate the provisional browser/native mesh registry."""
    exporter = _load_module("stock_export", EXPORTER)
    temp = Path("/tmp/orbit-foundry-stock-meshes.provisional.json")
    records = exporter.export_registry(
        result["gallery_objects"], result["definitions"], temp,
        lod_sources=result["lod_sources"],
    )
    expected = list(REGISTRY_ORDER)
    found = [record["id"] for record in records]
    if found != expected:
        raise ValueError(f"Registry ordering mismatch: {found}")
    for record in records:
        if len(record["lods"]) != 5:
            raise ValueError(f"{record['id']} has {len(record['lods'])} LODs")
        signatures = set()
        for level, lod in enumerate(record["lods"]):
            if lod["indexCount"] == 0 or lod["vertexCount"] == 0:
                raise ValueError(f"{record['id']} LOD{level} packed empty")
            signatures.add((lod["vertexCount"], lod["indexCount"], hash(lod["data"])))
        if len(signatures) != 5:
            raise ValueError(f"{record['id']} has duplicate native LOD geometry")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    replacement_path = None
    try:
        with tempfile.NamedTemporaryFile(
                mode="wb", prefix=f".{destination.name}.", suffix=".tmp",
                dir=destination.parent, delete=False) as replacement:
            replacement_path = Path(replacement.name)
            replacement.write(temp.read_bytes())
            replacement.flush()
            os.fsync(replacement.fileno())
        os.replace(replacement_path, destination)
    except Exception:
        if replacement_path is not None:
            replacement_path.unlink(missing_ok=True)
        raise
    print("REGISTRY_REWRITE", json.dumps({
        "destination": str(destination),
        "bytes": destination.stat().st_size,
        "assets": found,
        "triangles": {record["id"]: [lod["indexCount"] // 3 for lod in record["lods"]]
                      for record in records},
    }, separators=(",", ":")))
    return records


def collect_staged_result(scene_name="Orbit Foundry · Field Specimens"):
    """Recover source and structural LOD objects from the live gallery scene."""
    geometry, secondary, expansion = _fresh_modules()
    definitions = _definitions(geometry, secondary, expansion)
    scene = bpy.data.scenes.get(scene_name)
    if scene is None:
        raise ValueError(f"Gallery scene not found: {scene_name}")
    main_collection = next((child for child in scene.collection.children
                            if child.name.startswith("Field specimens · 25 original assets")), None)
    lod_collection = next((child for child in scene.collection.children
                           if child.name.startswith("Native structural LOD sources · hidden in render")), None)
    if main_collection is None or lod_collection is None:
        raise ValueError("Gallery source collections are missing")
    objects = []
    by_id = {}
    for definition in definitions:
        asset_id = definition[0]
        obj = next((candidate for candidate in main_collection.objects
                    if candidate.get("stock_id") == asset_id and candidate.get("lod_role") == "LOD0 source"), None)
        if obj is None:
            raise ValueError(f"Missing staged LOD0 object for {asset_id}")
        objects.append(obj)
        by_id[asset_id] = obj
    lod_sources = {}
    for asset_id in sorted(STRUCTURAL_LOD_IDS, key=REGISTRY_ORDER.index):
        sources = [by_id[asset_id]]
        extras = [obj for obj in lod_collection.objects
                  if obj.get("stock_id") == asset_id and str(obj.get("lod_role", "")).startswith("LOD")]
        extras.sort(key=lambda obj: int(str(obj["lod_role"])[3:].split()[0]))
        sources.extend(extras)
        if len(sources) != 5:
            raise ValueError(f"{asset_id} has {len(sources)} structural LOD sources, expected 5")
        lod_sources[asset_id] = sources
    return {
        "scene": scene.name,
        "objects": [obj.name for obj in objects],
        "triangle_counts": {obj["stock_id"]: _triangle_count(obj) for obj in objects},
        "definitions": definitions,
        "lod_sources": lod_sources,
        "gallery_objects": objects,
    }


def _regenerate_atlases():
    """Run the repository's deterministic source-map generator."""
    node = shutil.which("node")
    if node is None:
        candidates = []
        for direct in (Path("/opt/homebrew/bin/node"), Path("/usr/local/bin/node")):
            if direct.is_file():
                candidates.append(direct)
        for root in (Path.home() / ".nvm/versions/node",):
            if root.is_dir():
                candidates.extend(root.glob("v*/bin/node"))
        if candidates:
            def version(path):
                parts = path.parent.parent.name.removeprefix("v").split(".")
                try:
                    return tuple(int(part) for part in parts)
                except ValueError:
                    return (0,)
            node = str(max(candidates, key=version))
    if node is None:
        raise FileNotFoundError("Node.js is required to regenerate the source atlases")
    command = [
        node, str(ROOT / "scripts/generate-stock-textures.mjs"),
        str(ATLAS_DIR), "1", str(MANIFEST),
    ]
    completed = subprocess.run(command, cwd=str(ROOT), capture_output=True, text=True)
    if completed.returncode:
        raise RuntimeError(
            "Shared atlas generation failed: " + (completed.stderr or completed.stdout)[-1200:]
        )
    print("STOCK_ATLASES", (completed.stdout or "generated").strip().splitlines()[-1])


def _render_image(scene, destination, resolution=(1800, 1800)):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(destination)
    if bpy.context.window is not None:
        bpy.context.window.scene = scene
    bpy.context.view_layer.update()
    bpy.ops.render.render(write_still=True)
    if not destination.exists() or destination.stat().st_size < 4096:
        raise RuntimeError(f"Blender did not produce a usable gallery image: {destination}")
    return str(destination)


def render_gallery_views(result, destination=GALLERY_IMAGE):
    """Render the normalized 25-up contact sheet plus compact category views."""
    scene = bpy.data.scenes[result["scene"]]
    objects = result["gallery_objects"]
    labels = result["gallery_labels"]
    by_id = {obj["stock_id"]: obj for obj in objects}
    label_by_id = {obj["stock_id"]: obj for obj in labels}
    camera = scene.camera
    camera.location = (0.0, -22.5, 25.0)
    camera.rotation_euler = (Vector((0.0, 0.0, 0.12)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = 23.8
    sheet = _render_image(scene, destination, (2000, 2000))

    saved_locations = {obj: obj.location.copy() for obj in objects + labels}
    saved_hiding = {obj: obj.hide_render for obj in objects + labels}
    saved_camera = (camera.location.copy(), camera.rotation_euler.copy(), camera.data.ortho_scale)
    saved_resolution = (scene.render.resolution_x, scene.render.resolution_y)
    category_paths = {}
    category_labels = {
        "rock": "rocks",
        "tree": "trees",
        "alien": "alien-flora",
        "groundcover": "groundcover",
    }
    try:
        for category, filename in category_labels.items():
            members = [obj for obj in objects if obj.get("category") == category]
            if not members:
                continue
            columns = min(4, int(math.ceil(math.sqrt(len(members)))))
            rows = int(math.ceil(len(members) / columns))
            spacing = 3.55
            for obj in objects:
                obj.hide_render = obj not in members
            for label in labels:
                label.hide_render = label.get("stock_id") not in {obj["stock_id"] for obj in members}
            for index, obj in enumerate(members):
                col, row = index % columns, index // columns
                x = (col - (columns - 1) * .5) * spacing
                y = ((rows - 1) * .5 - row) * spacing
                loc = saved_locations[obj]
                obj.location = (x, y, loc.z)
                label = label_by_id[obj["stock_id"]]
                label.location = (x, y - 1.60, saved_locations[label].z)
            camera.location = (0.0, -16.0, 19.0)
            camera.rotation_euler = (Vector((0.0, 0.0, 0.10)) - camera.location).to_track_quat("-Z", "Y").to_euler()
            aspect = 1440 / 1100
            width_span = columns * spacing
            height_span = rows * spacing + 2.1
            camera.data.ortho_scale = max(width_span + 1.0, height_span * aspect + 1.0)
            path = Path(destination).with_name(f"gallery-{filename}.png")
            category_paths[category] = _render_image(scene, path, (1440, 1100))
    finally:
        for obj, location in saved_locations.items():
            obj.location = location
        for obj, hidden in saved_hiding.items():
            obj.hide_render = hidden
        camera.location, camera.rotation_euler, camera.data.ortho_scale = saved_camera
        scene.render.resolution_x, scene.render.resolution_y = saved_resolution
    print("GALLERY_IMAGES", json.dumps({"contact_sheet": sheet, "categories": category_paths}, separators=(",", ":")))
    return {"contact_sheet": sheet, "categories": category_paths}


def _write_scoped_blend(scene, destination=CANONICAL_BLEND):
    """Pack the gallery's image dependencies and write only its scene graph."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    for obj in scene.objects:
        for material in getattr(getattr(obj, "data", None), "materials", ()):
            if not material or not material.use_nodes:
                continue
            for node in material.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image and node.image.packed_file is None:
                    try:
                        node.image.pack()
                    except RuntimeError:
                        pass
    # Passing only this scene recursively includes its collections, models,
    # materials, cameras, lights, world, and packed image dependencies. The
    # user's other live scenes are deliberately excluded from this artifact.
    bpy.data.libraries.write(
        str(destination), {scene}, path_remap="RELATIVE", fake_user=True, compress=True,
    )
    if not destination.exists() or destination.stat().st_size < 1024 * 1024:
        raise RuntimeError(f"Scoped field-specimen blend is missing or unexpectedly small: {destination}")
    print("CANONICAL_BLEND", json.dumps({"path": str(destination), "bytes": destination.stat().st_size,
                                          "scene": scene.name}, separators=(",", ":")))
    return str(destination)


def build_stock_library(regenerate_textures=True, render_gallery=True):
    """Rebuild, export, render, and pack the canonical 25-asset stock library."""
    if regenerate_textures:
        _regenerate_atlases()
    result = build_all_assets()
    records = export_staged_registry(result)
    result["registry_records"] = records
    if render_gallery:
        result["gallery_images"] = render_gallery_views(result)
    scene = bpy.data.scenes[result["scene"]]
    result["blend_path"] = _write_scoped_blend(scene)
    return {
        "scene": result["scene"],
        "asset_count": len(result["gallery_objects"]),
        "registry_path": str(REGISTRY),
        "registry_bytes": REGISTRY.stat().st_size,
        "blend_path": result["blend_path"],
        "gallery_images": result.get("gallery_images"),
        "triangle_counts": result["triangle_counts"],
        "native_lod_triangles": {
            record["id"]: [lod["indexCount"] // 3 for lod in record["lods"]]
            for record in records
        },
    }


if __name__ == "__main__":
    STOCK_BUILD_RESULT = build_stock_library()
