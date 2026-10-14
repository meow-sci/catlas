# KSA celestial system format (game build 2026.10.10.5554)

This is the contract for exporting a native, data-only KSA solar system mod. It is derived from the current decompilation in `ksa-game-assemblies/current/decomp/KSA/` and the shipped Linux content in `ksa-linux/Content/Core/`. The format is XML serialized through .NET `XmlSerializer`; examples in this document use the exact element and attribute case. The modding knowledge base was used to find topics, then checked against these build sources.

## Where the data lives and how it loads

`mod.toml` uses `name`, `systems = ["MySystem.xml"]`, and optionally `assets = ["Bodies.xml"]`. The folder name supplies the mod ID. These paths resolve relative to the folder containing `mod.toml`; asset file paths (such as a ring PNG) also resolve relative to that folder. Native content mods need no DLL or StarMap entry point. The game discovers mod folders under `Content/` and the user mods directory, registers their system files for selection, and loads the selected system template. Newly discovered user mods may need enabling in the manifest/UI. Source: `Mod.cs:24-25,59-69,99-109,128-160,389-392,417-439`; `FileReference.cs:10-26`; `ModLibrary.cs:178-180,295-304,380-443`; stock `Content/Core/mod.toml:1-24,64-65`.

`systems` files have a `<System Id="...">` root. They may define bodies inline or select reusable body assets with `<LoadFromLibrary Id="..." Parent="..." HomeBody="true"/>`. Reusable bodies go in an `<Assets>` root listed in `assets`. The Core mod illustrates this split: `SolSystem.xml:1-44` is a system, `Astronomicals.xml:1-10` holds Sol and Mercury, and `InterstellarAstronomicals.xml:1-72` holds Alpha Centauri. `SystemTemplate.cs:8-32` and `AssetBundle.cs:10-24` enumerate the exact accepted body tags; `AstronomicalReference.cs:16-29` resolves library references. A stand-alone export can keep all bodies inline and omit `assets`.

A separately registered `systems` entry creates another selectable system; it does not append bodies to Core's `SolSystem.xml`. Native KSA has no `patches` field in `Mod` (`Mod.cs:59-69`). Editing another mod's XML in place requires an additional patching layer such as KittenExtensions, whose `patches` key and XPath behavior are outside KSA's native serializer contract. For a browser exporter, a complete new system XML is the dependency-free output. Source: `SystemLibrary.cs:8-22`; `SystemTemplate.cs:20-32`; [patch-game-xml-data overview](../../ksa-modding/references/howto/assets/xml-patching/patch-game-xml-data/overview.md).

The system selector first reads the same XML as a small `SystemInfo`, using `<DisplayName Value="..."/>` plus optional texture summary elements. `DisplayName` affects the selector; `VesselTextures`, `TerrainTextures`, and `UnscaledTextures` are estimates, not body definitions. Source: `SystemInfo.cs:7-29,56-58`; `Mod.cs:417-439`; `SolSystem.xml:1-44`.

## System and body hierarchy

There is no serialized `<Galaxy>` container in the current system format. A selected `<System>` is the top level, and it may hold multiple independent roots (fixed stars or root barycenters) at ecliptic positions. At runtime `Universe.CurrentSystem` is one `CelestialSystem`; `Universe.Roots` and `Universe.Stars` are computed from its bodies. `GalacticPlane` describes orientation for that system rather than introducing another parent level. `InterstellarGas` is a system child with `AtomsPerCm3` defaulting to 0.1. Source: `SystemTemplate.cs:8-32`; `Universe.cs:106-114,239-255`; `InterstellarGas.cs:5-14`.

`<System>` recognizes `<GalacticPlane>`, `<InterstellarGas>`, `<LoadFromLibrary>`, `<StellarBody>`, `<Barycenter>`, `<MinorBody>`, `<Asteroid>`, `<PlanetaryBody>`, `<TerrestrialBody>`, `<AtmosphericBody>`, and comet/vehicle tags. Bodies are a flat list under `<System>` with `Id` and optional `Parent` **attributes**; nesting one body inside another is not the contract. `Parent` must match an `Id` present in the selected system, including library references. A body with no `Parent` is a root. `HomeBody="true"` chooses a planet-like parent body; choose one. If none is marked, the runtime picks the first nonstar parent body and warns. Source: `SystemTemplate.cs:14-32,64-90`; `AstronomicalTemplate.cs:20-24,239-266`; `CelestialSystem.cs:145-194,197-250`; `SerializedId.cs:12-13`.

The shared body serializer recognizes `MeshCollection`, `RandomHeightmapCollection`, `Height`, `Diffuse`, `Normal`, `Scattering`, `Surge`, `Detail`, `Triplanar`, `Biomes`, `Terrain`, `GroundClutter`, `Atmosphere`, `Clouds`, `Ocean`, `Rings`, and `EnvironmentSound` (this last field has its default XML name). `Parent` and `HomeBody` are shared attributes. These references are optional in the serializer; supplying a stock-looking rendered planet requires the corresponding meshes/textures/terrain assets. Source: `AstronomicalTemplate.cs:14-68`. There is no `<RockyBody>` or `<GasBody>` tag. Core uses `PlanetaryBody` for Mercury and many moons, `MinorBody` for smaller bodies, and `AtmosphericBody` for both Venus and the gas giants; these are engine/template classes, not a strict physical composition taxonomy. Source: `Astronomicals.xml:10,34,3677,4214`; `PlanetaryBodyTemplate.cs:5-19`; `MinorBodyTemplate.cs:6`; `AtmosphericBodyTemplate.cs:5-12`.

All nonstar celestial tags inherit the same serialized children: `Color`, `Rotation`, `Orbit`, `Mass`, `SphereOfInfluence`, `MeanRadius`, `TerrainScale` (default numeric 300), and optional `City`, `Landmark`, `Crater`, `Mountain` entries. `Color` defaults to gray; missing numeric `Mass` and `MeanRadius` values have invalid/zero reference semantics, so an exporter should always emit them. `PlanetaryBody`, `TerrestrialBody`, `MinorBody`, and `AtmosphericBody` add no further serialized fields of their own. Source: `CelestialTemplate.cs:9-41`; `StaticCelestialTemplate.cs:1-5`; `PlanetaryBodyTemplate.cs:5-19`; `TerrestrialBodyTemplate.cs:5-19`; `MinorBodyTemplate.cs:6`; `AtmosphericBodyTemplate.cs:5-12`.

## Stars, coordinates, and binaries

`<StellarBody Id="..." [Parent="..."]>` has all shared astronomical fields above plus precisely seven star-specific children: `Color`, `Mass`, `MeanRadius`, `Sunlight`, `Position`, `SphereOfInfluence`, and `Orbit`. `Color` defaults to gray and `Sunlight` to white; `Mass`, `MeanRadius`, `Position`, `SphereOfInfluence`, and `Orbit` have default reference objects. A fixed root star uses `Position` as its ecliptic XYZ location; omitted coordinates resolve to zero, as Sol does. A child star orbits its parent and uses `Orbit`. A missing fixed-star sphere of influence becomes infinity; orbiting-star influence is estimated from its orbit and mass. A robust export emits `Mass`, `MeanRadius`, `Color`, and `Sunlight` explicitly. Source: `StellarBodyTemplate.cs:7-50`; `PositionReference.cs:6-17`; `FixedStar.cs:15-23`; `OrbitingStar.cs:55-66`; `Astronomicals.xml:3-8`.

`<Position><X Ly="..."/><Y Ly="..."/><Z Ly="..."/></Position>` is a 3D Cartesian position, **not** right ascension/declination. Each component is a distance reference, so `Ly`, `Au`, `Km`, `M`, `Cm`, or `Mm` may be used. The engine calls the world position `Ecl`; the stock interstellar data documents its coordinates as real ecliptic directions and distances. `<GalacticPlane>` is a separate system orientation element with `RightAscension`, `Declination`, and optional `NorthCelestialPoleLongitude` angle children; stock Sol uses `RightAscension Degrees="192.86"` and `Declination Degrees="27.13"`. Source: `PositionReference.cs:6-17`; `DistanceReference.cs:7-25`; `Barycenter.cs:35-45`; `FixedStar.cs:19-28`; `GalacticPlane.cs:7-18`; `InterstellarAstronomicals.xml:8-16`; `SolSystem.xml:5-8`.

For a binary, use a root `<Barycenter Id="...">` with a `Position`, then two `<StellarBody Parent="barycenter-id">` entries. `Barycenter` itself has only `Position` beyond shared astronomical fields and cannot have a parent. Its runtime mass is the **sum of immediate child stars whose orbit has `<Barycentric Value="true"/>`**. Each star must carry its own `Mass` and a valid `Orbit`; `Barycentric` scales the authored relative orbit to that star's share and uses a barycentric central mass. The Core Alpha Centauri pair authors the same `SemiMajorAxis Au="23.5"` and eccentricity for both stars, with arguments of periapsis 180° apart and `Barycentric=true`. A third star, Proxima, uses `TwoBody=true` rather than contributing to the barycenter mass. This is the demonstrated engine contract for binary authoring; the serializer does not enforce exactly two stars. Source: `BarycenterTemplate.cs:7-28`; `Barycenter.cs:114-138`; `OrbitTemplate.cs:33-40,116-144`; `InterstellarAstronomicals.xml:7-72`.

`<Orbit DefinitionFrame="Ecliptic|Equatorial">` defaults to `Equatorial`. Its children are `SemiMajorAxis` or `Periapsis` (distance), `Eccentricity Value`, `Inclination`, `LongitudeOfAscendingNode`, `ArgumentOfPeriapsis` (angles), `TimeAtPeriapsis` (time), optional `CentralMass` (mass), and booleans `TwoBody` and `Barycentric` (both default false). The engine's `IsValid` requires argument, eccentricity, inclination, ascending node, semimajor axis, and time. `TimeAtPeriapsis` defaults to zero; the stock XML still emits it in interstellar orbits. If `Periapsis` is supplied, `OnDataLoad` derives semimajor axis from periapsis and eccentricity. The usable definition frames are `Equatorial` and `Ecliptic`. Source: `OrbitTemplate.cs:7-40,42-87,90-100`; `InterstellarAstronomicals.xml:20-64`. The `<Rotation>` children are `Tilt`, `Azimuth`, `SiderealPeriod`, `InitialParentFacingLongitude`, `IsTidallyLocked`, and `IsRetrograde`; `DefinitionFrame` defaults to `Perifocal`. Source: `RotationTemplate.cs:5-26`.

Scalar units: distance supports `Ly`, `Au`, `Km`, `M`, `Cm`, `Mm`; mass supports `Suns`, `Jupiters`, `Earths`, `Lunars`, `Tonnes`, `Yg`, `Zg`, `Eg`, `Pg`, `Tg`, `Gg`, `Mg`, `Kg`, `G`; angle supports `Degrees` or `Radians`; `Eccentricity` and similar scalars use `Value`; RGB color uses `R`, `G`, `B` (or a named color). Time supports `Years`, `Months`, `Weeks`, `Days`, `Hours`, `Minutes`, `Seconds`, plus `Nanos` for universe times. Source: `DistanceReference.cs:7-25`; `MassReference.cs:7-49`; `RadianReference.cs:7-14`; `DoubleReference.cs:5-8`; `ColorRgbReference.cs:7-19`; `UniverseTimeReference.cs:9-33`; `TimeSpanReference.cs:7-29`.

For landable rocky surfaces, `<Terrain><BiomeMaterials><BiomeMaterial Biome="Surface"><GroundMaterial>…</GroundMaterial><SlopeMaterial>…</SlopeMaterial></BiomeMaterial></BiomeMaterials></Terrain>` maps the `Surface` alias from `<Biomes><Biome ... Alias="Surface"/>` to both material slots. Each material can contain `Diffuse`, `Normal`, and `AoRoughMetal` texture references; `Displacement` and `Height` are optional, and missing channels use engine fallback textures. `BiomeMaterials` defaults `DetailFadeInStart` to 1,000,000 m and `DetailFadeInEnd` to 5,000 m, satisfying its required start > end condition. Empty `ProceduralModifiers` is valid. Source: `TerrainReference.cs:8-29`; `BiomeMaterialsReference.cs:8-18,22-65`; `BiomeMaterialReference.cs:8-26,53-83`; `TerrainMaterialReference.cs:8-30,52-55`; `PbrMaterialReference.cs:12-19`.

## Atmospheres, oceans, and rings

An atmosphere is optional `<Atmosphere><Visual>...</Visual><Physical>...</Physical></Atmosphere>` on any astronomical body. `Visual` has `RayleighScattering` (`Coefficients R/G/B`, `ScaleHeight`), `MieScattering` (those plus `PhaseFunctionAsymmetry X/Y/Z`, `AbsorptionMultiplier Value`), `Ozone` (`Coefficients`, `Altitude`, `Extent`), and `StartHeight`. `Physical` has `SeaLevelPressure`, `SeaLevelDensity`, and `ScaleHeight`. Defaults in the current code are 101325 Pa, 1.225 kg/m³, and 1 km physical scale height; both visual scattering scale heights default to 1 km. The stock Venus values are a complete concrete example. Source: `AtmosphereReference.cs:5-11`; `VisualAtmosphereReference.cs:6-26`; `PhysicalAtmosphereReference.cs:6-27`; `RayleighScatteringReference.cs:6-12`; `MieScatteringReference.cs:6-18`; `Astronomicals.xml:161-184`. Pressure accepts `Pa`, `KPa`, `MPa`, `MBar`, `Bar`, `Atm`; density accepts `TonnePerM3`, `KgPerM3`, `GPerM3`, `MgPerM3`, `UgPerM3`, `GPerCm3` (`PressureReference.cs:7-25`; `DensityReference.cs:7-25`).

`<Ocean>` has `Level`, `Density`, `WindWaves`, `GerstnerWaves`, `Color`, optional `ColorTexture`, `TransparencyDepth`, and `MeshCollection` children (`KSA.Rendering.Water.Data/OceanReference.cs:7–28`). Native rendering requires an `AtmosphericBody` with a height reference and an explicitly referenced nonempty mesh collection. An atmosphere itself is optional. The exporter exposes level/color/transparency/waves but **omits Density**: this build fails to initialize XML-supplied density, while omission preserves the working `1028.13 kg/m³` constructor default. Optional ocean maps can use engine fallbacks. See the [ocean investigation and authoring contract](ocean-buffer-startup-crash.md) for source evidence and wave units.

At least one ocean-referenced mesh must be in use across the active native `<System>` in this build. Otherwise the unconditional ocean renderer attempts a zero-byte buffer allocation at startup. This is a runtime condition beyond serializer validity; it applies to all editor star-system tabs together because they export as one system.

`<Rings DefinitionFrame="Equatorial|Ecliptic">` has `Inclination`, `LongitudeOfAscendingNode`, `InnerRadius`, `OuterRadius`, `Texture`, `ControlTexture`, `DetailScale` (default 300), `Volume`, and `RingObjects`. Default frame is `Equatorial`; default radii are zero. **Emit both textures, `Volume`, and `RingObjects` whenever emitting `Rings`**: the current `OnDataLoad` calls each directly without a null guard. `Volume` has `MinThickness` (1 km), `MaxThickness` (10 km), `MinRenderDistance` (1000 km), `MaxRenderDistance` (100000 km), `Step`, and `FadeToMeshes` (true). `RingObjects` adds mesh LODs and material, and its validity check requires 1–5 LODs plus valid material, size, thickness, render distance, and density. Saturn is the stock full example, with `Texture` and `ControlTexture` paths and volume/mesh settings. Source: `PlanetaryRingsReference.cs:5-59`; `PlanetaryRingsVolumeReference.cs:5-39`; `RingObjectsReference.cs:7-59`; `Astronomicals.xml:4261-4305`. A mod that exports ring `Path` values must include those files relative to its own folder (`FileReference.cs:10-26`; `TextureReference.cs:84-103`).

## Minimal self-contained export

This is a **data-only serializer example**, not a launchable preset for the current build. It uses no Core library body and no external texture path. It shows a fixed star and a small orbiting home body; rendered surfaces need extra assets, and this deliberately minimal example lacks the ocean needed to avoid the current ocean-renderer startup bug.

```text
MySystem/
  mod.toml
  MySystem.xml
```

```toml
# mod.toml
name = "My System"
systems = ["MySystem.xml"]
```

```xml
<?xml version="1.0" encoding="utf-8"?>
<System Id="MySystem">
  <DisplayName Value="My System" />
  <StellarBody Id="MyStar">
    <MeanRadius Km="696342" />
    <Mass Suns="1" />
    <Color R="1" G="1" B="1" />
    <Sunlight R="9" G="9" B="9" />
    <Position><X Ly="0"/><Y Ly="0"/><Z Ly="0"/></Position>
  </StellarBody>
  <MinorBody Id="MyPlanet" Parent="MyStar" HomeBody="true">
    <Orbit DefinitionFrame="Ecliptic">
      <SemiMajorAxis Au="1" />
      <Eccentricity Value="0" />
      <Inclination Degrees="0" />
      <LongitudeOfAscendingNode Degrees="0" />
      <ArgumentOfPeriapsis Degrees="0" />
      <TimeAtPeriapsis Days="0" />
    </Orbit>
    <MeanRadius Km="6371" />
    <Mass Earths="1" />
    <Color R="0.6" G="0.7" B="0.8" />
  </MinorBody>
</System>
```

This XML follows `SystemTemplate.cs:8-32`, `StellarBodyTemplate.cs:7-28`, `CelestialTemplate.cs:13-32`, `OrbitTemplate.cs:7-40`, and the compact native body example in `SolSystem.xml:45-58`. The actual game has not been launched with this exact example; it is serializer and source-checked, not an integration test. If the editor needs reliable rendered/landable surfaces, export a mesh collection, height/terrain references, and files instead of treating this minimal example as a visual preset.

For an asset-backed export, add `assets = ["Bodies.xml"]`, put reusable definitions under `<Assets>`, and put matching `<LoadFromLibrary Id="body-id" Parent="..."/>` entries in the system file. Keep IDs unique within the selected system. The registered mod is selected through the game's system picker; simply placing a folder on disk does not switch the active system. Source: `Mod.cs:59-69,128-160,417-439`; `SystemTemplate.cs:20-32,64-90`; `AssetBundle.cs:10-24`; `AstronomicalReference.cs:16-29`.
