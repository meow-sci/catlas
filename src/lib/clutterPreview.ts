import {
  authorToNativeDirection,
  compileSurfaceSampler,
  nativeLocationDirection,
  nativeToAuthorDirection,
} from "./procedural";
import {
  clamp01,
  generateClutterPixels,
  sampleAltitudeDensity,
  sampleBiomeWeights,
} from "./surface";
import type { ClutterType, Planet, Vec3 } from "./types";

export interface ClutterPatchOptions {
  sizeM: number;
  latitude: number;
  longitude: number;
  maxInstances?: number;
}
export interface ClutterPatchInstance {
  position: Vec3;
  normal: Vec3;
  scale: Vec3;
  rotationDeg: number;
}
export interface ClutterPatchPreview {
  instances: ClutterPatchInstance[];
  ground: { positions: Float32Array; indices: Uint32Array; colors: Float32Array };
  eligibleEstimate: number;
  candidateEstimate: number;
  capped: boolean;
  samplesEvaluated: number;
  samplingCapped: boolean;
  sizeM: number;
  altitudeRangeM: [number, number];
  biomeNames: string[];
}

/** Begin near the first authored site, outside its native no-clutter clearance. */
export function defaultClutterPatchLocation(body: Planet) {
  const site = body.landmarks.find((value) => value.enabled);
  if (!site) return { latitude: 0, longitude: 0 };
  if (site.category !== "landmark" || !site.launchPad)
    return { latitude: site.latitude, longitude: site.longitude };
  const clearanceM = Math.min(site.sizeM[1], site.sizeM[2]) / 2 + 50,
    distance = Math.min(Math.PI / 2, (clearanceM + 150) / Math.max(1, body.radiusKm * 1000)),
    latitude = (site.latitude * Math.PI) / 180,
    longitude = (site.longitude * Math.PI) / 180;
  // Great-circle destination at an easterly bearing, including polar sites.
  return {
    latitude: (Math.asin(Math.sin(latitude) * Math.cos(distance)) * 180) / Math.PI,
    longitude:
      ((((longitude + Math.atan2(Math.sin(distance), Math.cos(latitude) * Math.cos(distance))) *
        180) /
        Math.PI +
        540) %
        360) -
      180,
  };
}

const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value) || 1;
  return value.map((axis) => axis / length) as Vec3;
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fract = (value: number) => value - Math.floor(value);
const linearColor = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
function hash(value: string) {
  let state = 2166136261;
  for (let i = 0; i < value.length; i++) state = Math.imul(state ^ value.charCodeAt(i), 16777619);
  return state | 0;
}
function randomGenerator(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function cubeUv(direction: Vec3): [number, number] {
  const [x, y, z] = direction,
    ax = Math.abs(x),
    ay = Math.abs(y),
    az = Math.abs(z);
  if (ax >= ay && ax >= az) return [0.5 + (x >= 0 ? -z : z) / (2 * ax), 0.5 - y / (2 * ax)];
  if (ay >= az) return [0.5 + x / (2 * ay), 0.5 + (y >= 0 ? z : -z) / (2 * ay)];
  return [0.5 + (z >= 0 ? x : -x) / (2 * az), 0.5 - y / (2 * az)];
}

function distributionSample(pixels: Uint8Array, size: number, u: number, v: number) {
  const x = fract(u) * size - 0.5,
    y = fract(v) * size - 0.5,
    ix = Math.floor(x),
    iy = Math.floor(y),
    tx = x - ix,
    ty = y - iy;
  const sample = (column: number, row: number) =>
    pixels[(((row + size) % size) * size + ((column + size) % size)) * 4] / 255;
  return (
    (sample(ix, iy) * (1 - tx) + sample(ix + 1, iy) * tx) * (1 - ty) +
    (sample(ix, iy + 1) * (1 - tx) + sample(ix + 1, iy + 1) * tx) * ty
  );
}

/**
 * A physical, approximate placement study, not an exact game GPU cell replay.
 * Ground samples use the shared authored height field at 33² points. Candidate
 * evaluation is stratified at <=4096 sites; geometry is an unbiased reservoir of
 * <=256 surviving samples by default, or up to 4096 for dense ground cover.
 * Estimates stay independent of both draw/sample caps.
 * Native Generate.comp shares a random value for distribution/biome masks;
 * FinalizeGenerate.comp shares another for slope/altitude/yaw. Their combined
 * survival probability is min(distribution,biome)*max(0,altitude+slopeMask-1).
 * Native textureNoTile random tile rotation/jitter, GPU mesh LOD snapping and
 * exact global cube-cell hashing are approximated by periodic bitmap sampling.
 */
export function sampleClutterPatch(
  body: Planet,
  type: ClutterType,
  options: ClutterPatchOptions,
): ClutterPatchPreview {
  if (body.kind !== "rocky") throw new Error("Clutter patches require rocky terrain");
  if (
    !Number.isFinite(options.sizeM) ||
    options.sizeM <= 0 ||
    !Number.isFinite(options.latitude) ||
    !Number.isFinite(options.longitude)
  )
    throw new Error("Clutter patches need a positive physical size and finite coordinates");
  if (
    !Number.isFinite(type.distribution.objectSeparationM) ||
    type.distribution.objectSeparationM <= 0
  )
    throw new Error("Clutter separation must be positive");
  const sizeM = options.sizeM,
    radiusM = Math.max(1, body.radiusKm * 1000),
    half = sizeM / 2,
    gridSide = 33,
    step = sizeM / (gridSide - 1);
  const latitude = Math.max(-90, Math.min(90, options.latitude)),
    longitude = options.longitude,
    lat = (latitude * Math.PI) / 180,
    lon = (longitude * Math.PI) / 180;
  const up = normalize(nativeToAuthorDirection(nativeLocationDirection(latitude, longitude))),
    east = nativeToAuthorDirection([-Math.sin(lon), Math.cos(lon), 0]),
    south = nativeToAuthorDirection([
      Math.sin(lat) * Math.cos(lon),
      Math.sin(lat) * Math.sin(lon),
      -Math.cos(lat),
    ]);
  const directionAt = (x: number, z: number): Vec3 =>
    normalize(
      up.map(
        (axis, index) => axis + (east[index] * x) / radiusM + (south[index] * z) / radiusM,
      ) as Vec3,
    );
  const sample = compileSurfaceSampler(body),
    centerHeightM = (sample(up).height - body.surface.seaLevel) * body.surface.elevation * 1000;
  const positions = new Float32Array(gridSide * gridSide * 3),
    colors = new Float32Array(positions.length),
    heights = new Float64Array(gridSide * gridSide),
    normalizedHeights = new Float64Array(heights.length),
    altitude = new Float64Array(heights.length),
    indices = new Uint32Array((gridSide - 1) ** 2 * 6),
    names = new Set<string>();
  let minimumAltitude = Infinity,
    maximumAltitude = -Infinity;
  for (let row = 0; row < gridSide; row++)
    for (let column = 0; column < gridSide; column++) {
      const x = column * step - half,
        z = row * step - half,
        direction = directionAt(x, z),
        value = sample(direction),
        at = row * gridSide + column;
      altitude[at] = (value.height - body.surface.seaLevel) * body.surface.elevation * 1000;
      normalizedHeights[at] = value.height;
      heights[at] = dot(direction, up) * (radiusM + altitude[at]) - (radiusM + centerHeightM);
      positions.set([x, heights[at], z], at * 3);
      colors.set(value.color.map(linearColor), at * 3);
      minimumAltitude = Math.min(minimumAltitude, altitude[at]);
      maximumAltitude = Math.max(maximumAltitude, altitude[at]);
      const biomes = sampleBiomeWeights(body, direction, value.height);
      biomes.indices.forEach((index, channel) => {
        if (biomes.weights[channel] > 0.001 && body.surface.biomes[index])
          names.add(body.surface.biomes[index].name);
      });
    }
  for (let row = 0; row < gridSide - 1; row++)
    for (let column = 0; column < gridSide - 1; column++) {
      const a = row * gridSide + column,
        c = a + gridSide,
        at = (row * (gridSide - 1) + column) * 6;
      indices.set([a, c, a + 1, a + 1, c, c + 1], at);
    }
  const ground = { positions, colors, indices },
    empty: ClutterPatchPreview = {
      instances: [],
      ground,
      eligibleEstimate: 0,
      candidateEstimate: 0,
      capped: false,
      samplesEvaluated: 0,
      samplingCapped: false,
      sizeM,
      altitudeRangeM: [minimumAltitude, maximumAltitude],
      biomeNames: [...names],
    };
  if (!type.enabled) return empty;
  const interpolate = (values: Float64Array, x: number, z: number) => {
    const px = Math.max(0, Math.min(gridSide - 1, (x + half) / step)),
      py = Math.max(0, Math.min(gridSide - 1, (z + half) / step)),
      x0 = Math.floor(px),
      y0 = Math.floor(py),
      x1 = Math.min(gridSide - 1, x0 + 1),
      y1 = Math.min(gridSide - 1, y0 + 1),
      tx = px - x0,
      ty = py - y0;
    return (
      (values[y0 * gridSide + x0] * (1 - tx) + values[y0 * gridSide + x1] * tx) * (1 - ty) +
      (values[y1 * gridSide + x0] * (1 - tx) + values[y1 * gridSide + x1] * tx) * ty
    );
  };
  const candidateSide = Math.max(1, Math.ceil(sizeM / type.distribution.objectSeparationM)),
    candidateEstimate = Math.min(
      Number.MAX_SAFE_INTEGER,
      (sizeM / type.distribution.objectSeparationM) ** 2,
    ),
    sampleSide = Math.min(64, candidateSide),
    sampleCount = sampleSide ** 2,
    cellSize = sizeM / sampleSide,
    occupancy = Math.min(1, candidateEstimate / sampleCount);
  const maxInstances = Math.max(0, Math.min(4096, Math.floor(options.maxInstances ?? 256))),
    d = type.distribution,
    random = randomGenerator(hash(`${body.id}:${type.id}:${latitude}:${longitude}`) ^ (d.seed | 0)),
    reservoirRandom = randomGenerator(hash(`${type.id}:reservoir`) ^ (d.seed | 0));
  if (d.density <= 0) return { ...empty, candidateEstimate };
  const distribution = generateClutterPixels(type, 64).distribution,
    biomeIds = new Set(d.biomeIds),
    instances: ClutterPatchInstance[] = [];
  const exclusions = body.landmarks
    .filter((site) => site.enabled && site.category === "landmark" && site.launchPad)
    .slice(0, 4)
    .map((site) => ({
      direction: nativeToAuthorDirection(nativeLocationDirection(site.latitude, site.longitude)),
      radiusM: Math.min(site.sizeM[1], site.sizeM[2]) / 2 + 50,
    }));
  let expectedSum = 0,
    survivingSamples = 0;
  for (let row = 0; row < sampleSide; row++)
    for (let column = 0; column < sampleSide; column++) {
      const x = (column + 0.1 + random() * 0.8) * cellSize - half,
        z = (row + 0.1 + random() * 0.8) * cellSize - half,
        distributionRandom = random(),
        scaleRandom = random(),
        rotationRandom = random(),
        occupancyRandom = random();
      const direction = directionAt(x, z),
        heightM = interpolate(altitude, x, z),
        localY = interpolate(heights, x, z);
      if (
        Math.hypot(x, z) > d.generationRangeM ||
        (body.ocean.enabled && heightM <= body.ocean.levelKm * 1000)
      )
        continue;
      if (
        exclusions.some(
          (site) =>
            Math.hypot(...direction.map((axis, index) => axis - site.direction[index])) * radiusM <
            site.radiusM,
        )
      )
        continue;
      const delta = Math.max(0.01, step / 2),
        x0 = Math.max(-half, x - delta),
        x1 = Math.min(half, x + delta),
        z0 = Math.max(-half, z - delta),
        z1 = Math.min(half, z + delta);
      const normal = normalize([
        -(interpolate(heights, x1, z) - interpolate(heights, x0, z)) / (x1 - x0),
        1,
        -(interpolate(heights, x, z1) - interpolate(heights, x, z0)) / (z1 - z0),
      ]);
      const radial: Vec3 = [dot(direction, east), dot(direction, up), dot(direction, south)],
        baseSlope = clamp01(dot(normal, radial));
      const slopeMask = clamp01(
          ((d.slopeMaskStrength <= 0 ? 1 : baseSlope ** d.slopeMaskStrength) - d.slopeMaskBias) *
            d.slopeMaskContrast +
            d.slopeMaskBias,
        ),
        altitudeMask = sampleAltitudeDensity(type, heightM);
      const normalizedHeight = interpolate(normalizedHeights, x, z),
        biomes = sampleBiomeWeights(body, direction, normalizedHeight);
      let biomeWeight = biomeIds.size ? 0 : 1;
      if (biomeIds.size)
        biomes.indices.forEach((index, channel) => {
          if (biomeIds.has(body.surface.biomes[index]?.id)) biomeWeight += biomes.weights[channel];
        });
      const uv = cubeUv(authorToNativeDirection(direction)),
        placementMask = Math.min(
          distributionSample(distribution, 64, uv[0] * d.textureTiling, uv[1] * d.textureTiling),
          clamp01(biomeWeight),
        );
      expectedSum += placementMask * Math.max(0, altitudeMask + slopeMask - 1);
      if (
        occupancyRandom >= occupancy ||
        distributionRandom > placementMask ||
        rotationRandom < 1 - slopeMask ||
        rotationRandom >= altitudeMask
      )
        continue;
      const scaleT = Math.min(15, Math.floor(scaleRandom * 16)) / 15,
        orientationNormal = d.orientation === "Up" ? normalize(radial) : normal;
      const rotationDeg =
        d.orientation === "SurfaceNormalAndGradient"
          ? (Math.atan2(normal[0], normal[2]) * 180) / Math.PI
          : d.minRotationDeg + rotationRandom * (d.maxRotationDeg - d.minRotationDeg);
      const instance: ClutterPatchInstance = {
        position: [x, localY, z],
        normal: orientationNormal,
        scale: d.minScale.map((min, axis) => min + (d.maxScale[axis] - min) * scaleT) as Vec3,
        rotationDeg,
      };
      survivingSamples++;
      if (instances.length < maxInstances) instances.push(instance);
      else {
        const slot = Math.floor(reservoirRandom() * survivingSamples);
        if (slot < maxInstances) instances[slot] = instance;
      }
    }
  const eligibleEstimate = (expectedSum / sampleCount) * candidateEstimate;
  return {
    ...empty,
    instances,
    candidateEstimate,
    eligibleEstimate,
    samplesEvaluated: sampleCount,
    samplingCapped: candidateEstimate > sampleCount,
    capped: eligibleEstimate > maxInstances || survivingSamples > maxInstances,
  };
}
