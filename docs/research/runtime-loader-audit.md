# Native loading and independent assets

Audited against the supplied `ksa-game-assemblies/current/decomp` tree on 2026-10-11. These are source-level findings, not evidence of a successful native game launch.

## One playable interstellar world

`KSA/Mod.cs` reads the `systems` array from `mod.toml`. `PrepareSystems()` loads each file as `SystemInfo` to populate the world selector. `LoadSystems()` then filters those filenames against `SystemLibrary.Default.XmlName` and deserializes the selected file as `SystemTemplate`.

Consequently, exporting several independently selectable XML files does not, by itself, create one traversable interstellar world. A combined export must put the authored star systems and their reference-frame/body trees inside one `<System>` document. The supplied `Content/Core/SolSystemInterstellar.xml` demonstrates this organization. An editor may still organize those trees into separate system tabs.

## Planet surface textures

`KSA/AstronomicalTemplate.cs`, `ValidateCubemaps()`, checks that diffuse, normal, and height textures are cubemaps. A generated equirectangular PNG is useful for browser inspection but is insufficient as the current native planet surface texture.

`KSA/TextureReference.cs`, `DoLoad()`, constructs a `RenderCore.TextureAsset` from the file. `RenderCore/TextureAsset.cs`, `LoadOptions()`, includes the KTX loader as well as the ordinary image loader. `KSA/TextureManifest.cs` exposes format, maximum size, mipmap, and supercompression settings; it does not provide an equirectangular-to-cubemap conversion setting.

Uncompressed KTX2 is therefore a practical browser-generated container. The [Khronos KTX2 specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html) defines six faces ordered +X, -X, +Y, -Y, +Z, -Z, with top-left (`rd`) orientation. Generated files require a valid data format descriptor and correctly aligned level data in addition to that face count.

The CPU height sampler in `RenderCore/TextureAsset.cs` supports uncompressed R16UNorm and byte-channel formats, including the first channel of RGBA8. Its `SampleFaceTwoChannel()` only decodes BC5 and otherwise returns neutral values. An uncompressed generated normal map can therefore have different GPU-shading and CPU-sampling behavior; native verification remains necessary.

## Procedural planet geometry

`KSA/PlanetMeshCollection.cs` deserializes `<CubeMesh>` entries and generates their geometry. A mod can author its own collection and register it through `planetMeshes` in `mod.toml`; it need not borrow the Core `Default` mesh collection. `KSA/PlanetMeshLibrary.cs` discovers collections referenced by the selected world's bodies and oceans.

Surface clutter is a separate asset path: it needs registered clutter templates, mesh references, and material textures. Generating a GLB file alone does not place objects on a surface. See the game-format and asset-generation research for the complete XML connections.

## Meaning of asset independence

`KSA/PlanetRenderer.cs` uses `EmptyCubemap`, `EmptyNormalCubemap`, and default Hapke scattering/surge textures when a body omits its own references. Supplying generated diffuse, normal, height, scattering, and surge resources avoids those surface-resource fallbacks. Optional biome and other omitted features can still use engine fallback resources.

The native game itself always depends on its runtime content: `ModLibrary.AssignDefaults()` resolves Core default resources, and renderers such as `AtmosphereRenderer` resolve shader IDs directly. The achievable contract is **authored systems and their texture/model assets do not borrow the built-in celestial assets**, rather than replacing the entire Core runtime or allowing the game executable to run without Core installed.

## Verification boundaries

Browser rendering establishes editor behavior only. XML parsing establishes syntax only. Archive path/reference closure and KTX/glTF validation add useful independent checks. A native game smoke test is still required to establish actual renderer, physics, collision, and shader behavior for a particular KSA build.
