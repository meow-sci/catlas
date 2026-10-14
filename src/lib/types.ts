export type Vec3 = [number, number, number];
export type ColorStop = { at: number; color: string };
export type Occurrence = {
  id: string;
  name: string;
  color: string;
  coverage: number;
  scale: number;
  minHeight: number;
  maxHeight: number;
  minLatitude: number;
  maxLatitude: number;
};
export interface SurfaceSettings {
  seed: number;
  scale: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  warp: number;
  elevation: number;
  seaLevel: number;
  craterDensity: number;
  craterSize: number;
  bandFrequency: number;
  stormStrength: number;
  roughness: number;
  colors: ColorStop[];
  occurrences: Occurrence[];
  biomeBlendStrength: number;
  detailFadeStartM: number;
  detailFadeEndM: number;
  biomes: TerrainBiome[];
}
export interface TerrainMaterialSettings {
  pattern: "regolith" | "sand" | "basalt" | "ice" | "soil";
  color: string;
  secondaryColor: string;
  seed: number;
  textureTiling: number;
  heightTiling: number;
  heightDeformityM: number;
  diffuseScale: number;
  normalScale: number;
  displacementScale: number;
  roughness: number;
  metalness: number;
  detailStrength: number;
}
export interface TerrainBiome {
  id: string;
  name: string;
  color: string;
  coverage: number;
  scale: number;
  minHeight: number;
  maxHeight: number;
  minLatitude: number;
  maxLatitude: number;
  seed: number;
  ground: TerrainMaterialSettings;
  slope: TerrainMaterialSettings;
  slopeBlendStrength: number;
  slopeBlendContrast: number;
  slopeBlendBias: number;
}
export type ClutterOrientation =
  | "Up"
  | "SurfaceNormal"
  | "SurfaceNormalAndGradient"
  | "SurfaceNormalSmooth";
/** Immutable, self-contained static GLB conversion. Binary fields are base64, never URLs. */
export interface ImportedClutterAsset {
  version: 1;
  sourceName: string;
  sourceBytes: number;
  dimensionsM: Vec3;
  vertexCount: number;
  triangleCount: number;
  geometry: { positions: string; normals: string; uvs: string; tangents: string; indices: string };
  groups: { start: number; count: number; material: number }[];
  materials: {
    name: string;
    size: number;
    diffuse: string;
    normal: string;
    orm: string;
    opacity: string;
    cutout: boolean;
    doubleSided: boolean;
  }[];
}
export interface ClutterType {
  stockAssetId?: string;
  importedAsset?: ImportedClutterAsset;
  id: string;
  name: string;
  enabled: boolean;
  seed: number;
  geometry: {
    shape: "boulder" | "pebble" | "crystal" | "grass" | "shrub" | "spire";
    dimensionsM: Vec3;
    detail: number;
    irregularity: number;
  };
  material: {
    color: string;
    secondaryColor: string;
    roughness: number;
    metalness: number;
    normalStrength: number;
    opacity: boolean;
    doubleSided: boolean;
    useTerrainMask: boolean;
  };
  distribution: {
    biomeIds: string[];
    density: number;
    seed: number;
    patchScale: number;
    patchContrast: number;
    objectSeparationM: number;
    generationRangeM: number;
    textureTiling: number;
    minScale: Vec3;
    maxScale: Vec3;
    orientation: ClutterOrientation;
    minRotationDeg: number;
    maxRotationDeg: number;
    slopeMaskStrength: number;
    slopeMaskContrast: number;
    slopeMaskBias: number;
    altitudeDensity: { altitudeM: number; density: number }[];
  };
}
export type ClutterSettings = ClutterType;
export interface RingSettings {
  enabled: boolean;
  innerRadius: number;
  outerRadius: number;
  opacity: number;
  seed: number;
  color: string;
  secondaryColor: string;
  bands: number;
  thickness: number;
}
export interface AtmosphereSettings {
  enabled: boolean;
  heightKm: number;
  pressureKpa: number;
  temperatureK: number;
  density: number;
  molarMass: number;
  adiabaticIndex: number;
  color: string;
  rayleigh: Vec3;
  mie: Vec3;
  absorption: Vec3;
  rayleighHeightKm: number;
  mieHeightKm: number;
  mieAnisotropy: number;
  intensity: number;
  startHeightKm: number;
  ozoneAltitudeKm: number;
  ozoneExtentKm: number;
  mieAbsorptionMultiplier: number;
  mieAnisotropyRgb: Vec3;
}
export interface SplinePointSettings {
  key: number;
  value: number;
  inTangent: number;
  outTangent: number;
}
export interface CloudTypeSettings {
  name: string;
  startAltitudeKm: number;
  heightKm: number;
  density: number;
  noiseScaleKm: number;
  edgeSharpness: number;
  multipleScatteringBrightness: number;
  interpolateShapes: boolean;
  shapeCurve: SplinePointSettings[];
  densityCurve: SplinePointSettings[];
}
export interface CloudLayerSettings {
  id: string;
  enabled: boolean;
  name: string;
  seed: number;
  pattern: "billowed" | "wispy" | "banded";
  coverage: number;
  scale: number;
  contrast: number;
  color: string;
  opacity: number;
  rotationSpeed: Vec3;
  matchGroundColor: boolean;
  useAlphaOnly: boolean;
  lambertian: number;
  detailSizeKm: number;
  noiseScrollSpeed: number;
  flow: { enabled: boolean; strength: number; displacementKm: number; loopHours: number };
  raymarching: {
    stepScale: number;
    stepSizeKm: number;
    maxStepSizeKm: number;
    lightDistanceKm: number;
    lightSamples: number;
  };
  types: CloudTypeSettings[];
}
export interface CloudSettings {
  enabled: boolean;
  orbitTransitionStartKm: number;
  orbitTransitionEndKm: number;
  maxShadowsAltitudeKm: number;
  flickerReductionKm: number;
  layers: CloudLayerSettings[];
}
export interface EnvironmentAudioSettings {
  enabled: boolean;
  seed: number;
  volume: number;
  wind: number;
  rumble: number;
  tones: number;
  loopSeconds: number;
}
export interface LandmarkSettings {
  id: string;
  name: string;
  enabled: boolean;
  category: "landmark" | "city" | "crater" | "mountain";
  latitude: number;
  longitude: number;
  launchPad: boolean;
  groundOffsetM: number;
  sizeM: Vec3;
  color: string;
}
export interface OceanSettings {
  enabled: boolean;
  /** Height relative to the body's mean radius, independently of the terrain height datum. */
  levelKm: number;
  color: string;
  transparencyDepthM: number;
  windWaves: {
    minWindSpeed: number;
    maxWindSpeed: number;
    minWindFetchKm: number;
    maxWindFetchKm: number;
    directionality: number;
    depthM: number;
    foamAmount: number;
  };
  gerstnerWaves: {
    count: number;
    lengthM: number;
    amplitude: number;
    speed: number;
    lengthPersistence: number;
    amplitudePersistence: number;
    speedPersistence: number;
  };
}
export interface OrbitSettings {
  semiMajorAxisAu: number;
  eccentricity: number;
  inclination: number;
  ascendingNode: number;
  argumentOfPeriapsis: number;
  timeAtPeriapsisDays: number;
  definitionFrame: "Ecliptic" | "Equatorial";
  centralMassSuns: number;
  twoBody: boolean;
  barycentric: boolean;
}
export interface RotationSettings {
  periodHours: number;
  tilt: number;
  azimuth: number;
  initialLongitude: number;
  tidallyLocked: boolean;
  retrograde: boolean;
  definitionFrame: "Perifocal" | "Ecliptic" | "Equatorial";
}
export interface Star {
  id: string;
  name: string;
  kind: "star";
  parentId: string | null;
  radiusKm: number;
  massSuns: number;
  color: string;
  sunlight: Vec3;
  position: Vec3;
  sphereOfInfluenceAu: number;
  orbit: OrbitSettings;
}
export interface Barycenter {
  id: string;
  name: string;
  kind: "barycenter";
  parentId: string | null;
  position: Vec3;
  orbit: OrbitSettings;
}
export interface Planet {
  id: string;
  name: string;
  kind: "rocky" | "gas";
  parentId: string;
  radiusKm: number;
  massEarths: number;
  sphereOfInfluenceAu: number;
  homeBody: boolean;
  orbit: OrbitSettings;
  rotation: RotationSettings;
  surface: SurfaceSettings;
  atmosphere: AtmosphereSettings;
  ocean: OceanSettings;
  rings: RingSettings;
  clutter: ClutterType[];
  clouds: CloudSettings;
  landmarks: LandmarkSettings[];
  environmentAudio: EnvironmentAudioSettings;
  exportResolution: 0 | 32 | 64 | 128 | 256 | 512;
}
export type Celestial = Star | Barycenter | Planet;
export interface StarSystem {
  id: string;
  name: string;
  description: string;
  position: Vec3;
  bodies: Celestial[];
}
export interface Project {
  version: 1;
  id: string;
  name: string;
  author: string;
  description: string;
  seed: number;
  galacticPlane: { rightAscension: number; declination: number };
  interstellarGas: number;
  systems: StarSystem[];
  exportResolution: 32 | 64 | 128 | 256 | 512;
}
export type ValidationIssue = { severity: "error" | "warning"; message: string; bodyId?: string };
export const isPlanet = (body: Celestial): body is Planet =>
  body.kind === "rocky" || body.kind === "gas";
export const AU_KM = 149597870.7;
export const SOLAR_EARTH_MASS = 332946;
