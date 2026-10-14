# Native surface locations and launch pads

Verified 2026-10-11 against local KSA build `2026.10.10.5554` (`ksa-game-assemblies/current/decomp/KSA`) and `ksa-linux/Content/Core`. These are source-contract findings, not an in-game launch test.

## Named coordinates versus physical objects

`CelestialTemplate.Locations` accepts `Landmark`, `City`, `Crater`, and `Mountain`. All inherit `LocationReference`: `Id`, `Latitude Degrees`, `Longitude Degrees`, and optional `StaticObject` attribute. Cities, craters and mountains are named points; these definitions do not generate buildings or alter terrain. The procedural terrain generator remains responsible for visible craters and mountains.

`LandmarkReference.IsLaunchPad` is a boolean XML attribute. `ShowGroundMarker` equals this flag. `LocationReference.UpdateStaticObjectRenderData` returns immediately when `ShowGroundMarker` is false: attaching a static object to an ordinary city or landmark does not render it. The editor consequently offers named locations and physical launch pads, rather than unsupported generic buildings.

Both `VehicleLaunchMenu.SetLocations` and `VehicleEditor.SetLocations` include **all landmarks** as launch destinations, even without `IsLaunchPad`. Their celestial menus initially select bodies with any location and prefer the system home body. A home body with no landmarks, or a body with only city/crater/mountain points, can therefore leave the native launch destination list empty. This deserves an authoring warning.

## Self-contained launch pad contract

The exporter generates original GLB geometry and PNG material maps. `AssetBundle` accepts direct `StaticObject` children, so subobject indirection is unnecessary for a simple pad:

```xml
<Assets>
  <MeshAtlas Path="Meshes/Pad.glb" />
  <PbrMaterial Id="Mod_PadMaterial">
    <Diffuse Path="Textures/Pad_Diffuse.png" Category="Vessel" />
    <Normal Path="Textures/Pad_Normal.png" Category="Vessel" />
    <AoRoughMetal Path="Textures/Pad_AoRoughMetal.png" Category="Vessel" />
  </PbrMaterial>
  <StaticObject Id="Mod_Pad">
    <PartModel Id="Mod_PadModel">
      <Mesh Id="PadMesh" /><Material Id="Mod_PadMaterial" />
    </PartModel>
    <Collider Id="Mod_PadCollider">
      <Box Id="Mod_PadBox">
        <LocationAsmb X="1" Y="0" Z="0" />
        <Collider2Asmb X="0" Y="0" Z="0" />
        <LengthX M="2" /><LengthY M="80" /><LengthZ M="80" />
      </Box>
    </Collider>
    <GroundOffset M="0.2" /><SurfaceHeight M="2" /><FootprintRadius M="40" />
  </StaticObject>
</Assets>
```

Inside the celestial definition:

```xml
<Landmark Id="Launch pad" IsLaunchPad="true" StaticObject="Mod_Pad">
  <Latitude Degrees="0" /><Longitude Degrees="0" />
</Landmark>
```

`MeshAtlasFileReference.DoLoad` registers `gltf.meshes[i].name`; the mesh name must match `Mesh Id`. The importer reads mesh primitives directly, so transforms are baked into vertex positions. Position, normal, UV and tangent attributes are generated. KSA assembly axes at a location are **+X up, +Y east, +Z north**, despite the preview's conventional Three.js Y-up space. The box spans X=0..height and is centered in east/north. The collider center lies at height/2, matching the visible geometry.

`StaticObject.ResolveAll` resolves both models and a Bepu compound collider, then links celestial locations. `StaticObjectTemplate.OnDataLoad` explicitly loads ground offset, surface height and footprint distances. Separate `StaticObjectGameData` is optional; Core uses it to override its prefab's placeholder distances.

## Native constraints

- `Vehicle.GetLaunchPadHeightAtDirCcf` uses the **first** matching pad whose footprint contains the launch position. It adds `GroundOffset + SurfaceHeight` to the vehicle's terrain-relative placement. Our circular footprint is inscribed in the rectangular platform, so it does not claim empty corners outside the platform.
- `ConstraintSim.UpdateStaticObjectCollider` enables only the nearest launch pad collider within **300 m**, per craft/kitten. Very large pads and tightly overlapping sites are poor authoring choices.
- `GroundClutterPlacementData.PopulateLaunchPadExclusionZones` includes only the **first four** valid pads on a body, each with clearance `FootprintRadius + 50 m`. More sites still exist but can receive clutter.
- There is no site-local native terrain flattening or ocean removal in this contract. Select dry, relatively flat coordinates; moving a platform above the terrain does not create foundations or drain water.
- A location's latitude/longitude vector is native Z-up: `[cos(lat)cos(lon), cos(lat)sin(lon), sin(lat)]`. Preview coordinate conversion must account for its Y-up convention.

## Browser surface picking

The Sites inspector's **Place on planet** button activates a one-shot pointer mode. Raycasting accepts only the actual displaced terrain mesh for the selected rocky body, excluding water, clouds, rings and site-marker decoration. The world intersection is transformed through `terrain.worldToLocal`, undoing current tilt/spin and any scene transforms. `authorToNativeDirection` then converts the Y-up local point to native Z-up latitude/longitude. Picking clamps exact poles to ±89.999° because the native site tangent frame is singular at ±90°.

One valid left click records an undoable coordinate change and exits pointer mode. Escape, pressing the button again, or leaving the selected body/view cancels without changing coordinates. Orbit controls are suspended while picking, preventing a placement click, drag or scroll from moving the camera. Unit coverage checks coordinate conversion under transforms; Chromium coverage checks actual terrain picking and all cancellation paths.

## Source anchors

Source-relative paths under `ksa-game-assemblies/current/decomp/KSA`: `CelestialTemplate.cs`, `LocationReference.cs`, `LandmarkReference.cs`, `StaticObjectTemplate.cs`, `StaticSubObjectTemplate.cs`, `StaticObject.cs`, `MeshAtlasFileReference.cs`, `MeshReference.cs`, `PartModelModule.cs`, `ColliderModule.cs`, `BoxColliderTemplate.cs`, `PbrMaterialReference.cs`, `Vehicle.cs` (`GetInitialKinematicStateForLocation`, `GetLaunchPadHeightAtDirCcf`), `ConstraintSim.cs` (`ResolveLaunchPads`, `UpdateStaticObjectCollider`), `GroundClutterPlacementData.cs` (`PopulateLaunchPadExclusionZones`), `VehicleLaunchMenu.cs`, and `VehicleEditor.cs` (`SetLocations`). Shipped examples: `CoreLaunchPadAAssets.xml`, `CoreLaunchPadAGameData.xml`, Earth landmarks in `Astronomicals.xml`.
