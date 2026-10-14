# Generated oceanless systems trigger a zero-byte ocean buffer

Diagnosis recorded 2026-10-11 against the supplied decompiled KSA build `2026.10.10.5554`. The reported native crash occurs in `OceanRenderer.CreateCullingIndexBuffers`, after a successful ring-capacity log entry. Three independent GPT-6.1-sol/xhigh investigations traced the renderer, audited export contracts, and regenerated the reported project variant. The initial investigation changed no application/game code. The subsequently requested ocean-authoring implementation is recorded below.

## Finding

At the time of the reported crash, the exporter emitted no `<Ocean>` definitions. On a fresh game startup, the selected generated system consequently leaves `PlanetMeshLibrary.MaxOceanIndexCount` at zero. KSA constructs its ocean renderer unconditionally and requests an `OceanCullingIndexBuffer` of `0 × sizeof(int) = 0` bytes. This violates Vulkan buffer-creation requirements and matches the failing allocation in the supplied stack trace.

This is a compatibility gap in the exported content that exposes a native empty-ocean initialization bug. The XML can deserialize and all asset paths can exist while the renderer still cannot initialize. Removing Luna's ring does not address this condition.

## Source chain

Source locations below are relative to `../ksa-game-assemblies/current/decomp/` from the application repository.

1. The original `src/lib/export.ts:262–297` emitted a planet's terrain, atmosphere, rings, and clutter but no ocean. Its line 271 referenced the generated terrain mesh collection. `meshCollectionXml()` at original lines 348–350 provided two nonempty `CubeMesh` definitions; terrain meshes were present. Application line numbers describe the pre-correction exporter.
2. `KSA/PlanetMeshLibrary.cs:30` declares the initially zero `MaxOceanIndexCount`. `GenerateInUse()` examines bodies in the **selected active system**, not every asset in Core (lines 49–64).
3. An ocean mesh enters the relevant set only through `bodyTemplate.OceanReference.MeshCollection` (lines 64, 80–87). The maximum is raised only for successfully resolved/generated members of that set (lines 92–104). A terrain mesh or a merely registered but unused ocean collection cannot raise it.
4. `KSA/Program.cs:1179–1181` constructs `OceanRenderer` without checking whether the system has oceans.
5. `KSA.Rendering.Water.Rendering/OceanRenderer.cs:216–221` calls `CreateCullingIndexBuffers()`. At lines 936–948, each frame's buffer size is `PlanetMeshLibrary.MaxOceanIndexCount * ByteSize.Of<int>()` with no positive minimum.
6. `KSA/KsaVmaAllocator.cs:49–54` discards the unsuccessful `VkResult` and throws the generic `Vma Failed to create buffer` exception. The message alone does not identify an out-of-memory error.

Vulkan's [VkBufferCreateInfo specification](https://docs.vulkan.org/refpages/latest/refpages/source/VkBufferCreateInfo.html), rule `VUID-VkBufferCreateInfo-size-00912`, requires a positive buffer size. The native failure result is not present in the user log, but the zero-sized allocation follows directly from the current exported content and initialization code.

## Reproduction of generated content

The actual `createProject()` and `buildModFiles()` functions were executed at the unchanged default 128px cubemap resolution. A second project differed only by enabling Luna's rings.

| Generated output | Files | Total uncompressed file bytes | XML Path references | Missing paths | Oceans | Rings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Defaults | 197 | 43,526,575 | 226 | 0 | 0 | 1 |
| Defaults plus Luna rings | 199 | 43,540,096 | 232 | 0 | 0 | 2 |

Enabling Luna's rings added only `Textures/Luna_Rings.png` and `Textures/Luna_RingsControl.png`. The system XML and project JSON changed. `PlanetMeshes.xml`, `Assets.xml`, all existing cubemaps, and rock GLBs remained byte-identical. The starter already enables Saturn's rings.

The reported ring-capacity log is emitted after five ring buffers have successfully allocated (`KSA.Rendering.Rings.Rendering/PlanetaryRingsRenderer.cs:636–690`). Its mesh/impostor counts are not inputs to the subsequent ocean buffer calculation.

Temporary reproduction artifacts are `/tmp/orbit-foundry-repro/baseline/` and `/tmp/orbit-foundry-repro/luna-rings/`; rerun with `node /tmp/orbit-foundry-reproduce.mjs` while that temporary script remains available. Native KSA was not launched during this investigation.

## Corrections supported by the source

### Content workaround for the default collection

A real ocean on the exported Earth can supply a positive ocean index count using an already generated mesh collection:

```xml
<!-- Inside AtmosphericBody Id="OrbitFoundry_Earth" -->
<Ocean>
  <MeshCollection Id="OrbitFoundry_PlanetMeshes" />
</Ocean>
```

This is a source-derived candidate workaround, not an in-game-tested patch. Earth is already an `AtmosphericBody` with a generated height texture, satisfying the important downstream prerequisites. `OceanRenderer.PopulatePlanets()` considers atmospheric bodies and requires the mesh collection (`OceanRenderer.cs:449–468`); `OceanRenderData.Create()` consumes the body's height texture. `KSA.Rendering.Water.Data/OceanReference.cs` supplies default level, density, waves, color, and transparency. Optional ocean color/wind textures have runtime white-texture fallbacks. For a useful visible ocean, author its appearance and wave settings deliberately rather than relying on all defaults.

`<Ocean/>` alone, an unresolved/empty collection, or merely adding an ocean mesh file to `planetMeshes` does not fix the allocation. Reusing terrain geometry is sufficient to establish nonzero capacity but is not a claim that its two coarse LODs offer production-quality ocean rendering. The workaround changes Earth to have a real ocean and cannot preserve the semantics of every intentionally dry collection.

### Native empty-ocean handling

For general oceanless systems, the narrow native correction is to allocate a minimum capacity of one integer in `CreateCullingIndexBuffers`, while retaining the true global maximum of zero:

```csharp
int capacity = Math.Max(1, PlanetMeshLibrary.MaxOceanIndexCount);
// BufferSize = capacity * ByteSize.Of<int>();
```

That yields a four-byte placeholder buffer per frame. Existing ocean draw/underwater paths already return when the populated ocean dictionary is empty (`OceanRenderer.cs:536–539,619–622`). It preserves the initialized resources expected by disposal and rebuild. Simply returning early from the constructor or skipping all culling initialization requires additional lifecycle changes: disposal currently unmaps/disposes those resources unconditionally (lines 883–889).

The content correction is now implemented as explicit ocean authoring, as described below. The native empty-ocean allocator has not been patched. A native game smoke test is still required.

## Implemented ocean authoring

Rocky worlds have an `OceanSettings` object and Ocean inspector tab. New starter Earth and blank-collection Homeworld have oceans enabled. Other newly added bodies start dry. Version 1 projects predating the field import with disabled ocean defaults, preserving their content and producing a collection warning until the author enables an ocean. Explicit malformed settings are rejected.

Enabled oceans export `<Level Km>`, `<Color R G B>`, `<TransparencyDepth M>`, `<WindWaves>`, `<GerstnerWaves>`, and an explicit reference to the mod’s own nonempty `PlanetMeshes` collection. They use the same generated R16 height cubemap as terrain and require no borrowed celestial assets. Optional wind/color maps are omitted; the engine has white-texture fallbacks. With no wind map, `OceanRenderer.cs:572–580` sets `WindMapValue=1`, so maximum wind speed/fetch apply uniformly. Minima remain authored native XML fields for future mapped variation.

Only rocky bodies can enable water because `OceanRenderData.Create()` requires their height reference. They serialize as `AtmosphericBody` even when visual/physical atmosphere is disabled: `AtmosphericBody.cs:5,22–39` supports a null atmosphere, and `AtmosphereRenderer.cs:398` skips allocating atmosphere resources for such a body. Terrain and water share the mean-radius datum: ground height is `(sample − seaLevel) × relief` kilometers, and ocean height is the independent `levelKm`. Gerstner amplitude is dimensionless steepness, with displacement computed as amplitude divided by wave number in `GerstnerWavesReference.GetMaxWaveDisplacement()`.

Validation checks the entire exported collection, since all editor star-system tabs become one native `<System>`. The warning indicator opens a popup listing warnings/errors and explaining that **at least one enabled ocean is required anywhere in that collection**. This is a warning, as requested, so intentionally dry exports remain possible and also record the warning in their packaged README. Invalid ocean fields remain blocking errors.

### Native density initialization bug

Custom ocean density is deliberately not exposed or emitted. `OceanReference.cs:37–47` calls load hooks for level, wind, Gerstner waves, color, mesh collection, and transparency, but never calls `Density.OnDataLoad()`. `DensityReference.cs:28` initializes its cached `_value` to NaN; only the numeric constructor or `OnDataLoad()` at lines 79–82 assigns a runtime value. `PhysicsEnvironment.cs:47` reads that cache through the implicit operator.

A local .NET 10 `XmlSerializer` reproduction using the native public-field/constructor structure confirmed that an omitted density element retains the constructor default `1028.13 kg/m³`, while `<Density KgPerM3="900"/>` replaces the field with an object whose XML attribute is 900 and cached runtime value is NaN. Reproducer files were `/tmp/ocean-density-serialization.cs` and `/tmp/orbit-ocean-audit/serializer.csproj`. This is a serializer-level reproduction, not an in-game physics test.

The absent `FoamAmount.OnDataLoad()` call in `WindWavesReference` is harmless: `DoubleReference.cs:7–8,20–26` stores/reads its XML `Value` directly and its load hook is empty. Wave distance wrappers, ocean level, and transparency all have explicit load calls. The exporter therefore retains the working default density while exporting the supported wave/color/level controls.

## Why the previous checks passed

`tests/export.test.ts` checks packaged mesh filenames, XML syntax, generated assets, and closure of existing `Path` references. It does not model renderer initialization or require an ocean-referenced mesh. The browser renderer does not instantiate KSA's ocean renderer. Those checks therefore missed this global startup requirement.

Regression coverage should follow the native `GenerateInUse` selection rule and check that an export intended for the unpatched build has positive in-use ocean mesh capacity. Include both the starter and starter-plus-Luna-rings cases. If the native empty-ocean bug is fixed instead, verify an entirely dry collection in the real game. Do not replace this with a check for an arbitrary mesh file or an arbitrary `<Ocean>` tag.
