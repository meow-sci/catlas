/** Deterministic, direction based planet painting shared by preview and export. */
import { sampleBiomeWeights } from "./surface";
import type { TerrainBiome } from "./types";
export type Vec3 = readonly [number, number, number];
export type RGB = [number, number, number];

/** Authoring/Three uses a +Y pole; native KSA surface locations use a +Z pole. */
export const nativeToAuthorDirection = (direction: Vec3): [number, number, number] => [
  direction[0],
  direction[2],
  -direction[1],
];
export const authorToNativeDirection = (direction: Vec3): [number, number, number] => [
  direction[0],
  -direction[2],
  direction[1],
];
export function nativeLocationDirection(
  latitudeDeg: number,
  longitudeDeg: number,
): [number, number, number] {
  const latitude = (latitudeDeg * Math.PI) / 180,
    longitude = (longitudeDeg * Math.PI) / 180;
  return [
    Math.cos(latitude) * Math.cos(longitude),
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude),
  ];
}

export interface ProceduralBody {
  id: string;
  kind: "rocky" | "gas";
  surface: {
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
    biomes?: TerrainBiome[];
    colors: { at: number; color: string }[];
    occurrences?: {
      id: string;
      name: string;
      color: string;
      coverage: number;
      scale: number;
      minHeight: number;
      maxHeight: number;
      minLatitude: number;
      maxLatitude: number;
    }[];
  };
}

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const fract = (x: number) => x - Math.floor(x);

export function parseColor(value: string): RGB {
  const hex = value.replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return [0.5, 0.5, 0.5];
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255) as RGB;
}

export function mixColor(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hash(x: number, y: number, z: number, seed: number): number {
  let n =
    Math.imul(x, 374761393) +
    Math.imul(y, 668265263) +
    Math.imul(z, 1442695041) +
    Math.imul(seed | 0, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const u = smooth(fract(x)),
    v = smooth(fract(y)),
    w = smooth(fract(z));
  let total = 0;
  for (let dz = 0; dz <= 1; dz++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const weight = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
        total += hash(ix + dx, iy + dy, iz + dz, seed) * weight;
      }
  return total;
}

function fbm(
  p: Vec3,
  seed: number,
  scale: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
): number {
  let frequency = Math.max(0.25, scale),
    amplitude = 1,
    sum = 0,
    divisor = 0;
  for (let i = 0; i < Math.max(1, Math.min(9, Math.round(octaves))); i++) {
    sum +=
      amplitude * noise3(p[0] * frequency, p[1] * frequency, p[2] * frequency, seed + i * 7919);
    divisor += amplitude;
    amplitude *= clamp(persistence, 0.05, 0.95);
    frequency *= clamp(lacunarity, 1.1, 4);
  }
  return sum / divisor;
}

function preparedPalette(stops: { at: number; color: string }[]) {
  const sorted = [...(stops ?? [])]
    .sort((a, b) => a.at - b.at)
    .map((stop) => ({ at: stop.at, color: parseColor(stop.color) }));
  return (t: number): RGB => {
    if (!sorted.length) return [0.55, 0.5, 0.43];
    if (t <= sorted[0].at) return sorted[0].color;
    for (let i = 1; i < sorted.length; i++) {
      if (t <= sorted[i].at) {
        const fraction = smooth(
          clamp((t - sorted[i - 1].at) / Math.max(1e-6, sorted[i].at - sorted[i - 1].at)),
        );
        return mixColor(sorted[i - 1].color, sorted[i].color, fraction);
      }
    }
    return sorted[sorted.length - 1].color;
  };
}

const craterCache = new Map<string, { centre: Vec3; width: number }[]>();
function craterSignal(p: Vec3, seed: number, density: number, size: number): number {
  const count = Math.min(160, Math.round(Math.max(0, density) * 75));
  if (!count) return 0;
  const key = `${seed}:${count}:${size}`;
  let craters = craterCache.get(key);
  if (!craters) {
    craters = [];
    for (let i = 0; i < count; i++) {
      const azimuth = hash(i, 31, 17, seed) * Math.PI * 2;
      const height = hash(i, 53, 11, seed) * 2 - 1;
      const radius = Math.sqrt(1 - height * height);
      craters.push({
        centre: [Math.cos(azimuth) * radius, height, Math.sin(azimuth) * radius],
        width: Math.max(0.004, size * (0.55 + 0.55 * hash(i, 71, 13, seed))),
      });
    }
    craterCache.set(key, craters);
  }
  let signal = 0;
  for (const { centre, width } of craters) {
    const cosine = p[0] * centre[0] + p[1] * centre[1] + p[2] * centre[2];
    if (cosine < 1 - width * width * 1.1) continue;
    const r = Math.sqrt(Math.max(0, 2 * (1 - cosine))) / width;
    if (r < 1.45) {
      const bowl = -Math.exp(-r * r * 5);
      const rim = 0.48 * Math.exp(-(((r - 0.95) / 0.19) ** 2));
      signal += (bowl + rim) * 0.12;
    }
  }
  return signal;
}

export interface SurfaceSample {
  height: number;
  color: RGB;
  biome: number;
}

/** Compile immutable authoring arrays once for an entire preview/export operation. */
export function compileSurfaceSampler(body: ProceduralBody): (direction: Vec3) => SurfaceSample {
  const palette = preparedPalette(body.surface.colors);
  const occurrences = (body.surface.occurrences ?? []).map((occurrence) => ({
    ...occurrence,
    parsedColor: parseColor(occurrence.color),
    offset: hashString(occurrence.id),
  }));
  const biomeColors = (body.surface.biomes ?? []).map((biome) => parseColor(biome.color));
  return (direction: Vec3) => samplePrepared(body, direction, palette, occurrences, biomeColors);
}

const samplerCache = new WeakMap<
  ProceduralBody,
  {
    colors: ProceduralBody["surface"]["colors"];
    occurrences: ProceduralBody["surface"]["occurrences"];
    biomes: TerrainBiome[] | undefined;
    sample: (direction: Vec3) => SurfaceSample;
  }
>();
export function sampleSurface(body: ProceduralBody, direction: Vec3): SurfaceSample {
  let cached = samplerCache.get(body);
  if (
    !cached ||
    cached.colors !== body.surface.colors ||
    cached.occurrences !== body.surface.occurrences ||
    cached.biomes !== body.surface.biomes
  ) {
    cached = {
      colors: body.surface.colors,
      occurrences: body.surface.occurrences,
      biomes: body.surface.biomes,
      sample: compileSurfaceSampler(body),
    };
    samplerCache.set(body, cached);
  }
  return cached.sample(direction);
}

function samplePrepared(
  body: ProceduralBody,
  direction: Vec3,
  palette: (t: number) => RGB,
  occurrences: (NonNullable<ProceduralBody["surface"]["occurrences"]>[number] & {
    parsedColor: RGB;
    offset: number;
  })[],
  biomeColors: RGB[],
): SurfaceSample {
  const s = body.surface;
  const len = Math.hypot(...direction) || 1;
  const p: Vec3 = [direction[0] / len, direction[1] / len, direction[2] / len];
  const warpAmount = clamp(s.warp, 0, 2) * 0.3;
  const warped: Vec3 = [
    p[0] + warpAmount * (noise3(p[0] * 3 + 7, p[1] * 3, p[2] * 3, s.seed + 23) - 0.5),
    p[1] + warpAmount * (noise3(p[0] * 3, p[1] * 3 + 9, p[2] * 3, s.seed + 29) - 0.5),
    p[2] + warpAmount * (noise3(p[0] * 3, p[1] * 3, p[2] * 3 + 11, s.seed + 31) - 0.5),
  ];
  const base = fbm(warped, s.seed, s.scale, s.octaves, s.persistence, s.lacunarity);
  if (body.kind === "gas") {
    const latitude = Math.asin(clamp(p[1], -1, 1));
    const frequency = Math.max(1, s.bandFrequency);
    const poleTaper = Math.cos(latitude) ** 2;
    // Band frequency counts broad alternating belts over the hemisphere. A
    // small, continuous 3D meander avoids stretching every noise cell into a
    // bright rectangular stripe. Fine turbulence stays subordinate to the jets.
    const meander =
      (fbm(p, s.seed + 47, 2.2, 3, 0.5, 2) - 0.5) * 0.075 * s.stormStrength * poleTaper;
    let cloudLatitude = latitude + meander;
    let vortexColor = 0;
    for (let i = 0; i < 3; i++) {
      const longitude = hash(i, 73, 29, s.seed) * Math.PI * 2;
      const centreLatitude =
        i === 0
          ? -0.32 + (hash(i, 37, 19, s.seed) - 0.5) * 0.12
          : (hash(i, 37, 19, s.seed) - 0.5) * 1.6;
      const cosLatitude = Math.cos(centreLatitude),
        sinLatitude = Math.sin(centreLatitude);
      const cosLongitude = Math.cos(longitude),
        sinLongitude = Math.sin(longitude);
      const centre: Vec3 = [cosLatitude * cosLongitude, sinLatitude, cosLatitude * sinLongitude];
      if (p[0] * centre[0] + p[1] * centre[1] + p[2] * centre[2] < 0.7) continue;
      const east = -p[0] * sinLongitude + p[2] * cosLongitude;
      const north =
        -p[0] * sinLatitude * cosLongitude + p[1] * cosLatitude - p[2] * sinLatitude * sinLongitude;
      const width = i === 0 ? 0.32 : 0.14 + hash(i, 43, 11, s.seed) * 0.08;
      const height = i === 0 ? 0.105 : 0.045 + hash(i, 11, 41, s.seed) * 0.035;
      const x = east / width,
        y = north / height,
        r2 = x * x + y * y;
      const envelope = Math.exp(-r2 * 1.1),
        angle = s.stormStrength * 3.2 * envelope;
      cloudLatitude += (east * Math.sin(angle) + north * (Math.cos(angle) - 1)) * envelope;
      const radius = Math.sqrt(r2),
        spiral = Math.sin(radius * 9 - Math.atan2(y, x) * 2);
      vortexColor += s.stormStrength * envelope * (0.11 + spiral * Math.min(1, radius * 2) * 0.045);
    }
    const phase = cloudLatitude * frequency;
    const bands = Math.sin(phase + Math.sin(phase * 0.37 + s.seed * 0.001) * 0.35);
    const fine = Math.sin(phase * 3.1 + meander * frequency * 0.4);
    const mottling = (fbm(p, s.seed + 97, Math.max(2, s.scale * 1.4), 3, 0.5, 2) - 0.5) * 0.045;
    const t = clamp(0.5 + bands * 0.255 + fine * 0.012 + mottling + vortexColor);
    return { height: 0.5, color: palette(t), biome: 0 };
  }
  const ridges =
    1 -
    Math.abs(
      2 * fbm(warped, s.seed + 17, s.scale * 2.1, s.octaves, s.persistence, s.lacunarity) - 1,
    );
  const crater = craterSignal(p, s.seed, s.craterDensity, s.craterSize);
  const relief = (base - 0.5) * 0.85 + (ridges - 0.5) * 0.27 + crater;
  // Elevation is in kilometres; the caller maps this normalized channel through
  // Height.Minimum/Maximum when writing the astronomical XML.
  const height = clamp(0.5 + relief * 0.85);
  const t = clamp(height + (fbm(warped, s.seed + 97, s.scale * 3, 3, 0.5, 2) - 0.5) * 0.18);
  let color = palette(t);
  const latitude = (Math.asin(p[1]) * 180) / Math.PI;
  for (const occurrence of occurrences) {
    if (
      height < occurrence.minHeight ||
      height > occurrence.maxHeight ||
      latitude < occurrence.minLatitude ||
      latitude > occurrence.maxLatitude
    )
      continue;
    const patch = fbm(warped, s.seed + occurrence.offset, occurrence.scale, 3, 0.5, 2);
    const coverage = clamp(occurrence.coverage);
    const strength = smooth(clamp((patch - (1 - coverage)) * 8));
    color = mixColor(color, occurrence.parsedColor, strength * 0.75);
  }
  const biomes = sampleBiomeWeights(body, p, height);
  if (biomeColors.length) {
    const blended: RGB = [0, 0, 0];
    biomes.indices.forEach((index, channel) => {
      for (let axis = 0; axis < 3; axis++)
        blended[axis] += biomeColors[index][axis] * biomes.weights[channel];
    });
    color = mixColor(color, blended, 0.4);
  }
  if (height < s.seaLevel) color = mixColor(color, palette(clamp(s.seaLevel * 0.55)), 0.5);
  return { height, color, biome: biomes.dominant };
}

export function sampleHeight(body: ProceduralBody, direction: Vec3): number {
  return sampleSurface(body, direction).height;
}

function hashString(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result | 0;
}
