import { environmentAudio } from "./environment";
import { compileSurfaceSampler } from "./procedural";
import { defaultBiome, defaultClutter } from "./surface";
import { clouds } from "./atmosphere";
import { defaultLandmark } from "./landmarks";
import { validateFidelity } from "./fidelityValidation";
import { IMPORTED_LIMITS } from "./imported-clutter";
import type {
  AtmosphereSettings,
  Celestial,
  OceanSettings,
  OrbitSettings,
  Planet,
  Project,
  Star,
  StarSystem,
  SurfaceSettings,
  ValidationIssue,
  Vec3,
} from "./types";
import { isPlanet } from "./types";

export const orbit = (au = 1, eccentricity = 0.02): OrbitSettings => ({
  semiMajorAxisAu: au,
  eccentricity,
  inclination: 0,
  ascendingNode: 0,
  argumentOfPeriapsis: 0,
  timeAtPeriapsisDays: 0,
  definitionFrame: "Ecliptic",
  centralMassSuns: 0,
  twoBody: false,
  barycentric: false,
});
export const atmosphere = (enabled = false): AtmosphereSettings => ({
  enabled,
  heightKm: 80,
  pressureKpa: 101.325,
  temperatureK: 288.15,
  density: 1.225,
  molarMass: 28.9644,
  adiabaticIndex: 1.4,
  color: "#81b5ff",
  rayleigh: [0.005802, 0.013558, 0.0331],
  mie: [0.003996, 0.003996, 0.003996],
  absorption: [0.00065, 0.001881, 0.000085],
  rayleighHeightKm: 8,
  mieHeightKm: 1.2,
  mieAnisotropy: 0.8,
  intensity: 1,
  startHeightKm: 0,
  ozoneAltitudeKm: 20,
  ozoneExtentKm: 40,
  mieAbsorptionMultiplier: 1.111111,
  mieAnisotropyRgb: [0.8, 0.8, 0.8],
});
export const ocean = (enabled = false): OceanSettings => ({
  enabled,
  levelKm: 0,
  color: "#28678a",
  transparencyDepthM: 100,
  windWaves: {
    minWindSpeed: 2,
    maxWindSpeed: 15,
    minWindFetchKm: 30,
    maxWindFetchKm: 800,
    directionality: 1,
    depthM: 200,
    foamAmount: 0.5,
  },
  gerstnerWaves: {
    count: 0,
    lengthM: 300,
    amplitude: 0.02,
    speed: 6,
    lengthPersistence: 0.9,
    amplitudePersistence: 1.005,
    speedPersistence: 0.915,
  },
});
export const surface = (
  seed = 42,
  palette = ["#182a45", "#28536b", "#71836a", "#b3a184", "#e9e1ce"],
): SurfaceSettings => ({
  seed,
  scale: 3.4,
  octaves: 5,
  persistence: 0.52,
  lacunarity: 2.1,
  warp: 0.8,
  elevation: 12,
  seaLevel: 0.35,
  craterDensity: 0.15,
  craterSize: 0.07,
  bandFrequency: 12,
  stormStrength: 0.45,
  roughness: 0.82,
  colors: palette.map((color, i) => ({ at: i / (palette.length - 1), color })),
  occurrences: [],
  biomeBlendStrength: 2,
  detailFadeStartM: 3000,
  detailFadeEndM: 500,
  biomes: [
    defaultBiome("Surface", seed, palette[Math.floor(palette.length / 2)]),
    {
      ...defaultBiome("Highlands", seed + 17, palette[palette.length - 1]),
      name: "Highlands",
      minHeight: 0.58,
      coverage: 0.8,
    },
    {
      ...defaultBiome("Polar", seed + 31, "#d8dce0"),
      name: "Polar frost",
      minLatitude: 62,
      coverage: 1,
    },
  ],
});
export function makePlanet(
  id: string,
  name: string,
  parentId: string,
  kind: "rocky" | "gas" = "rocky",
  au = 1,
): Planet {
  return {
    id,
    name,
    kind,
    parentId,
    radiusKm: kind === "gas" ? 58000 : 6371,
    massEarths: kind === "gas" ? 95 : 1,
    sphereOfInfluenceAu: 0,
    homeBody: false,
    orbit: orbit(au),
    rotation: {
      periodHours: 24,
      tilt: 23.4,
      azimuth: 0,
      initialLongitude: 0,
      tidallyLocked: false,
      retrograde: false,
      definitionFrame: "Ecliptic",
    },
    surface: surface(
      hashString(id),
      kind === "gas" ? ["#3b3544", "#977668", "#dbc3a2", "#b68966", "#eddec8"] : undefined,
    ),
    atmosphere: atmosphere(kind === "gas"),
    ocean: ocean(),
    rings: {
      enabled: false,
      innerRadius: 1.4,
      outerRadius: 2.4,
      opacity: 0.7,
      seed: 78,
      color: "#d7c5a3",
      secondaryColor: "#645a55",
      bands: 90,
      thickness: 500,
    },
    clutter: kind === "rocky" ? [defaultClutter("Rocks", 58, "#857c6d")] : [],
    clouds: clouds(kind, hashString(id)),
    landmarks: [],
    environmentAudio: environmentAudio(),
    exportResolution: 0,
  };
}
/** Pick a dry, locally gentle authored terrain patch for a new home platform. */
export function homeLandmark(body: Planet) {
  const site = defaultLandmark("FoundryPad", "Foundry launch pad");
  const sample = compileSurfaceSampler(body);
  let best = Infinity;
  for (let i = 0; i < 360; i++) {
    const latitude = -65 + (i % 19) * (130 / 18);
    const longitude = ((i * 137.507764) % 360) - 180;
    const lat = (latitude * Math.PI) / 180,
      lon = (longitude * Math.PI) / 180;
    const direction: Vec3 = [
      Math.cos(lat) * Math.cos(lon),
      Math.sin(lat),
      -Math.cos(lat) * Math.sin(lon),
    ];
    const height = sample(direction).height;
    const groundKm = (height - body.surface.seaLevel) * body.surface.elevation;
    if (body.ocean.enabled && groundKm <= body.ocean.levelKm + 0.05) continue;
    const offset: Vec3 = [direction[0] + 0.001, direction[1] + 0.001, direction[2] - 0.001];
    const slope = Math.abs(sample(offset).height - height);
    if (slope < best) {
      best = slope;
      site.latitude = latitude;
      site.longitude = longitude;
    }
  }
  return site;
}

export function makeStar(id: string, name: string, position: Vec3 = [0, 0, 0]): Star {
  return {
    id,
    name,
    kind: "star",
    parentId: null,
    radiusKm: 695700,
    massSuns: 1,
    color: "#fff0d0",
    sunlight: [9.2, 9.2, 9.2],
    position,
    sphereOfInfluenceAu: 100000,
    orbit: orbit(0.2),
  };
}
export function hashString(value: string) {
  let h = 2166136261;
  for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function uniqueId(name: string, ids: string[]) {
  const base = (name.replace(/[^a-zA-Z0-9_]/g, "") || "Body").replace(/^[^A-Za-z_]/, "_$&");
  const nativeIds = new Set(ids.map((id) => id.toLowerCase()));
  let id = base,
    i = 2;
  while (nativeIds.has(id.toLowerCase())) id = base + i++;
  return id;
}
export function createProject(): Project {
  const sol: StarSystem = {
    id: "Sol",
    name: "Sol",
    description: "A familiar starting point. Every world uses freshly generated assets.",
    position: [0, 0, 0],
    bodies: [makeStar("Sol", "Sol")],
  };
  const specs: [string, number, number, number, "rocky" | "gas", string[]?][] = [
    ["Mercury", 0.387, 2439.7, 0.0553, "rocky", ["#343134", "#62584e", "#a49788", "#d8cab3"]],
    ["Venus", 0.723, 6051.8, 0.815, "rocky", ["#493627", "#8b5f35", "#c79854", "#e5cd92"]],
    ["Earth", 1, 6371, 1, "rocky"],
    ["Mars", 1.524, 3389.5, 0.107, "rocky", ["#4b2824", "#8e4833", "#bd7150", "#e1b990"]],
    ["Jupiter", 5.203, 69911, 317.8, "gas"],
    ["Saturn", 9.537, 58232, 95.16, "gas", ["#7c6c4b", "#b6a579", "#eadcb7", "#b79a70", "#f0e5cc"]],
    ["Uranus", 19.19, 25362, 14.54, "gas", ["#37606b", "#739d9d", "#acd1cb", "#88bcbf"]],
    ["Neptune", 30.07, 24622, 17.15, "gas", ["#142d63", "#244ea5", "#5488d1", "#8aabd9"]],
  ];
  for (const [name, au, radius, mass, kind, palette] of specs) {
    const b = makePlanet(name, name, "Sol", kind, au);
    b.radiusKm = radius;
    b.massEarths = mass;
    if (palette) b.surface = surface(hashString(name), palette);
    b.atmosphere.enabled = ["Earth", "Venus", "Mars"].includes(name) || kind === "gas";
    b.homeBody = name === "Earth";
    if (name === "Saturn") b.rings.enabled = true;
    if (name === "Earth") {
      b.ocean.enabled = true;
      b.surface.seaLevel = 0.48;
      b.surface.craterDensity = 0;
      b.clutter[0].material.color = "#657352";
      b.clouds.enabled = true;
      b.landmarks = [homeLandmark(b)];
    }
    if (name === "Venus") {
      b.atmosphere.color = "#f0bd74";
      b.atmosphere.pressureKpa = 9200;
      b.atmosphere.temperatureK = 737;
    }
    if (name === "Mars") {
      b.atmosphere.color = "#d6946f";
      b.atmosphere.pressureKpa = 0.636;
    }
    sol.bodies.push(b);
  }
  const luna = makePlanet("Luna", "Luna", "Earth", "rocky", 0.00257);
  luna.radiusKm = 1737.4;
  luna.massEarths = 0.0123;
  luna.rotation.tidallyLocked = true;
  luna.surface = surface(220, ["#303239", "#747371", "#a5a39b", "#e1ddd3"]);
  luna.surface.craterDensity = 0.8;
  sol.bodies.push(luna);
  const barnard = makeStar("BarnardsStar", "Barnard’s Star");
  barnard.radiusKm = 130096;
  barnard.massSuns = 0.162;
  barnard.color = "#ffb56b";
  barnard.sunlight = [9, 6.4, 3.8];
  const tau = makeStar("TauCeti", "Tau Ceti");
  tau.radiusKm = 551690;
  tau.massSuns = 0.8;
  tau.color = "#ffe3cc";
  tau.sunlight = [9, 8.3, 7.6];
  const neighbors: StarSystem[] = [
    {
      id: "Barnard",
      name: "Barnard’s Star",
      description: "A compact system around a nearby red dwarf.",
      position: [-0.0568315, -5.2581852, 2.8114872],
      bodies: [barnard],
    },
    {
      id: "TauCetiSystem",
      name: "Tau Ceti",
      description: "A warm G-type star with worlds to reimagine.",
      position: [10.2932272, 3.308481, -4.999418],
      bodies: [tau],
    },
  ];
  const barnardPlanets: [string, number, number, number, number][] = [
    ["d", 0.0188, 4400, 0.263, 0.04],
    ["b", 0.0229, 4550, 0.299, 0.03],
    ["c", 0.0274, 4700, 0.335, 0.08],
    ["e", 0.0381, 4000, 0.193, 0.04],
  ];
  for (const [i, [suffix, au, radius, mass, ecc]] of barnardPlanets.entries()) {
    const p = makePlanet("BarnardsStar" + suffix, "Barnard " + suffix, barnard.id, "rocky", au);
    p.radiusKm = radius;
    p.massEarths = mass;
    p.orbit.eccentricity = ecc;
    p.rotation.tidallyLocked = true;
    p.rotation.tilt = 0;
    p.surface = surface(700 + i, ["#242831", "#514451", "#a0735b", "#d4a482"]);
    neighbors[0].bodies.push(p);
  }
  const tauPlanets: [string, number, number, number, number][] = [
    ["g", 0.133, 7450, 1.75, 0.06],
    ["h", 0.243, 7550, 1.83, 0.23],
    ["f", 1.334, 11400, 3.93, 0.16],
  ];
  for (const [i, [suffix, au, radius, mass, ecc]] of tauPlanets.entries()) {
    const p = makePlanet("TauCeti" + suffix, "Tau Ceti " + suffix, tau.id, "rocky", au);
    p.radiusKm = radius;
    p.massEarths = mass;
    p.orbit.eccentricity = ecc;
    p.rotation.tidallyLocked = i < 2;
    p.rotation.tilt = 0;
    p.atmosphere.enabled = i === 2;
    p.surface.seed = 320 + i;
    neighbors[1].bodies.push(p);
  }
  return {
    version: 1,
    id: "OrbitFoundry",
    name: "The neighboring stars",
    author: "Orbit Foundry",
    description: "An original procedural interstellar collection for Kitten Space Agency.",
    seed: 42,
    galacticPlane: { rightAscension: 192.86, declination: 27.13 },
    interstellarGas: 0.1,
    systems: [sol, ...neighbors],
    exportResolution: 128,
  };
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
const validColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value);
const validText = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      code === 0 ||
      (code < 32 && ![9, 10, 13].includes(code)) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      return false;
  }
  return true;
};

/** Count persisted source fields across the collection, including disabled and duplicated types. */
export function importedProjectBytes(project: unknown): number {
  if (!record(project) || !Array.isArray(project.systems)) return 0;
  let bytes = 0;
  for (const system of project.systems) {
    if (!record(system) || !Array.isArray(system.bodies)) continue;
    for (const body of system.bodies) {
      if (!record(body) || !Array.isArray(body.clutter)) continue;
      for (const type of body.clutter) {
        if (!record(type) || !record(type.importedAsset)) continue;
        const asset = type.importedAsset;
        if (record(asset.geometry))
          for (const value of Object.values(asset.geometry))
            if (typeof value === "string") bytes += value.length;
        if (Array.isArray(asset.materials))
          for (const material of asset.materials)
            if (record(material))
              for (const key of ["diffuse", "normal", "orm", "opacity"])
                if (typeof material[key] === "string") bytes += (material[key] as string).length;
      }
    }
  }
  return bytes;
}

export function importedProjectBudgetError(project: unknown): string | undefined {
  if (importedProjectBytes(project) > IMPORTED_LIMITS.projectBytes)
    return "Imported model data exceeds the 96 MB project budget. Remove duplicate imported types or use smaller textures.";
}

/** Validate imported data and live edits without trusting nested object shapes. */
export function validateProject(project: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (message: string, bodyId?: string) =>
    issues.push({ severity: "error", message, ...(bodyId ? { bodyId } : {}) });
  const root: unknown = project;
  if (!record(root)) {
    add("Project must be a JSON object.");
    return issues;
  }
  if (root.version !== 1) add("This is not an Orbit Foundry project (version 1).");
  if (!validId(root.id))
    add("Mod ID must begin with a letter and contain only letters, numbers, or underscores.");
  if (!validText(root.name) || !root.name.trim())
    add("Project name is required and must contain valid XML text.");
  if (!validText(root.author)) add("Project author must be valid text.");
  if (!validText(root.description)) add("Project description must be valid text.");
  if (!finite(root.seed)) add("Project seed must be a finite number.");
  if (!finite(root.interstellarGas) || root.interstellarGas < 0)
    add("Interstellar gas density must be a finite nonnegative number.");
  if (![32, 64, 128, 256, 512].includes(root.exportResolution as number))
    add("Export resolution must be 32, 64, 128, 256, or 512.");
  const numberField = (
    owner: Record<string, unknown>,
    key: string,
    label: string,
    bodyId?: string,
    rule?: (n: number) => boolean,
    ruleText = "must be finite",
  ) => {
    const value = owner[key];
    if (!finite(value) || (rule && !rule(value))) add(`${label} ${ruleText}.`, bodyId);
  };
  const textField = (
    owner: Record<string, unknown>,
    key: string,
    label: string,
    bodyId?: string,
  ) => {
    if (!validText(owner[key])) add(`${label} must be valid text.`, bodyId);
  };
  const colorField = (
    owner: Record<string, unknown>,
    key: string,
    label: string,
    bodyId?: string,
  ) => {
    if (!validColor(owner[key])) add(`${label} must be a #RGB or #RRGGBB color.`, bodyId);
  };
  const booleanField = (
    owner: Record<string, unknown>,
    key: string,
    label: string,
    bodyId?: string,
  ) => {
    if (typeof owner[key] !== "boolean") add(`${label} must be true or false.`, bodyId);
  };
  const vector = (value: unknown, label: string, bodyId?: string, nonnegative = false) => {
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value.some((v) => !finite(v) || (nonnegative && v < 0))
    ) {
      add(
        `${label} must contain three finite ${nonnegative ? "nonnegative " : ""}numbers.`,
        bodyId,
      );
    }
  };
  const positive = (n: number) => n > 0;
  const nonnegative = (n: number) => n >= 0;
  const unit = (n: number) => n >= 0 && n <= 1;
  const orbitFields = (
    value: unknown,
    label: string,
    bodyId: string | undefined,
    orbitRequired: boolean,
  ) => {
    if (!record(value)) {
      add(`${label} orbit settings are missing.`, bodyId);
      return;
    }
    numberField(
      value,
      "semiMajorAxisAu",
      `${label} orbital distance`,
      bodyId,
      orbitRequired ? positive : undefined,
      orbitRequired ? "must be positive and finite" : "must be finite",
    );
    numberField(
      value,
      "eccentricity",
      `${label} eccentricity`,
      bodyId,
      (n) => n >= 0 && n < 1,
      "must be between 0 and 1",
    );
    for (const key of [
      "inclination",
      "ascendingNode",
      "argumentOfPeriapsis",
      "timeAtPeriapsisDays",
    ])
      numberField(value, key, `${label} ${key}`, bodyId);
    numberField(
      value,
      "centralMassSuns",
      `${label} central mass`,
      bodyId,
      nonnegative,
      "must be finite and nonnegative",
    );
    if (!["Ecliptic", "Equatorial"].includes(value.definitionFrame as string))
      add(`${label} orbit frame must be Ecliptic or Equatorial.`, bodyId);
    booleanField(value, "twoBody", `${label} two-body flag`, bodyId);
    booleanField(value, "barycentric", `${label} barycentric flag`, bodyId);
  };
  const rotationFields = (value: unknown, label: string, bodyId: string | undefined) => {
    if (!record(value)) {
      add(`${label} rotation settings are missing.`, bodyId);
      return;
    }
    numberField(
      value,
      "periodHours",
      `${label} rotation period`,
      bodyId,
      positive,
      "must be positive and finite",
    );
    for (const key of ["tilt", "azimuth", "initialLongitude"])
      numberField(value, key, `${label} ${key}`, bodyId);
    if (!["Perifocal", "Ecliptic", "Equatorial"].includes(value.definitionFrame as string))
      add(`${label} rotation frame is invalid.`, bodyId);
    booleanField(value, "tidallyLocked", `${label} tidal lock`, bodyId);
    booleanField(value, "retrograde", `${label} retrograde flag`, bodyId);
  };
  const surfaceFields = (value: unknown, label: string, bodyId: string | undefined) => {
    if (!record(value)) {
      add(`${label} surface settings are missing.`, bodyId);
      return;
    }
    numberField(value, "seed", `${label} surface seed`, bodyId);
    numberField(
      value,
      "scale",
      `${label} surface scale`,
      bodyId,
      positive,
      "must be positive and finite",
    );
    numberField(
      value,
      "octaves",
      `${label} surface octaves`,
      bodyId,
      (n) => Number.isInteger(n) && n >= 1 && n <= 9,
      "must be an integer from 1 to 9",
    );
    numberField(
      value,
      "persistence",
      `${label} persistence`,
      bodyId,
      unit,
      "must be between 0 and 1",
    );
    numberField(
      value,
      "lacunarity",
      `${label} lacunarity`,
      bodyId,
      positive,
      "must be positive and finite",
    );
    for (const key of [
      "warp",
      "elevation",
      "craterDensity",
      "craterSize",
      "bandFrequency",
      "stormStrength",
    ])
      numberField(
        value,
        key,
        `${label} ${key}`,
        bodyId,
        nonnegative,
        "must be finite and nonnegative",
      );
    numberField(value, "seaLevel", `${label} sea level`, bodyId, unit, "must be between 0 and 1");
    numberField(value, "roughness", `${label} roughness`, bodyId, unit, "must be between 0 and 1");
    if (!Array.isArray(value.colors) || value.colors.length < 2)
      add(`${label} surface needs at least two color stops.`, bodyId);
    else
      value.colors.forEach((stop: unknown, index: number) => {
        if (!record(stop)) {
          add(`${label} color stop ${index + 1} is invalid.`, bodyId);
          return;
        }
        numberField(
          stop,
          "at",
          `${label} color stop ${index + 1} position`,
          bodyId,
          unit,
          "must be between 0 and 1",
        );
        colorField(stop, "color", `${label} color stop ${index + 1}`, bodyId);
      });
    if (!Array.isArray(value.occurrences)) add(`${label} occurrences must be a list.`, bodyId);
    else
      value.occurrences.forEach((occurrence: unknown, index: number) => {
        if (!record(occurrence)) {
          add(`${label} occurrence ${index + 1} is invalid.`, bodyId);
          return;
        }
        if (!validId(occurrence.id)) add(`${label} occurrence ${index + 1} ID is invalid.`, bodyId);
        textField(occurrence, "name", `${label} occurrence ${index + 1} name`, bodyId);
        colorField(occurrence, "color", `${label} occurrence ${index + 1} color`, bodyId);
        numberField(
          occurrence,
          "coverage",
          `${label} occurrence ${index + 1} coverage`,
          bodyId,
          unit,
          "must be between 0 and 1",
        );
        numberField(
          occurrence,
          "scale",
          `${label} occurrence ${index + 1} scale`,
          bodyId,
          positive,
          "must be positive and finite",
        );
        for (const key of ["minHeight", "maxHeight", "minLatitude", "maxLatitude"])
          numberField(occurrence, key, `${label} occurrence ${index + 1} ${key}`, bodyId);
        if (
          finite(occurrence.minHeight) &&
          finite(occurrence.maxHeight) &&
          occurrence.minHeight > occurrence.maxHeight
        )
          add(`${label} occurrence ${index + 1} height range is reversed.`, bodyId);
        if (
          finite(occurrence.minLatitude) &&
          finite(occurrence.maxLatitude) &&
          occurrence.minLatitude > occurrence.maxLatitude
        )
          add(`${label} occurrence ${index + 1} latitude range is reversed.`, bodyId);
      });
  };
  const atmosphereFields = (value: unknown, label: string, bodyId: string | undefined) => {
    if (!record(value)) {
      add(`${label} atmosphere settings are missing.`, bodyId);
      return;
    }
    booleanField(value, "enabled", `${label} atmosphere enabled`, bodyId);
    for (const key of [
      "heightKm",
      "temperatureK",
      "molarMass",
      "adiabaticIndex",
      "rayleighHeightKm",
      "mieHeightKm",
    ])
      numberField(
        value,
        key,
        `${label} atmosphere ${key}`,
        bodyId,
        positive,
        "must be positive and finite",
      );
    for (const key of ["pressureKpa", "density", "intensity"])
      numberField(
        value,
        key,
        `${label} atmosphere ${key}`,
        bodyId,
        nonnegative,
        "must be finite and nonnegative",
      );
    numberField(
      value,
      "mieAnisotropy",
      `${label} atmosphere anisotropy`,
      bodyId,
      (n) => n > -1 && n < 1,
      "must be strictly between -1 and 1",
    );
    colorField(value, "color", `${label} atmosphere color`, bodyId);
    for (const key of ["rayleigh", "mie", "absorption"])
      vector(value[key], `${label} atmosphere ${key}`, bodyId, true);
  };
  const oceanFields = (
    value: unknown,
    label: string,
    bodyId: string | undefined,
    kind: unknown,
    radiusKm: unknown,
  ) => {
    if (!record(value)) {
      add(`${label} ocean settings are missing.`, bodyId);
      return;
    }
    booleanField(value, "enabled", `${label} ocean enabled`, bodyId);
    numberField(value, "levelKm", `${label} ocean level`, bodyId);
    numberField(
      value,
      "transparencyDepthM",
      `${label} ocean transparency depth`,
      bodyId,
      positive,
      "must be positive and finite",
    );
    colorField(value, "color", `${label} ocean color`, bodyId);
    if (value.enabled === true) {
      if (kind !== "rocky") add(`${label}: oceans can only be enabled on rocky bodies.`, bodyId);
      if (finite(radiusKm) && finite(value.levelKm) && radiusKm + value.levelKm <= 0)
        add(`${label}: ocean level must keep the ocean radius positive.`, bodyId);
    }
    const wind = value.windWaves;
    if (!record(wind)) add(`${label} ocean wind-wave settings are missing.`, bodyId);
    else {
      for (const key of [
        "minWindSpeed",
        "maxWindSpeed",
        "minWindFetchKm",
        "maxWindFetchKm",
        "depthM",
      ])
        numberField(
          wind,
          key,
          `${label} ocean ${key}`,
          bodyId,
          positive,
          "must be positive and finite",
        );
      for (const key of ["directionality", "foamAmount"])
        numberField(wind, key, `${label} ocean ${key}`, bodyId, unit, "must be between 0 and 1");
      if (
        finite(wind.minWindSpeed) &&
        finite(wind.maxWindSpeed) &&
        wind.minWindSpeed > wind.maxWindSpeed
      )
        add(`${label}: ocean minimum wind speed must not exceed maximum wind speed.`, bodyId);
      if (
        finite(wind.minWindFetchKm) &&
        finite(wind.maxWindFetchKm) &&
        wind.minWindFetchKm > wind.maxWindFetchKm
      )
        add(`${label}: ocean minimum wind fetch must not exceed maximum wind fetch.`, bodyId);
    }
    const waves = value.gerstnerWaves;
    if (!record(waves)) add(`${label} ocean Gerstner-wave settings are missing.`, bodyId);
    else {
      numberField(
        waves,
        "count",
        `${label} ocean wave count`,
        bodyId,
        (n) => Number.isInteger(n) && n >= 0 && n <= 64,
        "must be an integer from 0 to 64",
      );
      for (const key of [
        "lengthM",
        "lengthPersistence",
        "amplitudePersistence",
        "speedPersistence",
      ])
        numberField(
          waves,
          key,
          `${label} ocean ${key}`,
          bodyId,
          positive,
          "must be positive and finite",
        );
      numberField(
        waves,
        "amplitude",
        `${label} ocean wave amplitude`,
        bodyId,
        unit,
        "must be between 0 and 1",
      );
      numberField(
        waves,
        "speed",
        `${label} ocean wave speed`,
        bodyId,
        nonnegative,
        "must be finite and nonnegative",
      );
    }
  };
  const ringFields = (value: unknown, label: string, bodyId: string | undefined) => {
    if (!record(value)) {
      add(`${label} ring settings are missing.`, bodyId);
      return;
    }
    booleanField(value, "enabled", `${label} rings enabled`, bodyId);
    for (const key of ["innerRadius", "outerRadius", "seed", "bands", "thickness"])
      numberField(value, key, `${label} rings ${key}`, bodyId);
    numberField(value, "opacity", `${label} ring opacity`, bodyId, unit, "must be between 0 and 1");
    colorField(value, "color", `${label} ring color`, bodyId);
    colorField(value, "secondaryColor", `${label} ring secondary color`, bodyId);
    if (
      value.enabled === true &&
      (!finite(value.innerRadius) ||
        value.innerRadius <= 1 ||
        !finite(value.outerRadius) ||
        value.outerRadius <= value.innerRadius ||
        !finite(value.thickness) ||
        value.thickness <= 0 ||
        !finite(value.bands) ||
        value.bands < 1)
    )
      add(
        `${label}: rings must start above the surface, have a larger outer radius, and positive bands and thickness.`,
        bodyId,
      );
  };
  if (!record(root.galacticPlane)) add("Galactic plane settings are missing.");
  else {
    numberField(root.galacticPlane, "rightAscension", "Galactic right ascension");
    numberField(root.galacticPlane, "declination", "Galactic declination");
  }
  const importedBudgetError = importedProjectBudgetError(root);
  if (importedBudgetError) add(importedBudgetError);
  if (!Array.isArray(root.systems) || root.systems.length === 0) {
    add("Add at least one star system.");
    return issues;
  }

  const systemIds = new Set<string>();
  const bodyIds = new Set<string>();
  let homeCount = 0;
  let oceanCount = 0;
  for (const [systemIndex, rawSystem] of root.systems.entries()) {
    if (!record(rawSystem)) {
      add(`Star system ${systemIndex + 1} is invalid.`);
      continue;
    }
    const label =
      typeof rawSystem.name === "string" && rawSystem.name.trim()
        ? rawSystem.name
        : `Star system ${systemIndex + 1}`;
    if (!validId(rawSystem.id))
      add(`${label}: system ID must use letters, numbers, and underscores.`);
    else if (systemIds.has(rawSystem.id.toLowerCase())) add(`Duplicate system ID: ${rawSystem.id}`);
    else systemIds.add(rawSystem.id.toLowerCase());
    if (!validText(rawSystem.name) || !rawSystem.name.trim())
      add(`${label}: system name is required and must contain valid XML text.`);
    textField(rawSystem, "description", `${label} description`);
    vector(rawSystem.position, `${label} position`);
    if (!Array.isArray(rawSystem.bodies)) {
      add(`${label}: bodies must be a list.`);
      continue;
    }
    const byId = new Map<string, Record<string, unknown>>();
    let rootCount = 0,
      starCount = 0;
    for (const [bodyIndex, rawBody] of rawSystem.bodies.entries()) {
      if (!record(rawBody)) {
        add(`${label}: body ${bodyIndex + 1} is invalid.`);
        continue;
      }
      const bodyId = typeof rawBody.id === "string" ? rawBody.id : undefined;
      const bodyLabel =
        typeof rawBody.name === "string" && rawBody.name.trim()
          ? rawBody.name
          : `Body ${bodyIndex + 1}`;
      if (!validId(rawBody.id))
        add(
          `${bodyLabel}: body ID must begin with a letter and use only letters, numbers, and underscores.`,
          bodyId,
        );
      else {
        if (bodyIds.has(rawBody.id.toLowerCase())) add(`Duplicate body ID: ${rawBody.id}`, bodyId);
        bodyIds.add(rawBody.id.toLowerCase());
        byId.set(rawBody.id, rawBody);
      }
      if (!validText(rawBody.name) || !rawBody.name.trim())
        add(`${bodyLabel}: body name is required and must contain valid XML text.`, bodyId);
      if (!["star", "barycenter", "rocky", "gas"].includes(rawBody.kind as string)) {
        add(`${bodyLabel}: body kind is invalid.`, bodyId);
        continue;
      }
      if (rawBody.parentId !== null && (typeof rawBody.parentId !== "string" || !rawBody.parentId))
        add(`${bodyLabel}: parent ID must be a body ID or null.`, bodyId);
      if (rawBody.parentId === null) rootCount++;
      if (rawBody.kind === "star") starCount++;
      orbitFields(
        rawBody.orbit,
        bodyLabel,
        bodyId,
        typeof rawBody.parentId === "string" && rawBody.parentId.length > 0,
      );
      if (rawBody.kind === "barycenter") {
        if (rawBody.parentId !== null)
          add(`${bodyLabel}: barycenter must be a system root.`, bodyId);
        vector(rawBody.position, `${bodyLabel} position offset`, bodyId);
      } else if (rawBody.kind === "star") {
        numberField(
          rawBody,
          "radiusKm",
          `${bodyLabel} radius`,
          bodyId,
          positive,
          "must be positive and finite",
        );
        numberField(
          rawBody,
          "massSuns",
          `${bodyLabel} mass`,
          bodyId,
          positive,
          "must be positive and finite",
        );
        numberField(
          rawBody,
          "sphereOfInfluenceAu",
          `${bodyLabel} sphere of influence`,
          bodyId,
          nonnegative,
          "must be finite and nonnegative",
        );
        colorField(rawBody, "color", `${bodyLabel} color`, bodyId);
        vector(rawBody.sunlight, `${bodyLabel} sunlight`, bodyId, true);
        vector(rawBody.position, `${bodyLabel} position offset`, bodyId);
      } else {
        if (rawBody.parentId === null) add(`${bodyLabel}: planet needs a parent.`, bodyId);
        numberField(
          rawBody,
          "radiusKm",
          `${bodyLabel} radius`,
          bodyId,
          positive,
          "must be positive and finite",
        );
        numberField(
          rawBody,
          "massEarths",
          `${bodyLabel} mass`,
          bodyId,
          positive,
          "must be positive and finite",
        );
        numberField(
          rawBody,
          "sphereOfInfluenceAu",
          `${bodyLabel} sphere of influence`,
          bodyId,
          nonnegative,
          "must be finite and nonnegative",
        );
        booleanField(rawBody, "homeBody", `${bodyLabel} home-body flag`, bodyId);
        if (rawBody.homeBody === true) {
          if (rawBody.kind === "rocky") homeCount++;
          else add(`${bodyLabel}: the home body must be rocky.`, bodyId);
        }
        rotationFields(rawBody.rotation, bodyLabel, bodyId);
        surfaceFields(rawBody.surface, bodyLabel, bodyId);
        atmosphereFields(rawBody.atmosphere, bodyLabel, bodyId);
        oceanFields(rawBody.ocean, bodyLabel, bodyId, rawBody.kind, rawBody.radiusKm);
        if (rawBody.kind === "rocky" && record(rawBody.ocean) && rawBody.ocean.enabled === true)
          oceanCount++;
        ringFields(rawBody.rings, bodyLabel, bodyId);
        issues.push(...validateFidelity(rawBody, bodyLabel, bodyId));
      }
    }
    if (rootCount === 0) add(`${label}: add a root star or barycenter.`);
    if (starCount === 0) add(`${label} needs a star.`);
    for (const body of byId.values()) {
      const bodyId = body.id as string;
      const parentId = body.parentId;
      if (typeof parentId === "string" && !byId.has(parentId))
        add(`${body.name}: parent ${parentId} must be in the same star system.`, bodyId);
      const seen = new Set([bodyId]);
      let cursor: unknown = parentId;
      while (typeof cursor === "string" && byId.has(cursor)) {
        if (seen.has(cursor)) {
          add(`${body.name}: circular parent hierarchy.`, bodyId);
          break;
        }
        seen.add(cursor);
        cursor = byId.get(cursor)?.parentId;
      }
      if (body.kind === "barycenter") {
        const contributingStars = [...byId.values()].filter(
          (child) =>
            child.kind === "star" &&
            child.parentId === bodyId &&
            record(child.orbit) &&
            child.orbit.barycentric === true &&
            finite(child.massSuns) &&
            child.massSuns > 0,
        );
        if (contributingStars.length === 0)
          add(
            `${body.name}: barycenter needs an immediate barycentric child star with positive mass.`,
            bodyId,
          );
      }
    }
  }
  if (homeCount !== 1) add("Choose exactly one rocky home body in Physical settings.");
  if (oceanCount === 0)
    issues.push({
      severity: "warning",
      message:
        "The exported system needs at least one enabled ocean on a rocky body. KSA build 2026.10.10.5554 crashes at startup without an ocean. One ocean anywhere in this collection covers all star-system tabs.",
    });
  return issues;
}

export function parseProject(text: string): Project {
  if (text.length > 128 * 1024 * 1024)
    throw new Error(
      "Project file exceeds the 128 MB browser import limit. Use smaller imported textures or fewer duplicate types.",
    );
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Project file is not valid JSON.");
  }
  // Older version 1 projects predate ocean authoring. Preserve their content;
  // only an absent field is migrated, while explicit malformed settings fail validation.
  if (record(value) && value.version === 1 && Array.isArray(value.systems)) {
    for (const system of value.systems) {
      if (!record(system) || !Array.isArray(system.bodies)) continue;
      for (const body of system.bodies) {
        if (!record(body) || (body.kind !== "rocky" && body.kind !== "gas")) continue;
        if (!("ocean" in body)) body.ocean = ocean();
        if (!("clouds" in body)) body.clouds = clouds("rocky", 1);
        if (!("landmarks" in body)) body.landmarks = [];
        if (!("environmentAudio" in body)) body.environmentAudio = environmentAudio();
        if (!("exportResolution" in body)) body.exportResolution = 0;
        if (record(body.surface)) {
          if (!("biomes" in body.surface))
            body.surface.biomes = [
              defaultBiome("Surface", finite(body.surface.seed) ? body.surface.seed : 1),
            ];
          for (const [key, fallback] of Object.entries({
            biomeBlendStrength: 2,
            detailFadeStartM: 3000,
            detailFadeEndM: 500,
          }))
            if (!(key in body.surface)) body.surface[key] = fallback;
        }
        if (record(body.atmosphere)) {
          const a = body.atmosphere;
          const fallbacks = {
            startHeightKm: 0,
            ozoneAltitudeKm: finite(a.heightKm) ? a.heightKm * 0.25 : 20,
            ozoneExtentKm: finite(a.heightKm) ? a.heightKm * 0.5 : 40,
            mieAbsorptionMultiplier: 1.111111,
            mieAnisotropyRgb: [a.mieAnisotropy, a.mieAnisotropy, a.mieAnisotropy],
          };
          for (const [key, fallback] of Object.entries(fallbacks))
            if (!(key in a)) a[key] = fallback;
        }
        if (record(body.clutter)) {
          const c = body.clutter;
          if (
            Object.keys(c).every((key) =>
              ["enabled", "density", "scale", "seed", "color"].includes(key),
            ) &&
            typeof c.enabled === "boolean" &&
            finite(c.density) &&
            c.density >= 0 &&
            c.density <= 1 &&
            finite(c.scale) &&
            c.scale > 0 &&
            finite(c.seed) &&
            validColor(c.color)
          ) {
            const migrated = defaultClutter("Rocks", c.seed, c.color);
            migrated.enabled = c.enabled;
            migrated.distribution.density = c.density;
            migrated.distribution.objectSeparationM = 50 / Math.max(0.01, c.density);
            migrated.distribution.minScale = [c.scale * 0.5, c.scale * 0.5, c.scale * 0.5];
            migrated.distribution.maxScale = [c.scale * 1.5, c.scale * 1.5, c.scale * 1.5];
            body.clutter = [migrated];
          }
        }
      }
    }
  }
  const issues = validateProject(value).filter((issue) => issue.severity === "error");
  if (issues.length)
    throw new Error(
      `Invalid Orbit Foundry project:\n${issues
        .slice(0, 8)
        .map((issue) => `• ${issue.message}`)
        .join("\n")}${issues.length > 8 ? `\n• …and ${issues.length - 8} more issues` : ""}`,
    );
  return value as Project;
}

/** Clone editable settings while sharing immutable imported mesh/texture sources with undo history. */
export function cloneProjectForEdit(project: Project): Project {
  const stripped = {
    ...project,
    systems: project.systems.map((system) => ({
      ...system,
      bodies: system.bodies.map((body) =>
        isPlanet(body)
          ? {
              ...body,
              clutter: body.clutter.map(({ importedAsset: _source, ...editable }) => editable),
            }
          : body,
      ),
    })),
  };
  const result: Project = structuredClone(stripped);
  project.systems.forEach((system, si) =>
    system.bodies.forEach((body, bi) => {
      const copy = result.systems[si].bodies[bi];
      if (isPlanet(body) && isPlanet(copy))
        body.clutter.forEach((type, ci) => {
          if (type.importedAsset) copy.clutter[ci].importedAsset = type.importedAsset;
        });
    }),
  );
  return result;
}

export function descendants(id: string, bodies: Celestial[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    result.push(next);
    for (const body of bodies) if (body.parentId === next) stack.push(body.id);
  }
  return result;
}
