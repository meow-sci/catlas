import { noise3, parseColor, sampleSurface } from "./procedural";
import type {
  AtmosphereSettings,
  CloudLayerSettings,
  CloudSettings,
  CloudTypeSettings,
  Planet,
  SplinePointSettings,
  Vec3,
} from "./types";

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / Math.max(1e-8, b - a));
  return t * t * (3 - 2 * t);
};
const point = (key: number, value: number): SplinePointSettings => ({
  key,
  value,
  inTangent: 0,
  outTangent: 0,
});

/** A complete native cloud type. Altitudes are km; native density is m^-1. */
export function cloudType(kind: "rocky" | "gas" = "rocky", high = true): CloudTypeSettings {
  const gas = kind === "gas";
  return {
    name: high ? "Cloud towers" : "Low deck",
    startAltitudeKm: gas ? (high ? 20 : 10) : high ? 1.5 : 1,
    heightKm: gas ? (high ? 90 : 35) : high ? 5 : 2,
    density: gas ? 0.00022 : 0.008,
    noiseScaleKm: gas ? 110 : 2.3,
    edgeSharpness: 0.96,
    multipleScatteringBrightness: 1,
    interpolateShapes: true,
    shapeCurve: [point(0, 0), point(0.08, 0.95), point(0.38, 1), point(0.8, 0.72), point(1, 0)],
    densityCurve: [point(0, 0.15), point(0.2, 1), point(0.7, 0.65), point(1, 0)],
  };
}

export function cloudLayer(
  kind: "rocky" | "gas" = "rocky",
  seed = 1,
  id = "deck_1",
): CloudLayerSettings {
  const gas = kind === "gas";
  return {
    id,
    enabled: true,
    name: gas ? "Banded weather deck" : "Water cloud deck",
    seed,
    pattern: gas ? "banded" : "billowed",
    coverage: gas ? 0.82 : 0.5,
    scale: gas ? 10 : 4,
    contrast: 1.3,
    color: "#ffffff",
    opacity: 0.9,
    rotationSpeed: [0, 0, gas ? 80 : 15],
    matchGroundColor: false,
    useAlphaOnly: !gas,
    lambertian: 0.65,
    detailSizeKm: gas ? 600 : 400,
    noiseScrollSpeed: gas ? 30 : 5,
    flow: {
      enabled: true,
      strength: gas ? 0.8 : 0.25,
      displacementKm: gas ? 1200 : 50,
      loopHours: 1,
    },
    raymarching: {
      stepScale: 0.00275,
      stepSizeKm: gas ? 10 : 0.1,
      maxStepSizeKm: gas ? 175 : 2,
      lightDistanceKm: gas ? 120 : 8,
      lightSamples: 6,
    },
    types: [cloudType(kind, true), cloudType(kind, false)],
  };
}

export function clouds(kind: "rocky" | "gas" = "rocky", seed = 1): CloudSettings {
  const gas = kind === "gas";
  return {
    enabled: gas,
    orbitTransitionStartKm: gas ? 5000 : 150,
    orbitTransitionEndKm: gas ? 9000 : 400,
    maxShadowsAltitudeKm: gas ? 9000 : 400,
    flickerReductionKm: gas ? 10000 : 100,
    layers: [cloudLayer(kind, seed)],
  };
}

/** KSA derives its visual boundary from the densest term at 1e-10 m^-1. */
export function nativeAtmosphereHeightKm(a: AtmosphereSettings): number {
  const term = (coefficients: Vec3, scaleHeight: number) => {
    const peak = Math.max(...coefficients) * a.intensity;
    return peak > 0 ? Math.max(0, -scaleHeight * Math.log(1e-7 / peak)) : 0;
  };
  return (
    a.startHeightKm + Math.max(term(a.rayleigh, a.rayleighHeightKm), term(a.mie, a.mieHeightKm))
  );
}

export function physicalScaleHeightKm(
  body: Pick<Planet, "radiusKm" | "massEarths" | "atmosphere">,
): number {
  const a = body.atmosphere;
  const gravity = (6.6743e-11 * body.massEarths * 5.9722e24) / (body.radiusKm * 1000) ** 2;
  return (8.314462618 * a.temperatureK) / ((a.molarMass / 1000) * gravity) / 1000;
}

/** Native cubic Hermite curve evaluation, useful for authoring and preview profiles. */
export function evaluateCloudCurve(points: SplinePointSettings[], key: number): number {
  if (!points.length) return 0;
  const sorted = [...points].sort((a, b) => a.key - b.key);
  if (key <= sorted[0].key) return sorted[0].value;
  if (key >= sorted[sorted.length - 1].key) return sorted[sorted.length - 1].value;
  const end = sorted.findIndex((p) => p.key >= key);
  const a = sorted[end - 1],
    b = sorted[end],
    span = b.key - a.key;
  const t = (key - a.key) / span,
    t2 = t * t,
    t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * a.value +
    (t3 - 2 * t2 + t) * span * a.outTangent +
    (-2 * t3 + 3 * t2) * b.value +
    (t3 - t2) * span * b.inTangent
  );
}

function fractal(x: number, y: number, z: number, seed: number, scale: number): number {
  let total = 0,
    weight = 1,
    sum = 0;
  for (let octave = 0; octave < 4; octave++) {
    total += noise3(x * scale, y * scale, z * scale, seed + octave * 173) * weight;
    sum += weight;
    weight *= 0.52;
    scale *= 2.1;
  }
  return total / sum;
}

export interface CloudSample {
  coverage: number;
  type: number;
  flow: [number, number];
  /** Color before the layer tint; RGB in authored sRGB. */
  color: Vec3;
}

/** One seeded, continuous sphere field drives both native channels and Three's preview. */
export function sampleCloud(
  body: Planet,
  layer: CloudLayerSettings,
  direction: readonly number[],
): CloudSample {
  const len = Math.hypot(...direction) || 1;
  const x = direction[0] / len,
    y = direction[1] / len,
    z = direction[2] / len;
  const scale = Math.max(0.05, layer.scale),
    seed = layer.seed;
  const broad = fractal(x, y, z, seed, scale);
  const warp = noise3(x * 2.7 + 11, y * 2.7, z * 2.7 - 7, seed + 37) - 0.5;
  const fine = fractal(x + warp * 0.15, y, z - warp * 0.1, seed + 71, scale * 3);
  let field = broad * 0.75 + fine * 0.25;
  if (layer.pattern === "wispy") {
    const streaks = fractal(x * 0.65 + warp * 0.5, y * 2.6, z * 0.65, seed + 29, scale * 2);
    field = 1 - Math.abs(streaks * 2 - 1);
    field = field * 0.75 + broad * 0.25 - 0.19;
  } else if (layer.pattern === "banded") {
    const latitude = Math.asin(clamp(y, -1, 1));
    const bands = Math.sin(latitude * scale * 3 + warp * 1.7 + fine * 0.7);
    field = 0.48 + bands * 0.16 + (broad - 0.5) * 0.55 + (fine - 0.5) * 0.23;
  }
  const contrasted = clamp(0.5 + (field - 0.5) * layer.contrast * 2.4);
  const threshold = 1 - layer.coverage;
  const coverage =
    layer.coverage <= 0
      ? 0
      : layer.coverage >= 1
        ? 1
        : smooth(threshold - 0.1, threshold + 0.1, contrasted);
  const type = clamp(1 - contrasted + (fine - 0.5) * 0.2);
  const jet =
    layer.pattern === "banded"
      ? Math.sin(Math.asin(clamp(y, -1, 1)) * scale * 3 + 0.5) * Math.sqrt(Math.max(0, 1 - y * y))
      : (broad - 0.5) * 1.5;
  const flow: [number, number] = [
    clamp(
      jet * layer.flow.strength * 0.42 + (fine - 0.5) * layer.flow.strength * 0.06,
      -0.49,
      0.49,
    ),
    clamp(
      (noise3(x * scale, y * scale, z * scale, seed + 109) - 0.5) * layer.flow.strength * 0.12,
      -0.49,
      0.49,
    ),
  ];
  const shade = 0.83 + contrasted * 0.17;
  const source = body.kind === "gas" ? sampleSurface(body, [x, y, z]).color : [1, 1, 1];
  return { coverage, type, flow, color: source.map((v) => v * shade) as Vec3 };
}

/** Native equirectangular convention: +Z north, positive atan2(y,x) east. */
export function nativeCloudDirection(u: number, v: number): Vec3 {
  const longitude = (u - 0.5) * Math.PI * 2,
    latitude = (0.5 - v) * Math.PI;
  // The continuous authoring field uses Three's +Y pole. The exported map uses KSA's +Z pole.
  return [
    Math.cos(latitude) * Math.cos(longitude),
    Math.sin(latitude),
    -Math.cos(latitude) * Math.sin(longitude),
  ];
}

export function cloudLayerBounds(layer: CloudLayerSettings): { bottomKm: number; topKm: number } {
  return {
    bottomKm: Math.min(...layer.types.map((t) => t.startAltitudeKm)),
    topKm: Math.max(...layer.types.map((t) => t.startAltitudeKm + t.heightKm)),
  };
}

/** Bake the same type/height interpolation used by native's 128x128 cloud shape LUT. */
export function compileCloudProfile(layer: CloudLayerSettings) {
  const bounds = cloudLayerBounds(layer),
    columns = 64,
    rows = 64;
  const shapes = new Float32Array(columns * rows),
    densities = new Float32Array(columns * rows);
  const opticalDepths = layer.types.map((type) => {
    let integral = 0;
    for (let i = 0; i < rows; i++)
      integral += clamp(evaluateCloudCurve(type.densityCurve, (i + 0.5) / rows));
    return ((type.density * type.heightKm * 1000 * integral) / rows) * layer.opacity;
  });
  for (let x = 0; x < columns; x++) {
    const raw = (x / (columns - 1)) * (layer.types.length - 1),
      i = Math.floor(raw),
      mix = raw - i;
    const a = layer.types[i],
      b = layer.types[Math.min(i + 1, layer.types.length - 1)];
    const base = a.startAltitudeKm * (1 - mix) + b.startAltitudeKm * mix;
    const top =
      (a.startAltitudeKm + a.heightKm) * (1 - mix) + (b.startAltitudeKm + b.heightKm) * mix;
    for (let y = 0; y < rows; y++) {
      const altitude = bounds.bottomKm + ((bounds.topKm - bounds.bottomKm) * y) / (rows - 1);
      const h = (altitude - base) / (top - base);
      const shape = (t: CloudTypeSettings) => {
        const fraction = t.interpolateShapes ? h : (altitude - t.startAltitudeKm) / t.heightKm;
        return fraction < 0 || fraction > 1 ? 0 : clamp(evaluateCloudCurve(t.shapeCurve, fraction));
      };
      const index = y * columns + x;
      shapes[index] = shape(a) * (1 - mix) + shape(b) * mix;
      densities[index] =
        h < 0 || h > 1
          ? 0
          : clamp(evaluateCloudCurve(a.densityCurve, h)) * (1 - mix) +
            clamp(evaluateCloudCurve(b.densityCurve, h)) * mix;
    }
  }
  return {
    opticalDepths,
    topAltitudeKm(coverage: number, type: number): number {
      const x = Math.round(clamp(type) * (columns - 1));
      for (let y = rows - 1; y >= 0; y--) {
        const at = y * columns + x;
        if (coverage + shapes[at] > 1 && densities[at] > 0.005) {
          return bounds.bottomKm + ((bounds.topKm - bounds.bottomKm) * y) / (rows - 1);
        }
      }
      return bounds.bottomKm;
    },
  };
}

export function cloudTint(layer: CloudLayerSettings): Vec3 {
  return parseColor(layer.color);
}
