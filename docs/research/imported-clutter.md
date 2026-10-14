# Imported static GLB clutter

The clutter inspector accepts a self-contained `.glb` on the selected clutter type. Import replaces that type's geometry and material source while keeping its placement settings. Selecting a stock model or procedural geometry clears the import; undo restores it. A file is validated and fully converted before the project changes. Failed imports leave the selected type intact.

`src/lib/imported-clutter.ts` parses the GLB container and its embedded buffer directly. It does not invoke a loader, fetch a URI, or require the original file after import. The project contains base64 float32 positions/normals/UVs/tangents, uint32 indices, primitive groups, and per-material RGBA texture channels. Project saves, opening saved projects, undo/redo, browser autosave, and the native archive's `project.json` carry these sources together.

## Native material and mesh contract

Verified against local KSA build `2026.10.10.5554`:

- `KSA/GroundClutterLodReference.cs`, `BuildMaterialIndirection`, collects each mesh primitive's atlas material index, sorts distinct indices, and pairs them with the LOD's ordered `<Material>` references. Multiple materials therefore require no atlas bake or sacrificed UV regions.
- `KSA/ClutterObjectTemplate.cs`, `OnDataLoad`/`IsValid`, requires exactly five LOD entries.
- `KSA/MeshAtlasFileReference.cs`, `OnDataLoad`, registers named meshes from the GLB.
- `RenderCore.Gltf/GltfUtils.cs`, `AddPrimitiveDataToMesh`, uploads each primitive's complete accessor attributes. Export consequently merges groups using the same material and compacts each material's referenced vertices and indices. A primitive does not redundantly include the full merged mesh's vertex attributes.
- The existing native clutter export uses diffuse, normal, AO/roughness/metal, optional red-channel opacity and `AlphaCutoff=0.4`. The KSA modding skill's `pebbles-glb-material-conversion.md` records the same channel conventions; diffuse alpha is reserved for native material behavior and is set to 255.

Import bakes the complete default scene's node hierarchy into mesh positions. It transforms normals with the inverse transpose, reverses triangle winding for reflected transforms, generates missing normals and derives tangent frames from the resulting geometry/UVs. Its combined bounds become editable metre dimensions. X/Z bounds are centered and minimum Y is placed on the ground. glTF metres are retained without guessing a unit conversion. Flat axes use a 1 mm display dimension without adding geometry thickness.

All five native LOD names and material references resolve. The initial importer deliberately reuses the complete imported geometry at every LOD. It does not discard sampled triangles or manufacture broken lower-detail topology. Very detailed imports should be simplified in the source application. Browser scatter reduces its instance cap according to the imported triangle count.

Each retained source material becomes its own native `<GroundClutterMaterial>` and its own PNG files. The browser uses the same per-primitive groups and channel pixels with separate Three.js materials.

| Source glTF channel | Stored/browser/native channel |
| --- | --- |
| Base-color texture and factor | Decode sRGB to linear, multiply factor, encode sRGB; diffuse alpha 255 |
| Occlusion red and strength | ORM red, `1 + (AO - 1) * strength` |
| Metallic-roughness green and roughness factor | ORM green |
| Metallic-roughness blue and metallic factor | ORM blue |
| Normal texture and scale | Rescale tangent-space X/Y and normalize XYZ |
| MASK alpha and cutoff | Separate binary opacity mask at the source cutoff; native threshold 0.4 preserves that binary result |
| Per-material `doubleSided` | Preserved independently in browser/native material flags |

Input texture row zero corresponds to glTF UV V=0. Conversion retains this orientation: DataTexture uses `flipY=false`, exported PNG row zero contains those same pixels, and TEXCOORD_0 is preserved. Texture wrapping uses native repeat semantics; UV coordinates can extend beyond 0–1. Each material's differently sized channels are bilinearly resampled to one square power-of-two extent at least as large as every source dimension. PNG/JPEG images are decoded by the browser; no image is vertically flipped. Texture filtering follows the native renderer rather than retaining glTF sampler min/mag filter choices.

Imported palette tint, roughness, metalness and normal strength are editable multipliers. Their initial values are white/1/1/1, preserving source factors already baked into pixels. Terrain tint starts disabled. Source cutouts and sidedness remain represented even when the optional global material toggles are off.

## Compatibility and explicit errors

Supported: glTF 2.0 triangle meshes in the default scene, one embedded binary buffer, dense float32 position/normal/UV/tangent attributes, unsigned 8/16/32-bit indices or unindexed triangles, embedded PNG/JPEG images, standard metallic-roughness PBR materials, OPAQUE and MASK, and repeat texture wrapping.

Rejected with a visible error: external resources (including data URIs), compressed Draco/meshopt geometry, KTX2/WebP images, all glTF extensions, skins, animations, morph targets, vertex colors, additional UV attributes or texture UV sets, clamp/mirrored wrapping, emissive effects, BLEND transparency, nontriangle primitive modes, malformed buffers/accessors/indices, singular transforms and missing or degenerate UVs. Required and optional extensions are both rejected rather than silently omitting their appearance. Apply deformations, triangulate, unwrap UV0, bake unsupported shading into ordinary texture channels, and embed all PNG/JPEG images before export.

Every output triangle must have a finite UV determinant with absolute value greater than `1e-10` for native derivative tangent frames. Untextured materials still require a valid UV unwrap. Source authored tangents are regenerated from baked transforms and UVs. No static animation pose is inferred.

## Resource bounds and persistence

- GLB file: 16 MB; JSON chunk: 2 MB.
- Scene: 200,000 vertices, 100,000 triangles, 128 primitives, 16 materials, 512 nodes.
- Embedded images: 32 images, at most 1024 pixels per side, at most 16 MB combined decoded RGBA. PNG IHDR/JPEG SOF dimensions are checked before browser image decode.
- Converted maps: at most 32 MB raw RGBA across all materials; each material is at most 1024 square.
- Project imported data: 96 MB of encoded source fields; project file import: 128 MB.
- Export remains subject to the collection's existing 384 MB memory estimate, including full five-LOD mesh payloads, per-material maps and stored project sources.

Immutable import sources share bounded WeakMap caches for geometry and per-material decoded/multiplied pixels. Five LOD requests reuse the same source geometry. Each cache retains only the latest dimensions or material multipliers for that source.

The import budget counts source fields across all systems and bodies, including disabled types and duplicates. The same check runs before committing edits, so a failed import or duplication preserves the prior project, undo history and autosave. Ordinary edits and body/type duplication share immutable imported source data rather than copying large encoded buffers into every history entry. A pending import is cancelled if its type/source changes, its inspector is left, or the collection is replaced, undone or redone; repeated body/type IDs cannot redirect it into a newly opened project.

Autosave uses IndexedDB, allowing imported sources beyond localStorage's small quota. Existing localStorage saves are migrated only after a successful durable write. If IndexedDB fails, localStorage is attempted; a remaining fallback is preferred on the next load because it represents a later successful save than the prior IndexedDB record. Writes are serialized so delayed older writes cannot overwrite newer ones. If both storage mechanisms fail, the UI explicitly displays autosave failure and asks for a project-file save; it does not mark the project as saved.

Native startup/rendering has not been exercised in this task. The native source contract and archive closure are tested against decompiled current-build APIs; in-game visual acceptance remains a separate check.

## Validation

`tests/imported-clutter.test.ts` builds a real GLB with two materials, embedded PNG textures, mirrored nonuniform parent transforms, distinct PBR factors and a source mask cutoff. It verifies geometry/winding/metre bounds, texture orientation/channel conversion, complete material references, compact per-material native accessors, all five LODs, project roundtrip, ZIP path closure and unsupported-file errors.

`tests/browser/imported-clutter.spec.ts` uploads the fixture through the inspector, observes actual Three.js groups/material textures, exercises undo/redo, save/open/native export, reloads a converted 512-pixel material project exceeding 5 MB, checks failed imports retain the prior model, and covers newer local fallback plus serialized delayed autosaves. It also verifies visible storage-quota failures with downloadable recovery, collection-wide import/duplication limits, and delayed imports interrupted by source selection, navigation or project replacement.
