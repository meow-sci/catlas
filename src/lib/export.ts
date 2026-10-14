import {
  environmentSoundXml,
  environmentAssetsXml,
  generateEnvironmentAssets,
} from "./environment";
import {
  surfaceBiomesXml,
  surfaceTerrainXml,
  surfaceClutterBodyXml,
  surfaceClutterAssetsXml,
} from "./surfaceExport";
import { cloudsXml, generateCloudAssets } from "./atmosphereExport";
import { landmarksXml, landmarkAssetsXml, generateLandmarkAssets } from "./landmarks";
import { assertExportBudget, bodyResolution } from "./exportBudget";
import JSZip from "jszip";
import { generateBodyAssets } from "./assets";
import { parseColor } from "./procedural";
import { validateProject } from "./project";
import {
  isPlanet,
  type AtmosphereSettings,
  type Celestial,
  type OceanSettings,
  type OrbitSettings,
  type Planet,
  type Project,
  type RingSettings,
  type RotationSettings,
  type Star,
  type StarSystem,
  type Vec3,
} from "./types";

type Progress = (message: string, progress: number) => void;
type FileMap = Record<string, Uint8Array | string>;

const xml = (value: string | number | boolean): string =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const number = (value: number): string => {
  if (!Number.isFinite(value)) throw new Error("Export contains a non-finite number.");
  return String(Number(value.toPrecision(12)));
};
const rgb = (color: string): string =>
  parseColor(color)
    .map(number)
    .map((value, i) => ` ${"RGB"[i]}="${value}"`)
    .join("");
const color3 = (values: Vec3): string =>
  values
    .map(number)
    .map((value, i) => ` ${"RGB"[i]}="${value}"`)
    .join("");
const safeId = (value: string): string =>
  value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]/, "_$&");
const uid = (project: Project, body: Celestial): string => `${safeId(project.id)}_${body.id}`;
const bodyPath = (body: Planet, suffix: string, extension = "ktx2"): string =>
  `Textures/${body.id}_${suffix}.${extension}`;
const meshPath = (body: Planet): string => `Meshes/${body.id}_Rock.glb`;

function assertExportable(project: Project): void {
  const issues = validateProject(project).filter((issue) => issue.severity === "error");
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join("\n"));
  for (const system of project.systems) {
    const own = new Set(system.bodies.map((body) => body.id));
    for (const body of system.bodies) {
      if (body.parentId && !own.has(body.parentId))
        throw new Error(`${body.name}: parent must be in the same star system tab.`);
      if (body.kind === "barycenter" && body.parentId)
        throw new Error(`${body.name}: a barycenter must be a root.`);
      if (isPlanet(body) && !body.parentId)
        throw new Error(`${body.name}: a planet needs a parent.`);
      if (body.kind === "star" && !(body.massSuns > 0))
        throw new Error(`${body.name}: star mass must be positive.`);
    }
    for (const body of system.bodies.filter((body) => body.kind === "barycenter")) {
      if (
        !system.bodies.some(
          (child) => child.kind === "star" && child.parentId === body.id && child.orbit.barycentric,
        )
      ) {
        throw new Error(
          `${body.name}: barycenter needs a barycentric child star to establish its mass.`,
        );
      }
    }
  }
}

function orbitXml(settings: OrbitSettings, indent: string): string[] {
  const out = [
    `${indent}<Orbit DefinitionFrame="${settings.definitionFrame}">`,
    `${indent}  <SemiMajorAxis Au="${number(settings.semiMajorAxisAu)}" />`,
    `${indent}  <Inclination Degrees="${number(settings.inclination)}" />`,
    `${indent}  <Eccentricity Value="${number(settings.eccentricity)}" />`,
    `${indent}  <LongitudeOfAscendingNode Degrees="${number(settings.ascendingNode)}" />`,
    `${indent}  <ArgumentOfPeriapsis Degrees="${number(settings.argumentOfPeriapsis)}" />`,
    `${indent}  <TimeAtPeriapsis Days="${number(settings.timeAtPeriapsisDays)}" />`,
  ];
  if (settings.centralMassSuns > 0)
    out.push(`${indent}  <CentralMass Suns="${number(settings.centralMassSuns)}" />`);
  if (settings.twoBody) out.push(`${indent}  <TwoBody Value="true" />`);
  if (settings.barycentric) out.push(`${indent}  <Barycentric Value="true" />`);
  out.push(`${indent}</Orbit>`);
  return out;
}

function rotationXml(rotation: RotationSettings, indent: string): string[] {
  return [
    `${indent}<Rotation DefinitionFrame="${rotation.definitionFrame}">`,
    `${indent}  <SiderealPeriod Hours="${number(rotation.periodHours)}" />`,
    `${indent}  <Tilt Degrees="${number(rotation.tilt)}" />`,
    `${indent}  <Azimuth Degrees="${number(rotation.azimuth)}" />`,
    `${indent}  <InitialParentFacingLongitude Degrees="${number(rotation.initialLongitude)}" />`,
    `${indent}  <IsTidallyLocked Value="${rotation.tidallyLocked}" />`,
    `${indent}  <IsRetrograde Value="${rotation.retrograde}" />`,
    `${indent}</Rotation>`,
  ];
}

function positionXml(position: Vec3, indent: string): string[] {
  return [
    `${indent}<Position>`,
    ...position.map((value, i) => `${indent}  <${"XYZ"[i]} Ly="${number(value)}" />`),
    `${indent}</Position>`,
  ];
}
const addPosition = (system: Vec3, offset: Vec3): Vec3 => [
  system[0] + offset[0],
  system[1] + offset[1],
  system[2] + offset[2],
];

function atmosphereXml(a: AtmosphereSettings, body: Planet, indent: string): string[] {
  if (!a.enabled) return [];
  const rayleigh = a.rayleigh.map((v) => v * a.intensity) as Vec3;
  const mie = a.mie.map((v) => v * a.intensity) as Vec3;
  const ozone = a.absorption.map((v) => v * a.intensity) as Vec3;
  return [
    `${indent}<Atmosphere>`,
    `${indent}  <Visual>`,
    `${indent}    <RayleighScattering>`,
    `${indent}      <Coefficients${color3(rayleigh)} />`,
    `${indent}      <ScaleHeight Km="${number(a.rayleighHeightKm)}" />`,
    `${indent}    </RayleighScattering>`,
    `${indent}    <MieScattering>`,
    `${indent}      <Coefficients${color3(mie)} />`,
    `${indent}      <ScaleHeight Km="${number(a.mieHeightKm)}" />`,
    `${indent}      <PhaseFunctionAsymmetry X="${number(a.mieAnisotropyRgb[0])}" Y="${number(a.mieAnisotropyRgb[1])}" Z="${number(a.mieAnisotropyRgb[2])}" />`,
    `${indent}      <AbsorptionMultiplier Value="${number(a.mieAbsorptionMultiplier)}" />`,
    `${indent}    </MieScattering>`,
    `${indent}    <Ozone>`,
    `${indent}      <Coefficients${color3(ozone)} />`,
    `${indent}      <Altitude Km="${number(a.ozoneAltitudeKm)}" />`,
    `${indent}      <Extent Km="${number(a.ozoneExtentKm)}" />`,
    `${indent}    </Ozone>`,
    `${indent}    <StartHeight Km="${number(a.startHeightKm)}" />`,
    `${indent}  </Visual>`,
    `${indent}  <Physical>`,
    `${indent}    <SeaLevelPressure KPa="${number(a.pressureKpa)}" />`,
    `${indent}    <SeaLevelDensity KgPerM3="${number(a.density)}" />`,
    `${indent}    <ScaleHeight Km="${number(Math.max(0.001, (8.314462618 * a.temperatureK) / ((a.molarMass / 1000) * ((6.6743e-11 * body.massEarths * 5.9722e24) / (body.radiusKm * 1000) ** 2)) / 1000))}" />`,
    `${indent}  </Physical>`,
    `${indent}</Atmosphere>`,
  ];
}

function oceanXml(project: Project, ocean: OceanSettings, indent: string): string[] {
  if (!ocean.enabled) return [];
  const wind = ocean.windWaves;
  const waves = ocean.gerstnerWaves;
  // Density is deliberately omitted: this native build does not initialize an
  // XML-supplied DensityReference and would read NaN instead of its safe default.
  return [
    `${indent}<Ocean>`,
    `${indent}  <Level Km="${number(ocean.levelKm)}" />`,
    `${indent}  <MeshCollection Id="${safeId(project.id)}_PlanetMeshes" />`,
    `${indent}  <WindWaves>`,
    `${indent}    <MinWindSpeed Value="${number(wind.minWindSpeed)}" />`,
    `${indent}    <MaxWindSpeed Value="${number(wind.maxWindSpeed)}" />`,
    `${indent}    <MinWindFetch Km="${number(wind.minWindFetchKm)}" />`,
    `${indent}    <MaxWindFetch Km="${number(wind.maxWindFetchKm)}" />`,
    `${indent}    <Directionality Value="${number(wind.directionality)}" />`,
    `${indent}    <Depth M="${number(wind.depthM)}" />`,
    `${indent}    <FoamAmount Value="${number(wind.foamAmount)}" />`,
    `${indent}  </WindWaves>`,
    `${indent}  <GerstnerWaves>`,
    `${indent}    <Count Value="${number(waves.count)}" />`,
    `${indent}    <Length M="${number(waves.lengthM)}" />`,
    `${indent}    <Amplitude Value="${number(waves.amplitude)}" />`,
    `${indent}    <Speed Value="${number(waves.speed)}" />`,
    `${indent}    <LengthPersistence Value="${number(waves.lengthPersistence)}" />`,
    `${indent}    <AmplitudePersistence Value="${number(waves.amplitudePersistence)}" />`,
    `${indent}    <SpeedPersistence Value="${number(waves.speedPersistence)}" />`,
    `${indent}  </GerstnerWaves>`,
    `${indent}  <Color${rgb(ocean.color)} />`,
    `${indent}  <TransparencyDepth M="${number(ocean.transparencyDepthM)}" />`,
    `${indent}</Ocean>`,
  ];
}

function ringXml(project: Project, body: Planet, ring: RingSettings, indent: string): string[] {
  if (!ring.enabled) return [];
  const id = uid(project, body);
  return [
    `${indent}<Rings DefinitionFrame="Equatorial">`,
    `${indent}  <Inclination Degrees="0" />`,
    `${indent}  <LongitudeOfAscendingNode Degrees="0" />`,
    `${indent}  <InnerRadius Km="${number(body.radiusKm * ring.innerRadius)}" />`,
    `${indent}  <OuterRadius Km="${number(body.radiusKm * ring.outerRadius)}" />`,
    `${indent}  <Texture Id="${id}_Rings" Path="${bodyPath(body, "Rings", "png")}" />`,
    `${indent}  <ControlTexture Id="${id}_RingsControl" Path="${bodyPath(body, "RingsControl", "png")}" />`,
    `${indent}  <DetailScale Value="${number(Math.max(1, ring.bands))}" />`,
    `${indent}  <Volume>`,
    `${indent}    <MinThickness Km="${number(Math.max(0.001, (ring.thickness / 1000) * 0.1))}" />`,
    `${indent}    <MaxThickness Km="${number(Math.max(0.002, ring.thickness / 1000))}" />`,
    `${indent}    <MinRenderDistance Km="1000" />`,
    `${indent}    <MaxRenderDistance Km="100000" />`,
    `${indent}    <Step Scale="0.006"><MinSize Km="0.1" /><MaxSize Km="1000" /></Step>`,
    `${indent}    <FadeToMeshes Value="true" />`,
    `${indent}  </Volume>`,
    `${indent}  <RingObjects Name="${id}_RingRock">`,
    `${indent}    <Size M="10" /><Thickness Km="1" /><RenderDistance Km="20" /><Density Value="${number(Math.max(1, ring.bands))}" />`,
    `${indent}    <LODs><LOD MinScreenSize="2"><Mesh Id="${id}_RingMesh" Path="${meshPath(body)}" /></LOD></LODs>`,
    `${indent}    <Material>`,
    `${indent}      <Diffuse Id="${id}_RingDiffuse" Path="${bodyPath(body, "Rock_Diffuse", "png")}" />`,
    `${indent}      <Normal Id="${id}_RingNormal" Path="${bodyPath(body, "Rock_Normal", "png")}" />`,
    `${indent}      <AoRoughMetal Id="${id}_RingAoRoughMetal" Path="${bodyPath(body, "Rock_AoRoughMetal", "png")}" />`,
    `${indent}    </Material>`,
    `${indent}  </RingObjects>`,
    `${indent}</Rings>`,
  ];
}

function planetXml(project: Project, body: Planet, indent: string): string[] {
  const id = uid(project, body);
  const parent = `${safeId(project.id)}_${body.parentId}`;
  const tag =
    body.kind === "gas" || body.atmosphere.enabled || body.ocean.enabled
      ? "AtmosphericBody"
      : "PlanetaryBody";
  const attrs = ` Id="${xml(id)}" Parent="${xml(parent)}"${body.homeBody ? ' HomeBody="true"' : ""}`;
  const out = [
    `${indent}<${tag}${attrs}>`,
    ...orbitXml(body.orbit, `${indent}  `),
    ...rotationXml(body.rotation, `${indent}  `),
    `${indent}  <MeshCollection Id="${safeId(project.id)}_PlanetMeshes" />`,
    `${indent}  <MeanRadius Km="${number(body.radiusKm)}" />`,
    `${indent}  <Mass Earths="${number(body.massEarths)}" />`,
    `${indent}  <Color${rgb(body.surface.colors[Math.floor(body.surface.colors.length / 2)].color)} />`,
    `${indent}  <Diffuse Id="${id}_Diffuse" Path="${bodyPath(body, "Diffuse")}" Category="Terrain" />`,
  ];
  if (body.sphereOfInfluenceAu > 0)
    out.push(`${indent}  <SphereOfInfluence Au="${number(body.sphereOfInfluenceAu)}" />`);
  if (body.kind === "rocky") {
    out.push(
      `${indent}  <Normal Id="${id}_Normal" Path="${bodyPath(body, "Normal")}" Category="TerrainHeight" />`,
      `${indent}  <Scattering Id="${id}_Scattering" Path="${bodyPath(body, "Scattering")}" Category="Terrain"><MeanAlbedo Value="0.32" /><MeanDiffuseLuminosity Value="0.5" /></Scattering>`,
      `${indent}  <Surge Id="${id}_Surge" Path="${bodyPath(body, "Surge")}" Category="Terrain"><MeanSlopeRoughness Degrees="${number(2 + body.surface.roughness * 43)}" /></Surge>`,
      `${indent}  <Height Id="${id}_Height" Path="${bodyPath(body, "Height")}" Category="TerrainHeight"><Minimum Km="${number(-body.surface.seaLevel * body.surface.elevation)}" /><Maximum Km="${number((1 - body.surface.seaLevel) * body.surface.elevation)}" /></Height>`,
      ...surfaceBiomesXml(project, body, `${indent}  `),
    );
  }
  out.push(...surfaceTerrainXml(project, body, `${indent}  `));
  out.push(...atmosphereXml(body.atmosphere, body, `${indent}  `));
  out.push(...cloudsXml(body, id, `${indent}  `));
  out.push(...oceanXml(project, body.ocean, `${indent}  `));
  out.push(...landmarksXml(project, body, `${indent}  `));
  out.push(...environmentSoundXml(project, body, `${indent}  `));
  out.push(...ringXml(project, body, body.rings, `${indent}  `));
  out.push(...surfaceClutterBodyXml(project, body, `${indent}  `));
  out.push(`${indent}</${tag}>`);
  return out;
}

function starXml(project: Project, star: Star, system: StarSystem, indent: string): string[] {
  const id = uid(project, star);
  const parent = star.parentId ? ` Parent="${xml(`${safeId(project.id)}_${star.parentId}`)}"` : "";
  const out = [
    `${indent}<StellarBody Id="${xml(id)}"${parent}>`,
    `${indent}  <MeanRadius Km="${number(star.radiusKm)}" />`,
    `${indent}  <Mass Suns="${number(star.massSuns)}" />`,
    `${indent}  <Color${rgb(star.color)} />`,
    `${indent}  <Sunlight${color3(star.sunlight)} />`,
  ];
  if (star.parentId) out.push(...orbitXml(star.orbit, `${indent}  `));
  else out.push(...positionXml(addPosition(system.position, star.position), `${indent}  `));
  if (star.sphereOfInfluenceAu > 0)
    out.push(`${indent}  <SphereOfInfluence Au="${number(star.sphereOfInfluenceAu)}" />`);
  out.push(`${indent}</StellarBody>`);
  return out;
}

/** One native System XML, with every editor tab as a tree in the same traversable universe. */
export function buildSystemXml(project: Project): string {
  assertExportable(project);
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<System Id="${xml(safeId(project.id))}">`,
    `  <DisplayName Value="${xml(project.name)}" />`,
    "  <GalacticPlane>",
    `    <RightAscension Degrees="${number(project.galacticPlane.rightAscension)}" />`,
    `    <Declination Degrees="${number(project.galacticPlane.declination)}" />`,
    "  </GalacticPlane>",
    `  <InterstellarGas AtomsPerCm3="${number(project.interstellarGas)}" />`,
  ];
  for (const system of project.systems) {
    lines.push(`  <!-- ${xml(system.name).replace(/--/g, "- -")} -->`);
    for (const body of system.bodies) {
      if (body.kind === "star") lines.push(...starXml(project, body, system, "  "));
      else if (body.kind === "barycenter") {
        lines.push(
          `  <Barycenter Id="${xml(uid(project, body))}">`,
          ...positionXml(addPosition(system.position, body.position), "    "),
          "  </Barycenter>",
        );
      } else lines.push(...planetXml(project, body, "  "));
    }
  }
  lines.push("</System>");
  return lines.join("\n") + "\n";
}

function meshCollectionXml(project: Project): string {
  const id = safeId(project.id);
  return `<?xml version="1.0" encoding="utf-8"?>\n<PlanetMeshCollection Id="${id}_PlanetMeshes">\n  <CubeMesh Id="${id}_MeshFar"><Face Resolution="4" /><Select Offset="6"><Subdivide Ratio="2" /></Select></CubeMesh>\n  <CubeMesh Id="${id}_MeshNear"><Distance Km="20000" /><Face Resolution="16" /><Select Offset="16"><Subdivide Ratio="2" /></Select></CubeMesh>\n</PlanetMeshCollection>\n`;
}

function readme(project: Project): string {
  const warnings = validateProject(project).filter((issue) => issue.severity === "warning");
  const warningText = warnings.length
    ? `\n## Warnings\n\n${warnings.map((issue) => `- ${issue.message}`).join("\n")}\n`
    : "";
  return `# ${project.name}\n\n${project.description}\n\nAuthor: ${project.author}\n\nThis is a native Kitten Space Agency content mod generated by Orbit Foundry. Place the containing ${project.id} folder under your KSA user mods directory, enable it in the game, restart if prompted, and select “${project.name}” as the system. The system file contains ${project.systems.length} star-system ${project.systems.length === 1 ? "tree" : "trees"} in one traversable universe.\n\nSource: project.json contains the complete editable source project. Systems/${project.id}.xml and Assets.xml use KSA's native content schema, researched against game build 2026.10.10.5554. Generated cubemap textures, ground and slope biome materials, independently authored clutter meshes, cloud layer maps, launch platforms, optional original ambient PCM WAV loops, and ring textures are included. Imported static GLB models and their converted texture channels are retained in project.json and included in the native meshes/materials. Stock and generated models have distinct detail levels; imported models currently reuse their complete geometry at all five native LODs. Grass and alien ground cover use the native clutter placement system with generated foliage thickness maps. Each body can override the collection resolution; generation is bounded by a browser memory preflight.\n\nAuthorable oceans: enabled rocky bodies export native water surfaces using their own generated mesh collection and height cubemap. Ocean level is measured in kilometers relative to mean radius. Color, transparency depth, wind waves, foam, and Gerstner waves are authored in project.json. Without a wind map, maximum wind speed and fetch apply uniformly. Water density retains the native default of 1,028.13 kg/m³ because this build does not load custom ocean density correctly.\n\nLimitations: native game rendering and physics have not been validated for this export. The atmosphere physical scale height is derived from temperature, molar mass, and surface gravity; adiabatic index is retained as project metadata. Legacy atmosphere color and height metadata are retained in project.json; rendering uses RGB scattering coefficients in km^-1 and derives the visual boundary from their scale heights. Clouds export native layers, types, curves, raymarching settings, and original mask/detail/color/normal/flow assets. Launch landmarks include original StaticObject platforms with native colliders; named cities/craters/mountains are coordinate markers. Native biome detail HeightTiling and HeightDeformity are serialized but have no verified renderer consumer in this build. Individual display names are also preserved in project.json because native celestial bodies use IDs as names.\n${warningText}`;
}

export async function buildModFiles(project: Project, onProgress?: Progress): Promise<FileMap> {
  const systemXml = buildSystemXml(project);
  assertExportBudget(project);
  const id = safeId(project.id);
  const files: FileMap = {
    "mod.toml": `name = ${JSON.stringify(project.name)}\nsystems = ["Systems/${id}.xml"]\nassets = ["Assets.xml"]\nplanetMeshes = ["PlanetMeshes.xml"]\n`,
    [`Systems/${id}.xml`]: systemXml,
    "PlanetMeshes.xml": meshCollectionXml(project),
    "Assets.xml": [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<Assets>",
      ...project.systems.flatMap((system) =>
        system.bodies
          .filter(isPlanet)
          .flatMap((body) => [
            ...surfaceClutterAssetsXml(project, body),
            ...landmarkAssetsXml(project, body),
            ...environmentAssetsXml(project, body),
          ]),
      ),
      "</Assets>",
      "",
    ].join("\n"),
    "project.json": JSON.stringify(project, null, 2) + "\n",
    "README.md": readme(project),
  };
  const planets = project.systems.flatMap((system) => system.bodies).filter(isPlanet);
  const nativePaths = new Set(Object.keys(files).map((path) => path.toLowerCase()));
  onProgress?.("Preparing native system files", 0.03);
  for (const [index, planet] of planets.entries()) {
    onProgress?.(
      `Generating ${planet.name} assets (${index + 1}/${planets.length})`,
      0.05 + (index / Math.max(1, planets.length)) * 0.88,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const resolution = bodyResolution(project, planet);
    const generated = [
      ...(await generateBodyAssets(planet, resolution)),
      ...(await generateCloudAssets(planet, resolution)),
      ...(await generateLandmarkAssets(planet)),
      ...(await generateEnvironmentAssets(planet)),
    ];
    for (const asset of generated) {
      const nativePath = asset.path.toLowerCase();
      if (nativePaths.has(nativePath))
        throw new Error(`Duplicate export path (case-insensitive): ${asset.path}`);
      nativePaths.add(nativePath);
      files[asset.path] = asset.data;
    }
  }
  onProgress?.("Validating archive references", 0.95);
  for (const match of (systemXml + files["Assets.xml"]).matchAll(/\bPath="([^"]+)"/g)) {
    if (!(match[1] in files)) throw new Error(`Export references missing asset: ${match[1]}`);
  }
  onProgress?.("Ready to package", 1);
  return files;
}

export async function exportMod(project: Project, onProgress?: Progress): Promise<Blob> {
  const files = await buildModFiles(project, onProgress);
  const archive = new JSZip();
  const folder = archive.folder(safeId(project.id));
  if (!folder) throw new Error("Could not create mod folder in archive.");
  for (const [path, contents] of Object.entries(files)) folder.file(path, contents);
  onProgress?.("Compressing mod", 1);
  return archive.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
