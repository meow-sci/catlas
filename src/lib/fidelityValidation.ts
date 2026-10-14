import type { ValidationIssue } from "./types";
import { STOCK_ASSETS } from "./stock-assets";
import { validateImportedAsset } from "./imported-clutter";

type Dict = Record<string, unknown>;
const object = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v);
const color = (v: unknown) => typeof v === "string" && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(v);
const text = (v: unknown) =>
  typeof v === "string" &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(v);

/** Strict checks for all fidelity data; import migration only fills absent fields. */
export function validateFidelity(body: Dict, label: string, bodyId?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (message: string) =>
    issues.push({
      severity: "error",
      message: `${label}: ${message}.`,
      ...(bodyId ? { bodyId } : {}),
    });
  const record = (v: unknown, name: string): Dict => {
    if (!object(v)) {
      fail(`${name} settings are missing or malformed`);
      return {};
    }
    return v;
  };
  const num = (
    o: Dict,
    key: string,
    name: string,
    min = -Infinity,
    max = Infinity,
    integer = false,
  ) => {
    const v = o[key];
    if (!finite(v) || v < min || v > max || (integer && !Number.isInteger(v)))
      fail(`${name} ${key} must be ${integer ? "an integer" : "finite"} between ${min} and ${max}`);
  };
  const bool = (o: Dict, key: string, name: string) => {
    if (typeof o[key] !== "boolean") fail(`${name} ${key} must be true or false`);
  };
  const density = (o: Dict, name: string) => {
    const v = o.density;
    if (!finite(v) || v < 0 || v > 1) {
      const actual =
        typeof v === "number" || typeof v === "boolean"
          ? String(v)
          : typeof v === "string"
            ? JSON.stringify(v.slice(0, 80))
            : v === undefined
              ? "missing"
              : v === null
                ? "null"
                : "invalid value";
      fail(`${name} must be a finite number between 0 and 1 (current value: ${actual})`);
    }
  };
  const str = (o: Dict, key: string, name: string) => {
    if (!text(o[key])) fail(`${name} ${key} must be valid text`);
  };
  const col = (o: Dict, key: string, name: string) => {
    if (!color(o[key])) fail(`${name} ${key} must be a hex color`);
  };
  const vec = (o: Dict, key: string, name: string, min = -Infinity, max = Infinity) => {
    const v = o[key];
    if (!Array.isArray(v) || v.length !== 3 || v.some((n) => !finite(n) || n < min || n > max))
      fail(`${name} ${key} must have three finite components in range`);
  };
  const one = (o: Dict, key: string, values: string[], name: string) => {
    if (!values.includes(o[key] as string)) fail(`${name} ${key} is invalid`);
  };
  const list = (v: unknown, name: string, min = 0, max = 128): Dict[] => {
    if (!Array.isArray(v) || v.length < min || v.length > max) {
      fail(`${name} must contain ${min} to ${max} entries`);
      return [];
    }
    return v.map((v, i) => record(v, `${name} ${i + 1}`));
  };
  const ids = (v: Dict[], name: string) => {
    const seen = new Set();
    for (const o of v) {
      const nativeId = typeof o.id === "string" ? o.id.toLowerCase() : o.id;
      if (!id(o.id) || seen.has(nativeId))
        fail(`${name} IDs must be valid and unique (case-insensitive)`);
      seen.add(nativeId);
    }
  };
  const range = (o: Dict, a: string, b: string, name: string) => {
    if (finite(o[a]) && finite(o[b]) && o[a] > o[b]) fail(`${name} ${a}/${b} range is reversed`);
  };
  const surface = record(body.surface, "surface");
  num(surface, "biomeBlendStrength", "surface", 0.01, 100);
  num(surface, "detailFadeStartM", "surface", 0, 1e9);
  num(surface, "detailFadeEndM", "surface", 0, 1e9);
  if (
    finite(surface.detailFadeStartM) &&
    finite(surface.detailFadeEndM) &&
    surface.detailFadeStartM <= surface.detailFadeEndM
  )
    fail("terrain detail fade start must be greater than fade end");
  const biomes = list(surface.biomes, "biomes", 1, 32);
  ids(biomes, "biome");
  const material = (v: unknown, name: string) => {
    const m = record(v, name);
    one(m, "pattern", ["regolith", "sand", "basalt", "ice", "soil"], name);
    col(m, "color", name);
    col(m, "secondaryColor", name);
    for (const key of ["seed", "heightDeformityM"]) num(m, key, name);
    for (const key of ["textureTiling", "heightTiling"]) num(m, key, name, 0.000001, 1e6);
    for (const key of ["diffuseScale", "normalScale", "displacementScale", "detailStrength"])
      num(m, key, name, 0, 100);
    for (const key of ["roughness", "metalness"]) num(m, key, name, 0, 1);
  };
  for (const [i, b] of biomes.entries()) {
    const n = `biome ${i + 1}`;
    str(b, "name", n);
    col(b, "color", n);
    num(b, "seed", n);
    num(b, "coverage", n, 0, 1);
    num(b, "scale", n, 0.0001, 1e6);
    for (const key of ["minHeight", "maxHeight"]) num(b, key, n, 0, 1);
    for (const key of ["minLatitude", "maxLatitude"]) num(b, key, n, -90, 90);
    range(b, "minHeight", "maxHeight", n);
    range(b, "minLatitude", "maxLatitude", n);
    num(b, "slopeBlendStrength", n, 0, 100);
    num(b, "slopeBlendContrast", n, 0, 100);
    num(b, "slopeBlendBias", n, -100, 100);
    material(b.ground, `${n} ground`);
    material(b.slope, `${n} slope`);
  }
  const clutter = list(body.clutter, "clutter types", 0, 64);
  ids(clutter, "clutter");
  for (const [i, c] of clutter.entries()) {
    const name =
      text(c.name) && typeof c.name === "string" && c.name.trim()
        ? c.name.trim()
        : id(c.id)
          ? String(c.id)
          : null;
    const n = name ? `clutter “${name}”` : `clutter entry ${i + 1}`;
    str(c, "name", n);
    if ("importedAsset" in c) {
      const error = validateImportedAsset(c.importedAsset);
      if (error) fail(`${n} imported model: ${error}`);
      if ("stockAssetId" in c) fail(`${n} cannot use imported and stock geometry together`);
    }
    if (
      "stockAssetId" in c &&
      (typeof c.stockAssetId !== "string" ||
        !STOCK_ASSETS.some((asset) => asset.id === c.stockAssetId))
    )
      fail(`${n} stockAssetId must name a bundled stock model`);
    bool(c, "enabled", n);
    if (c.enabled === true && body.kind !== "rocky")
      fail("enabled ground clutter requires a rocky body");
    num(c, "seed", n);
    const g = record(c.geometry, `${n} geometry`);
    one(g, "shape", ["boulder", "pebble", "crystal", "grass", "shrub", "spire"], n);
    vec(g, "dimensionsM", n, 0.001, 100000);
    num(g, "detail", n, 0, 4, true);
    num(g, "irregularity", n, 0, 1);
    const m = record(c.material, `${n} material`);
    col(m, "color", n);
    col(m, "secondaryColor", n);
    for (const k of ["roughness", "metalness"]) num(m, k, n, 0, 1);
    num(m, "normalStrength", n, 0, 10);
    for (const k of ["opacity", "doubleSided", "useTerrainMask"]) bool(m, k, n);
    const d = record(c.distribution, `${n} distribution`);
    num(d, "seed", n);
    density(d, `${n} distribution density`);
    for (const k of [
      "patchScale",
      "patchContrast",
      "objectSeparationM",
      "generationRangeM",
      "textureTiling",
    ])
      num(d, k, n, 0.0001, 1e7);
    vec(d, "minScale", n, 0.001, 1e4);
    vec(d, "maxScale", n, 0.001, 1e4);
    if (
      Array.isArray(d.minScale) &&
      Array.isArray(d.maxScale) &&
      d.minScale.some(
        (v, i) =>
          finite(v) && finite((d.maxScale as unknown[])[i]) && v > (d.maxScale as number[])[i],
      )
    )
      fail(`${n} scale range is reversed`);
    one(
      d,
      "orientation",
      ["Up", "SurfaceNormal", "SurfaceNormalAndGradient", "SurfaceNormalSmooth"],
      n,
    );
    num(d, "minRotationDeg", n);
    num(d, "maxRotationDeg", n);
    range(d, "minRotationDeg", "maxRotationDeg", n);
    for (const k of ["slopeMaskStrength", "slopeMaskContrast"]) num(d, k, n, 0, 100);
    num(d, "slopeMaskBias", n, -100, 100);
    if (!Array.isArray(d.biomeIds) || d.biomeIds.some((b) => !biomes.some((x) => x.id === b)))
      fail(`${n} biome memberships must name this body's biomes`);
    const points = list(d.altitudeDensity, `${n} altitude density`, 0, 32);
    for (const [index, p] of points.entries()) {
      const point = `${n} altitude density point ${index + 1}`;
      num(p, "altitudeM", point);
      density(p, `${point}${finite(p.altitudeM) ? ` at ${p.altitudeM} m` : ""}`);
    }
    if (
      points.some(
        (p, i) =>
          i > 0 &&
          finite(p.altitudeM) &&
          finite(points[i - 1].altitudeM) &&
          p.altitudeM <= (points[i - 1].altitudeM as number),
      )
    )
      fail(`${n} altitude curve must be strictly increasing`);
  }
  if (
    body.kind === "rocky" &&
    finite(body.radiusKm) &&
    finite(surface.seaLevel) &&
    finite(surface.elevation) &&
    body.radiusKm <= surface.seaLevel * surface.elevation
  )
    fail("minimum terrain height must keep the body's radius positive");
  const a = record(body.atmosphere, "atmosphere");
  for (const k of ["startHeightKm", "ozoneAltitudeKm"]) num(a, k, "atmosphere");
  if (finite(body.radiusKm) && finite(a.startHeightKm) && body.radiusKm + a.startHeightKm <= 0)
    fail("atmosphere start height must keep its radius positive");
  num(a, "ozoneExtentKm", "atmosphere", 0.00001);
  num(a, "mieAbsorptionMultiplier", "atmosphere", 0);
  vec(a, "mieAnisotropyRgb", "atmosphere", -0.999, 0.999);
  if (
    a.enabled === true &&
    finite(a.intensity) &&
    Array.isArray(a.rayleigh) &&
    a.rayleigh.every(finite) &&
    Array.isArray(a.mie) &&
    a.mie.every(finite) &&
    finite(a.rayleighHeightKm) &&
    finite(a.mieHeightKm)
  ) {
    const rayleighBoundary =
      -a.rayleighHeightKm * Math.log(1e-7 / (Math.max(...a.rayleigh) * a.intensity));
    const mieBoundary = -a.mieHeightKm * Math.log(1e-7 / (Math.max(...a.mie) * a.intensity));
    const extent = Math.max(rayleighBoundary, mieBoundary);
    if (!Number.isFinite(extent) || extent <= 0)
      fail(
        "enabled atmosphere coefficients and strength must produce a finite positive native optical boundary",
      );
  }
  const clouds = record(body.clouds, "clouds");
  bool(clouds, "enabled", "clouds");
  for (const k of [
    "orbitTransitionStartKm",
    "orbitTransitionEndKm",
    "maxShadowsAltitudeKm",
    "flickerReductionKm",
  ])
    num(clouds, k, "clouds", 0);
  if (
    finite(clouds.orbitTransitionStartKm) &&
    finite(clouds.orbitTransitionEndKm) &&
    clouds.orbitTransitionEndKm <= clouds.orbitTransitionStartKm
  )
    fail("cloud transition end must be greater than transition start");
  const layers = list(clouds.layers, "cloud layers", 0, 8);
  ids(layers, "cloud layer");
  if (clouds.enabled === true && (a.enabled !== true || !layers.some((l) => l.enabled === true)))
    fail("enabled clouds require an atmosphere and an enabled layer");
  const curve = (v: unknown, n: string) => {
    const p = list(v, n, 2, 16);
    for (const q of p) {
      num(q, "key", n, 0, 1);
      num(q, "value", n);
      num(q, "inTangent", n);
      num(q, "outTangent", n);
    }
    if (
      p.some(
        (q, i) =>
          i > 0 && finite(q.key) && finite(p[i - 1].key) && q.key <= (p[i - 1].key as number),
      )
    )
      fail(`${n} keys must be strictly increasing`);
  };
  for (const [i, l] of layers.entries()) {
    const n = `cloud layer ${i + 1}`;
    str(l, "name", n);
    bool(l, "enabled", n);
    num(l, "seed", n);
    one(l, "pattern", ["billowed", "wispy", "banded"], n);
    for (const k of ["coverage", "opacity", "lambertian"]) num(l, k, n, 0, 1);
    for (const k of ["scale", "contrast", "detailSizeKm"]) num(l, k, n, 0.00001);
    num(l, "noiseScrollSpeed", n);
    col(l, "color", n);
    vec(l, "rotationSpeed", n);
    bool(l, "matchGroundColor", n);
    bool(l, "useAlphaOnly", n);
    const f = record(l.flow, `${n} flow`);
    bool(f, "enabled", n);
    num(f, "strength", n, 0);
    num(f, "displacementKm", n, 0);
    num(f, "loopHours", n, 0.00001);
    const r = record(l.raymarching, `${n} raymarching`);
    for (const k of ["stepScale", "stepSizeKm", "maxStepSizeKm", "lightDistanceKm"])
      num(r, k, n, 0.000001);
    num(r, "lightSamples", n, 1, 64, true);
    range(r, "stepSizeKm", "maxStepSizeKm", n);
    const types = list(l.types, `${n} types`, 1, 8);
    for (const t of types) {
      str(t, "name", n);
      num(t, "startAltitudeKm", n);
      if (
        finite(body.radiusKm) &&
        finite(t.startAltitudeKm) &&
        body.radiusKm + t.startAltitudeKm <= 0
      )
        fail(`${n} cloud base must keep its radius positive`);
      for (const k of ["heightKm", "noiseScaleKm"]) num(t, k, n, 0.00001);
      num(t, "edgeSharpness", n, 0, 1);
      num(t, "density", n, 0);
      num(t, "multipleScatteringBrightness", n, 0);
      bool(t, "interpolateShapes", n);
      curve(t.shapeCurve, `${n} shape curve`);
      curve(t.densityCurve, `${n} density curve`);
    }
  }
  const audio = record(body.environmentAudio, "environment audio");
  bool(audio, "enabled", "environment audio");
  num(audio, "seed", "environment audio");
  for (const key of ["volume", "wind", "rumble", "tones"])
    num(audio, key, "environment audio", 0, 1);
  num(audio, "loopSeconds", "environment audio", 4, 30);
  if (audio.enabled === true && body.kind !== "rocky")
    fail("native environment audio requires a rocky body's biome maps");
  if (
    audio.enabled === true &&
    (a.enabled !== true || (finite(a.pressureKpa) && a.pressureKpa < 1.01325))
  )
    issues.push({
      severity: "warning",
      message: `${label}: native environment audio is silent below 0.01 atmospheres of camera pressure; enable a sufficiently dense atmosphere to hear it.`,
      bodyId,
    });
  const sites = list(body.landmarks, "landmarks", 0, 64);
  ids(sites, "landmark");
  for (const s of sites) {
    str(s, "name", "landmark");
    bool(s, "enabled", "landmark");
    bool(s, "launchPad", "landmark");
    num(s, "latitude", "landmark", -89.999, 89.999);
    num(s, "longitude", "landmark", -180, 180);
    num(s, "groundOffsetM", "landmark", -1000, 1e5);
    vec(s, "sizeM", "landmark", 1, 100000);
    col(s, "color", "landmark");
    one(s, "category", ["landmark", "city", "crater", "mountain"], "landmark");
    if (body.kind !== "rocky" && s.enabled === true) fail("landmarks require a rocky body");
    if (s.launchPad === true && s.category !== "landmark")
      fail("launch pads must use landmark category");
  }
  const activeSites = sites.filter((s) => s.enabled === true);
  const locationNames = new Set<string>();
  for (const s of activeSites) {
    if (typeof s.name !== "string" || !s.name.trim())
      fail("enabled location names must not be empty");
    else {
      const nativeName = s.name.toLowerCase();
      if (locationNames.has(nativeName))
        fail("enabled location names must be unique (case-insensitive)");
      locationNames.add(nativeName);
    }
  }
  if (activeSites.length && !activeSites.some((s) => s.category === "landmark"))
    issues.push({
      severity: "warning",
      message: `${label}: add a landmark to this body's named locations; the native launch menu expects at least one Landmark destination.`,
      bodyId,
    });
  if (activeSites.filter((s) => s.launchPad === true).length > 4)
    issues.push({
      severity: "warning",
      message: `${label}: native clutter exclusion only covers the first four launch pads.`,
      bodyId,
    });

  if (![0, 32, 64, 128, 256, 512].includes(body.exportResolution as number))
    fail("body export resolution must be inherited (0) or 32, 64, 128, 256, 512");
  return issues;
}
