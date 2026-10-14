# Orbit Foundry fidelity upgrade

Contract target: KSA build `2026.10.10.5554`. Evidence is read from the decompiled game and installed Core content. Browser previews are approximations; native runtime is unavailable on the development Mac. No Core textures, models, or separately licensed RealAtmospheres texture assets are redistributed.

## Architecture and stages

1. Verify native serializers, renderer consumers, asset encodings, and Core examples before defining controls.
2. Extend the version-1 editable source with strict, absent-field-only migration. Independent biome, clutter, cloud-layer, and site arrays keep authored content reusable and independently seeded.
3. Generate original assets with deterministic samplers. One body's assets are generated at a time. Each body can inherit collection resolution or choose 32–512 pixels per cubemap face; preflight prevents an oversized browser export.
4. Integrate native XML and asset references, then inspect independent native invariants, closure, generated content variation, migration, browser workflows, and selection performance.

Ownership: implementation lead owns shared types/defaults/validation and editor/export integration; terrain leaf owns `surface.ts`, `surfaceExport.ts`, `assets.ts`, and `procedural.ts`; atmosphere leaf owns atmosphere/cloud modules, cloud inspector, and viewport. Root independently audits Core and implements the bounded native sites module.

## Feature and contract matrix

| Core/native feature | Existing editor | Upgrade contract | Limits / additional requirements |
| --- | --- | --- | --- |
| Stellar bodies, planetary/atmospheric bodies, barycenters, nested orbit families | Authored native XML | Preserve and regress | Native game physics/rendering remain untested |
| Radius, mass, color, sunlight, orbital elements, rotation and tidal lock | Authored | Preserve | Celestial IDs remain native display identifiers |
| Original macro height and color cubemaps | Original R16 height and RGBA diffuse | Shared deterministic sampler; derived normals and optical maps | Engine terrain shaders still required |
| Native biome ID/control cubemaps | Single fixed Surface ID | Contiguous native aliases and up to four weighted IDs per sample | IDs encode `round(index*255/biomeCount)`; categorical mip handling must match shader |
| Terrain ground/slope materials | One repeated placeholder material | Independent ground/slope materials per biome, generated diffuse/normal/ORM/displacement/height maps | Detail HeightTiling/HeightDeformity serialize but no runtime readers found; do not claim physics effect |
| Procedural occurrences | Color deposits only | Preserve independent color overlays beside real biomes | Occurrences are not native biome aliases |
| Ground clutter | Single fixed rock | Independent authored geometry, material and distribution per type; original procedural families plus eight Blender stock models, own palette/material maps, native Ecotype/ClutterObject and five LODs | Collision remains None; visual clutter is separate from sites with colliders |
| Atmosphere scattering/absorption and physical gas | Partial native fields | Explicit start height, ozone layer, absorption multiplier and RGB Mie asymmetry | XML scattering is km⁻¹; new Earth defaults corrected; prior authored coefficients preserved |
| Cloud layers, types, raymarching, detail and flow | Diffuse gas bands only | Full native Clouds layer/type configurations and original mask/detail/color/normal/flow textures | Native clouds require an enabled atmosphere; engine's volumetric cloud shader cannot be reproduced exactly in WebGL |
| Ocean color/level/wind/foam/Gerstner waves | Authored | Preserve; preview combines terrain depth and illumination | Custom native Density is broken in this build and remains omitted; one ocean required across collection |
| Rings with volumetric settings and ring objects | Authored | Preserve original ring assets | Engine volumetric ring implementation still required |
| Landmarks and physical launch pads | Missing | Native coordinates with click-to-place terrain picking and independently generated StaticObject pad model/material/box collider | Native renderer only draws ground markers for IsLaunchPad; launcher enumerates LandmarkReference |
| City/crater/mountain named coordinates | Missing | Native location authoring after launcher safety verification | These are named points, not generated city/crater/mountain geometry |
| RandomHeightmapCollection | Missing | Direct generated height cubemap remains supported path | Alternative Core asteroid resource mechanism; not necessary for authored height maps |
| Environment/biome audio | Missing | Original generated looping PCM WAV with native SoundFile, SpatialSoundData, and EnvironmentSound; manual browser audition | Native pressure/biome gating applies; Core BiomeSounds is an unserialized empty stub, so it is not exported |
| Custom atmospheric shaders (RealAtmospheres) | Missing | Source-informed approximate scattering/flow preview | MIT source can inform independently written math; non-MIT texture assets excluded; shader replacement/code-mod package is out of scope |

## Compatibility and validation

Legacy singleton clutter is converted only when the old object is well formed. Missing new fields receive defaults; explicit malformed fields are rejected. Old oceans retain the existing migration policy: absent ocean settings become disabled. New cloud layers are not silently enabled on old source files. Biome aliases and clutter membership, GLB mesh names, five native LOD entries, texture paths, and static-object references must close within the archive.

The system-view selection fix is a required invariant: selecting an existing body must not reconstruct all system textures or meshes. Viewport extensions must preserve scene reuse and the selection-follow camera.

Native identifiers are case-insensitive: `KeyHash.MakeInternal` lowercases before hashing, and `SerializedCollection.Register` refuses duplicate or empty IDs. Body and generated-library IDs therefore reject case-only duplicates. `CelestialTemplate.OnDataLoad` registers every location by its exported name, so enabled location names must also be nonempty and unique across all four categories; Add/Duplicate generates a unique name. This prevents launch-menu destinations resolving to a different location with the same name.

The clutter tooling includes isolated selected-model inspection, an entire-library garden, and a physical terrain-patch approximation. The patch states its metre size, estimated eligible count, and displayed-instance cap, and applies distribution/biome/slope/altitude/ocean restrictions. It does not claim exact native GPU generation parity. Stock presets preserve authored palette UV islands and choose original dimensions; dimensions, palette tints, material response and distribution remain independently editable.
