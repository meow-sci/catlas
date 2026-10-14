# Original native environment audio

Verified against local build **2026.10.10.5554** on 2026-10-11. Original ambient loops can be loaded through the content schema without FMOD banks, code hooks or copied Core sound files.

[`SoundFileReference.DoLoad`](../../../ksa-game-assemblies/current/decomp/KSA/SoundFileReference.cs) validates the mod-local file path and calls [`GameAudio.CreateFmodSound`](../../../ksa-game-assemblies/current/decomp/KSA/GameAudio.cs). The nonstreaming path loads file bytes and creates an FMOD sound with `Mode.OpenMemory`. A `<Loop />` child sets `Mode.LoopNormal` and defaults to the full file. Generated WAVs use this ordinary native file path.

The exported declarations have this shape:

```xml
<Assets>
  <SpatialSoundData Id="Project_Body_Environment_Spatial">
    <VolumeRange Min="1" Max="10000" />
  </SpatialSoundData>
  <Sound Id="Project_Body_Environment" ChannelId="Sfx"
         Priority="125" SimSpeed="OnlyLower">
    <SoundFile Id="Project_Body_Environment_File"
               Path="Sounds/Body_Environment.wav"
               TwoD="true" Volume="0.35"><Loop /></SoundFile>
    <SpatialSoundData Id="Project_Body_Environment_Spatial" />
    <FadeIn Time="0.5" />
    <FadeOut Time="0.5" />
  </Sound>
</Assets>
```

The rocky body's direct child is `<EnvironmentSound Id="Project_Body_Environment" />`, defined by [`AstronomicalTemplate.EnvironmentSound`](../../../ksa-game-assemblies/current/decomp/KSA/AstronomicalTemplate.cs). Asset IDs and paths are unique per body. `Sfx` is registered by `GameAudio.OnApplicationStart` from `ChannelGroupType`; it is an engine group. Owning a spatial-data asset avoids the default `DefaultSpatialSoundData` reference from Core. The declaration owns every sound/file/spatial-data reference and contains no `.bank` dependency.

The generator emits deterministic, original mono **PCM16, 22,050 Hz** WAVs. Wind uses periodic seeded noise at two resolutions, rumble combines a slower periodic field with a low harmonic, and tones use three integer harmonics of the loop duration. Cyclic interpolation and integer loop harmonics match both ends of the loop. Duration is bounded to 4–30 seconds before allocation. Seed, wind, rumble and tone controls affect the generated audio. Volume remains a native `SoundFile Volume` and browser playback gain, so it is applied once. Browser playback starts only from the user's Play action; environment audio is disabled by default.

[`BiomeSoundController.HandleEnvironmentSound`](../../../ksa-game-assemblies/current/decomp/KSA/BiomeSoundController.cs) supplies native playback. It requires both `BiomesReference` and `EnvironmentSound`, and stops the ambient channel below **0.01 atmospheres** at the camera, about 1.013 kPa. [`PhysicalAtmosphereReference.GetAtmosphericPressure`](../../../ksa-game-assemblies/current/decomp/KSA/PhysicalAtmosphereReference.cs) converts the physical pressure to atmospheres. Consequently an atmosphere-enabled rocky body with valid biomes can play the loop; an airless body or a gas body without the native terrain-biome data does not receive this playback path.

The controller also looks up the base game's `ExtReverb` group, regardless of which ambient asset is playing. The export does not copy or reference a Core sound file, while this existing engine controller continues to require its normal base-game audio setup. The current controller does not explicitly replace an already-playing ambient channel solely when `NearbyCelestial` changes; transitions between two audible bodies need native runtime verification.

Core contains an empty `<BiomeSounds>` stub under terrain, but no field/type/read for it exists in the decompiled current game. The exporter therefore uses `EnvironmentSound` and ordinary `Sound` assets. Native `MultiSound` and `Sound Param` can support optional future layers keyed by biome alias, altitude in metres, pressure in atmospheres and IVA state; the implemented feature uses a single authored mix.

`tests/environment.test.ts` verifies the PCM header, channel count, sample rate, exact duration, deterministic seed behavior, equal endpoint samples, bounded nonclipping amplitude, independent source controls, gain handling and XML/file reference closure. Schema/data checks pass; native playback and body-transition behavior remain separate runtime checks.
