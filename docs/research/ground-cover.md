# Grass and pervasive ground cover

Source checked 2026-10-11 against the local Core content and decompiled game. No Core geometry or texture is copied into Orbit Foundry.

## Native contract

Grass is an ordinary ground-clutter ecotype. `ksa-linux/Content/Core/GroundClutter/GrassAssets.xml` registers a mesh atlas, a `GroundClutterMaterial`, and five mesh LODs. `Astronomicals.xml:1089` places it through `GroundClutter/Ecotype/Placement` with biome membership, object separation, generation range, random scale and yaw, slope mask, and a distribution map. Core's example uses 1.45 m separation, an 80 m generation range, and `SurfaceNormalSmooth` orientation. Those values describe Core's particular grass clump, rather than a universal spacing for every mesh.

The grass material is double sided and uses opacity and thickness maps. It disables casting shadows and enables `BiasNormalsUp`, `ApplyExtraSpec`, and `DistanceFadeDither`. `KSA/GroundClutterMaterialReference.cs` exposes those exact XML properties and enables its transmissive shader flag whenever a thickness map exists. `Shaders/Planet/GroundClutter/Solid.frag:520` samples the red thickness channel and multiplies transmitted lighting by `1 - thickness`: brighter values indicate thicker, less translucent tissue. This shader also contains a wavelength multiplier tuned for grass; alien colors therefore need a native visual check.

The inspected ground-clutter vertex shader has no separate grass or wind-animation path. These authoring assets are static plants. Their native near-camera light response follows the existing clutter material capabilities; the Three.js preview approximates that lighting.

## Original authoring assets

Four ground-cover specimens complement the larger rock, tree and alien library:

| Asset | Approximate height | Role |
| --- | ---: | --- |
| Meadow grass | 0.30 m | Compact green arching blades |
| Dry bunchgrass | 0.70 m | Straw-colored blades and seed stems |
| Alien ribbon grass | 0.45 m | Curled teal blades and violet accents |
| Alien spore mat | 0.12 m | Low living cushion and fine spore filaments |

The blade geometry, surface color, normal, roughness and thickness maps are generated from original definitions. Five levels of geometry keep dense populations inexpensive at a distance. Solid curved blades do not need an opacity map to achieve their silhouette.

Selecting ground cover applies close spacing appropriate to its footprint, smooth terrain orientation, a short native generation range and a 20 m preview patch. Placement remains editable and uses the existing biome, slope, altitude and ocean/launch-site exclusion controls. To cover a biome broadly, select that biome, keep density high and patch contrast low, then adjust object separation against the physical preview. The distribution texture still modulates candidate survival; density is not an exact percentage of covered ground.

## Preview boundaries

The patch can be reduced to 5 m for close inspection. Its initial location is beside the first launch site, outside that site's native vegetation clearance, rather than centered on the pad. Ground cover opts into up to 4,096 drawn instances and 4,096 candidate samples; larger objects retain a smaller draw cap. Detail selection and instance caps keep the approximate mesh workload below 600,000 triangles. The displayed eligible estimate is independent of the draw cap, and the interface identifies capped previews. Large patches may therefore show sampled coverage rather than every native blade. A smaller patch is the appropriate way to inspect a dense meadow.

Grass uses the same native exporter as other clutter, with generated thickness maps and the source-verified foliage flags above. XML/resource checks and browser inspection do not establish an in-game visual match.
