# Terrain, biome and ground clutter fidelity

Verified against local game build **2026.10.10.5554** on 2026-10-11. Research sources are the decompiled assemblies in `ksa-game-assemblies/current/decomp/KSA` and schema/shader examples in `ksa-linux/Content/Core`. The KSA modding skill's ground clutter overview supplied the research entry points; the local build supplied the authoritative fields. No Core texture or model data is copied into generated assets.

## Biome maps

[`BiomesReference.cs`](../../../ksa-game-assemblies/current/decomp/KSA/BiomesReference.cs) requires unique aliases and indices in `[0, Biomes.Count)`, and validates the ID and control maps as cubemaps. Each authored biome exports a corresponding ground/slope material pair. Biomes are independent from the editor's color occurrences: an occurrence paints diffuse color; a biome chooses terrain material and clutter placement membership.

The ID texture stores four **normalized** biome indices. [`Planet.glsl`](../../../ksa-linux/Content/Core/Shaders/Common/Planet.glsl) and [`Generate.comp`](../../../ksa-linux/Content/Core/Shaders/Planet/GroundClutter/Generate.comp) decode each channel as:

```glsl
uint(channel * float(biomeCount) + 0.4)
```

For RGBA8 textures the exporter writes `round(index * 255 / biomeCount)`. Raw integers in RGBA8 would select the wrong biome. Tests verify every index for counts 1–32 against the shader formula. ID mipmaps use nearest selection to preserve categorical values. Native material resolution samples the ID cube at LOD 0.

Control RGBA channels are the corresponding weights. Native shaders raise controls to `BlendStrength` and normalize their sum. The exporter compensates for this exponent with `weight^(1/BlendStrength)` before byte quantization. Up to four strongest nonzero authored regions contribute to one texel. With up to four biomes, each biome has a permanent channel so filtered control weights remain associated with the point-sampled ID map across region boundaries. With more biomes, selected IDs are ordered deterministically; transitions that change the active four-biome set can have sharper material boundaries because the native format only represents four concurrent contributors. Region weights respond to seed, patch scale, coverage, normalized terrain height and latitude bounds. Biome 0 is the fallback outside every authored region; its weight fades as regional coverage rises, so a fully covered polar region can actually select the polar material and its clutter. Weights always have a nonzero sum.

The renderer's `MAX_BIOMES` constant is 64, but [`GroundClutterPlacementReference.cs`](../../../ksa-game-assemblies/current/decomp/KSA/GroundClutterPlacementReference.cs) constructs a 32-bit mask using `1 << biomeId`. The editor/exporter restrict biomes to 32 so terrain and clutter membership retain the same unique meaning. The number of authored clutter types is independent of this biome limit.

## Coordinate conversion

Native surface locations use a +Z latitude pole: `[cos(latitude) cos(longitude), cos(latitude) sin(longitude), sin(latitude)]`, confirmed in `LocationReference`. The authoring/Three view uses a +Y pole. Every native cubemap direction is rotated through `[x, z, -y]` before procedural sampling. The inverse is `[x, -z, y]`; both are right handed. Thus an authored north-polar biome is exported on the native +Z cube face. Tests check this on the actual generated KTX2 bytes.

The body normal map derives finite differences from the exported height field, with neighbor lookups across cube faces. Normals use the native tangent frame from [`Planet.frag`](../../../ksa-linux/Content/Core/Shaders/Planet/Planet.frag) and `GroundClutter/Generate.comp`: project -Z onto the tangent plane, use +Y near the poles, and construct `[-T, B, N]`. Native normal decoding uses the encoded RG components and reconstructs Z.

## Ground and slope material maps

[`BiomeMaterialReference.cs`](../../../ksa-game-assemblies/current/decomp/KSA/BiomeMaterialReference.cs) defines independent `GroundMaterial` and `SlopeMaterial`, plus slope strength, contrast and bias. [`TerrainMaterialReference.cs`](../../../ksa-game-assemblies/current/decomp/KSA/TerrainMaterialReference.cs) supports these authored slots:

| Slot or control                              | Exported behavior                                             | Verified native use                                                      |
| -------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Diffuse                                      | Original tiled color variation with primary/secondary colors  | Per-biome material sampling                                              |
| Normal                                       | Finite difference derivative of the generated material relief | Per-biome shading with `NormalScale`                                     |
| AoRoughMetal                                 | R occlusion, G roughness, B metalness, with spatial variation | Native PBR channel convention                                            |
| Displacement                                 | Original relief, separately seeded per ground/slope material  | Height blending and tessellation in planet shaders                       |
| Height                                       | Original relief with `Minimum M=0` and authored `Maximum`     | Loaded by native biome texture array code                                |
| TextureTiling                                | Authored native value                                         | Included in `BiomeMaterial` GPU data                                     |
| DiffuseScale, NormalScale, DisplacementScale | Authored native values                                        | Included in `BiomeMaterial` GPU data                                     |
| HeightTiling, HeightDeformity                | Native XML values retained                                    | Serialized by this build; no runtime read outside declarations was found |
| DetailFadeInStart/End                        | Distances in metres                                           | Native validation requires start greater than end                        |

Material patterns (`regolith`, `sand`, `basalt`, `ice`, `soil`) change the original relief function. Periodic noise and wrapped finite differences make tile edges repeat. The authoritative terrain geometry and physics use the body's R16 height cubemap. The generated detail `Height` slot and its parsed tiling/deformity controls are not claimed to alter native physical terrain in this build. Displacement is verified as a rendering input.

The original scattering/surge cubes are derived from material roughness and seeded spatial noise using the actual Hapke channels documented in [`Lighting.glsl`](../../../ksa-linux/Content/Core/Shaders/Common/Lighting.glsl): scattering is Hapke amount / HG b / HG c; surge is CBOE amplitude / CBOE width / SHOE amplitude / SHOE width. Their data is not copied from Core.

## Independent clutter types

Each enabled type emits its own `MeshAtlas`, `GroundClutterMaterial`, `ClutterObject`, `Ecotype`, and distribution texture. Every resource ID and path includes the body and type ID. Types independently own geometry dimensions/detail/irregularity, shape seed, material color/PBR/normal/opacity controls, distribution seed/density/patch controls, biome membership, separation, generation distance, scale range, orientation, yaw interval, slope mask and altitude density curve.

[`ClutterObjectTemplate.cs`](../../../ksa-game-assemblies/current/decomp/KSA/ClutterObjectTemplate.cs) throws unless there are **exactly five** LOD entries. Generated GLBs contain five named meshes with decreasing topology; the XML references all five. [`GroundClutterLodReference.cs`](../../../ksa-game-assemblies/current/decomp/KSA/GroundClutterLodReference.cs) requires material definitions to live in assets and be referenced by ID from LODs. Each exported mesh uses one atlas material slot, and each LOD lists exactly one matching native material reference.

Procedural geometry includes irregular boulders, smoother pebbles, faceted crystals, grass blade clusters, multi-lobed shrubs and tapering spires. Geometry is authored in metres and normalized to the requested dimensions, with UVs, unit normals, tangents and indices. Independent stock mesh selection uses the same generated material/distribution contract.

The original Blender stock library is embedded in `stock-meshes.json`, so the browser and Node exporter consume the same geometry without a fetch or local-filesystem dependency. Each stock source supplies five authored LODs, normals and an eight-color palette atlas. The adapter preserves the source's triangle topology and palette UV assignment, normalizes positions to the requested metre dimensions, and transforms normals by the inverse transpose under nonuniform scaling. Stock geometry hides procedural shape/detail/irregularity controls; its seed controls the generated palette texture. Distribution and optional opacity maps retain their independently authored controls.

Palette UVs must span a nonzero area within their assigned swatch for every triangle. Constant palette-center UVs would make the native [`SharedFrag.glsl`](../../../ksa-linux/Content/Core/Shaders/Common/SharedFrag.glsl) cotangent frame calculate zero tangent/bitangent vectors and `inversesqrt(0)`, producing a non-finite normal when used by [`GroundClutter/Solid.frag`](../../../ksa-linux/Content/Core/Shaders/Planet/GroundClutter/Solid.frag). The adapter rejects degenerate UV triangles, and stock tests verify nonzero UV area while keeping all corners within one palette swatch. Supplying tangent attributes alone does not solve this, because this native shader computes its frame from screen derivatives of the UVs.

[`GroundClutterPlacementReference.cs`](../../../ksa-game-assemblies/current/decomp/KSA/GroundClutterPlacementReference.cs) verifies the placement vocabulary: `DistributionTexture`, `ObjectSeparation`, `GenerationRange`, `DistributionTextureTiling`, `MinScale`, `MaxScale`, `Orientation Mode`, yaw angles, three slope mask controls and `AltitudeDensityCurve`. A placement's `Biomes` attribute contains comma-separated native aliases; omitted/empty means all biomes. Unknown aliases are rejected before export. Distribution uses the red channel as a placement probability, confirmed in `Generate.comp`.

Altitude density points export native `SplinePoint` elements with key in metres, density value and zero in/out tangents. [`CubicHermiteSpline.cs`](../../../ksa-game-assemblies/current/decomp/KSA/CubicHermiteSpline.cs) therefore gives smoothstep interpolation between points and endpoint clamping. An empty authoring curve omits the XML element and inherits the native constant-one constructor curve; emitting an empty curve would yield zero density. The preview helper uses the same rule. Collisions export `<CollisionType Value="None" />`; physical colliders/substances are outside the authored contract. The native schema allows nonuniform visual scale for noncolliding clutter. Native collision restrictions on smooth-normal orientation and nonuniform scale are consequently avoided. The native ecotype list has no declared fixed limit; the application's 64-type validation bound is a resource policy.

## Verification

`tests/surface.test.ts` independently decodes the native shader's biome formula, inspects real KTX2 cube data, parses XML links into actual generated assets, parses GLB mesh/material/accessor data, verifies five decreasing LODs and metre bounds for every shape, and exercises twelve independently authored clutter types. It also verifies native-coordinate polar placement, independent distribution/material seeds, altitude spline behavior, and rejection of unresolved or colliding aliases.

`tests/assets.test.ts` retains KTX2/PNG/GLB checks and verifies nonconstant authored roughness data. Archive validation checks every XML `Path` against the packaged files. These are schema/data checks against the current build; native game loading/rendering remains a separate runtime validation step.
