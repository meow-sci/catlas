# Native atmosphere, clouds, and water fidelity

Verified against KSA build `2026.10.10.5554`, local assembly checkout
`935a32b4dbc34cbcd16e87d16cf9732eb90030c0` and `/Users/asherwin/repos/meow-sci/ksa-linux/Content/Core` on 2026-10-11.
The ksa-modding corpus at `4b2779c` provided the topic map; the actual native
references and shaders below were read before implementation.

## Native schema and units

`AstronomicalTemplate` owns sibling `Atmosphere` and `Clouds` elements. Clouds
are `CloudsReference`, not an XML element named `AtmosphericClouds`.
`AtmosphereRenderer` slots an `AtmosphericBody` with an atmosphere reference;
`CloudRenderer` also requires that reference before rendering its cloud layers.
The editor validates that enabled cloud layers have an enabled atmosphere.

The visual atmosphere has Rayleigh RGB coefficients and scale height; Mie RGB
coefficients, scale height, RGB phase asymmetry, and absorption multiplier; an
ozone/absorber RGB tent with altitude and half extent; and start height. XML
scattering coefficients are **km⁻¹**: `ScatteringCoefficientsReference.OnDataLoad`
multiplies them by `0.001` for the shader's meter units. The visual top is derived:
`startHeight + max(-RayleighH*ln(1e-7/RayleighPeak), -MieH*ln(1e-7/MiePeak))`,
with heights in km and XML coefficients in km⁻¹. The legacy editor `heightKm`
is retained metadata, not a native top-height control.

The previous template coefficients were entered in m⁻¹, yielding skies 1,000
times too weak when exported. New templates use corrected km⁻¹ coefficients.
Imported author values remain exact; migration does not reinterpret them.
Native physical atmosphere remains independently authored pressure/density plus
an ideal-gas scale height derived from temperature, molar mass, and surface gravity.
Temperature and adiabatic index are not additional native physical XML elements.

A `Clouds` block contains transition-start/end altitudes, shadow altitude,
volumetric flicker reduction, and layers. Each exported enabled layer includes:

- Native rotation speed, match-ground color, volumetric color, detail size,
  noise scroll speed, and all raymarch step/light parameters.
- A 2D color texture, normal map, alpha-only flag, color tint, and Lambertian term.
- Optional flow maps with displacement in km and loop duration in hours.
- Every authored cloud type, with start altitude, height, optical density,
  noise scale, edge sharpness, scattering brightness, shape-interpolation flag,
  and full Hermite shape/density curves including incoming/outgoing tangents.

Cloud altitude/height/noise/detail units are km in the XML. Cloud optical density
is used directly with meter-length raymarch steps, so it is m⁻¹. Layer
`RotationSpeed` components and noise scroll speed are linear m/s; native divides
rotation by cloud radius before constructing a yaw/pitch/roll quaternion. The
native GPU cloud-type array has **8 entries**. The editor caps cloud types at 8;
its 8-layer and 16-point curve caps are authoring/resource limits rather than
assertions about native schema capacity.

## Generated original weather assets

Each enabled layer exports four or five PNGs, all generated from the same
direction-based seeded weather field:

| Asset              | Native channel contract                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Mask               | A = global coverage, R = detail-selector blend; G/B unused                               |
| Detail             | RG = coverage/type A, BA = coverage/type B; original periodic variation in every channel |
| Color              | RGB = generated cloud albedo, A = coverage × authored opacity                            |
| Normal             | Tangent-space slopes derived from occupied cloud-column height                           |
| Flow, when enabled | R/G = signed tangent flow encoded around 0.5, B = neutral 128, A = 255                   |

The detail pair spans low/high raw type values. Native
`GetCloudTypeWeights` multiplies the resulting 0..1 type by `typeCount-1`, so
**every intermediate authored type participates**. It does not merely select the
first and last type. Authored opacity scales native optical density as well as
the 2D texture alpha. Color, mask, normal and flow are distinct assets; no stock
diffuse map is reused as a substitute for the weather channels. The complete
`TextureReference` manifest uses non-virtual textures, max size 0, no mips for
mask/detail, and mips for color/normal/flow, following the native Jupiter setup.

KSA equirects use +Z north and
`u = .5 + atan2(y,x)/(2π), v = .5 - asin(z)/π`. The shared authoring/Three frame
uses +Y north, with `nativeToAuthor([x,y,z]) = [x,z,-y]`. Cloud equirect pixels,
terrain cubes, and native named locations all use that same transform. The
preview's explicit spherical shader lookup avoids relying on Three's sphere UV
orientation; ordinary surface/depth maps flip their uploaded Y axis to match it.

## Stock and community evidence

Core `Astronomicals.xml` contains two Jupiter layers: a lower deck and an upper
storm deck. Both use global masks and detail textures, volumetric flow/color,
multiple cloud types and vertical curves; the upper layer also has 2D flow.
Core Saturn contains scattering, physical atmosphere, and rings but no cloud
layers in this build. Neptune is defined inline in each `SolSystem*.xml`, with
Rayleigh/Mie and a nonzero absorber, but no stock cloud layers.

Real Atmospheres at `19dc37a55b2e359bd8eec2f5b41722ab11ae0c46` was read for its
methods: band-associated coverage/type, bright high decks, alternating zonal
jets, coherent flow, thick-cloud self shading, and a careful volumetric/2D handover.
Its generator scripts and code are MIT; its release textures have separate terms
documented in `CREDITS.md`, including noncommercial and attribution conditions.
This implementation copies **no Real Atmospheres code or release texture**, and
copies **no Core textures, models, or shaders**. Its generated art and GLSL are
original implementations informed by the verified native data contract.

## Three preview and practical limits

The atmosphere preview marches exponential Rayleigh/Mie densities, the native
triangular ozone absorber, Beer–Lambert transmittance, Rayleigh and per-channel
Henyey–Greenstein phase functions, and a sun-facing attenuation march with planet
occlusion. Body view uses 12 view samples × 4 sun samples; System view uses 6 × 3.
A small ambient term approximates the native multiple-scattering LUT. Native
per-channel transmission is represented by average alpha in Three's compositing,
so this is a source-informed approximation rather than KSA's LUT implementation.

Clouds use filtered original detail fields, type-dependent optical depth,
brightness, noise scale and edge sharpness, coherent dual-phase flow, and native
rotation/scroll units. The vertical profile bake follows the native type/height
interpolation and preserves all curve points and tangents. Occupied-column height
drives generated normal maps and terrain attenuation; relief is represented on a
shell close to the native outer cloud bound. A shell cannot reproduce a volumetric
camera flying through a deck. Native transition, flicker reduction, raymarch quality
and shadow-volume settings are faithfully exported; their full native behavior is
not simulated by the shell preview. The preview uses flow for color/coverage
together; stock native volumetric map lookup flows its 3D noise, while the native
2D layer advects its map. Real Atmospheres patches that handover, but this editor
does not bundle a game shader patch.

Water preview uses depth-dependent transparency over the actual displaced seabed,
moving original wave normals, wind/fetch-dependent roughness, water IOR, and shallow
foam. KSA uses FFT/Gerstner waves and a statistical Gaussian/Beckmann ocean BRDF;
the browser uses Three's physical material and does not reproduce its FFT.
Ocean **Density remains omitted** from XML to preserve the native default
`1028.13 kg/m³`; this build does not load a supplied density reference correctly.

## Verification and sources

### Gas belt visual QA follow-up

Comparing Jupiter with clouds enabled and disabled isolated an embossed woven
appearance in the shared gas diffuse field, rather than its cloud normals. The
previous phase multiplied latitude by both band frequency and another `2π`, then
added a strong high-frequency harmonic and broadly warped turbulent noise. That
created dozens of thin, rectangular-looking stripes. The gas branch now uses
broad alternating belts, a modest continuous 3D meander, restrained fine
mottling, and three original seeded oval vortex fields. Each vortex smoothly
rotates the local east/north coordinates and contributes a small spiral color
variation. Longitude wrapping remains continuous because the fields are sampled
from sphere directions. The shared rocky sampler, coordinate contract, and gas
height channel remain unchanged. Cloud albedo and exported diffuse maps both use
this corrected field.

Focused tests additionally verify that band frequency changes broad belt count,
seed changes turbulence, storm strength changes the vortex field, and repeated
samples and longitude seams remain stable. Chromium screenshots compared clouds
on/off before and after the correction, with no browser or GLSL errors.

`tests/atmosphere.test.ts` checks native coefficient units and boundaries,
location/cloud coordinate agreement, Hermite interpolation, middle-type profile
participation, density/shape feedback, deterministic independent map channels,
varied detail/normal/flow, complete native XML, PNG byte roundtrips, and disabled
flow/atmosphere behavior. Chromium/SwiftShader previews of Earth and Jupiter were
inspected, with no browser or GLSL errors. Native KSA in-game rendering has not
been run for the generated cloud content.

Primary references read locally:

- [Atmosphere/Cloud schema and type limits](https://github.com/meow-sci/ksa-game-assemblies/tree/935a32b4dbc34cbcd16e87d16cf9732eb90030c0/current/decomp/KSA):
  `AstronomicalTemplate.cs`, `VisualAtmosphereReference.cs`,
  `PhysicalAtmosphereReference.cs`, `ScatteringCoefficientsReference.cs`,
  `CloudsReference.cs`, `CloudLayerReference.cs`, `CloudTypeReference.cs`,
  `CloudShapeReference.cs`, `FlowMapReference.cs`, `RaymarchingReference.cs`,
  `TwoDimensionalCloudReference.cs`, `TextureReference.cs`, `CubicHermiteSpline.cs`.
- [Native cloud layer profile/rotation pipeline](https://github.com/meow-sci/ksa-game-assemblies/blob/935a32b4dbc34cbcd16e87d16cf9732eb90030c0/current/decomp/KSA.Atmosphere.Rendering/CloudLayerRenderData.cs),
  and `KSA.Atmosphere.Rendering.ShaderStructs/CloudTypeDataArray.cs`.
- [Core configs and shaders](https://github.com/meow-sci/ksa-game-assemblies/tree/935a32b4dbc34cbcd16e87d16cf9732eb90030c0/current/Content/Core):
  `Astronomicals.xml`, `SolSystem.xml`, `Shaders/Common/Shared.glsl`,
  `Shaders/Clouds/CloudFunctions.glsl`, `2DCloud.comp`, `CloudDetailMaps.glsl`,
  `Shaders/Atmosphere/AtmosphereFunctions.glsl`, and `Shaders/Water/PBR/OceanPBR.glsl`.
- [Real Atmospheres code/license](https://github.com/Brimfyr/RealAtmospheres/tree/19dc37a55b2e359bd8eec2f5b41722ab11ae0c46):
  `ShadowBuilder.cs`, `Payloads.cs`, `make_giant_clouds.py`,
  `make_giant_flowmaps.py`, `LICENSE`, and `CREDITS.md`.
