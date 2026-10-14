import { noise3, parseColor, type Vec3 as Direction } from "./procedural";
import { getStockMesh, getStockPixels, STOCK_TEXTURE_SIZE } from "./stock-assets";
import {
  getImportedGeometry,
  getImportedMaterialPixels,
  importedMaterialSize,
} from "./imported-clutter";
import type { ClutterType, Planet, TerrainBiome, TerrainMaterialSettings, Vec3 } from "./types";

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
};
const normalize = (p: Direction): Vec3 => {
  const l = Math.hypot(...p) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
};
const cross = (a: Direction, b: Direction): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const subtract = (a: Direction, b: Direction): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function defaultTerrainMaterial(
  pattern: TerrainMaterialSettings["pattern"] = "regolith",
  seed = 1,
  color = "#8b8175",
): TerrainMaterialSettings {
  return {
    pattern,
    color,
    secondaryColor: "#554b42",
    seed,
    textureTiling: 0.04,
    heightTiling: 0.0000155,
    heightDeformityM: 0.3,
    diffuseScale: 0.7,
    normalScale: 1,
    displacementScale: 0.6,
    roughness: 0.86,
    metalness: 0,
    detailStrength: 0.6,
  };
}

export function defaultBiome(id = "surface", seed = 1, color = "#8b8175"): TerrainBiome {
  return {
    id,
    name: "Surface",
    color,
    seed,
    coverage: 1,
    scale: 4,
    minHeight: 0,
    maxHeight: 1,
    minLatitude: -90,
    maxLatitude: 90,
    ground: defaultTerrainMaterial("regolith", seed + 31, color),
    slope: {
      ...defaultTerrainMaterial("basalt", seed + 71, "#665d53"),
      normalScale: 1.4,
      detailStrength: 0.8,
    },
    slopeBlendStrength: 4,
    slopeBlendContrast: 1,
    slopeBlendBias: 0.0,
  };
}

export function defaultClutter(id = "rocks", seed = 1, color = "#8b8175"): ClutterType {
  return {
    id,
    name: "Boulders",
    enabled: true,
    seed,
    geometry: { shape: "boulder", dimensionsM: [2.5, 1.6, 2.1], detail: 1, irregularity: 0.3 },
    material: {
      color,
      secondaryColor: "#514940",
      roughness: 0.86,
      metalness: 0,
      normalStrength: 0.8,
      opacity: false,
      doubleSided: false,
      useTerrainMask: true,
    },
    distribution: {
      biomeIds: [],
      density: 0.35,
      seed: seed + 137,
      patchScale: 5,
      patchContrast: 1.7,
      objectSeparationM: 40,
      generationRangeM: 1600,
      textureTiling: 250,
      minScale: [0.4, 0.4, 0.4],
      maxScale: [1.7, 1.7, 1.7],
      orientation: "SurfaceNormal",
      minRotationDeg: 0,
      maxRotationDeg: 360,
      slopeMaskStrength: 2,
      slopeMaskContrast: 1,
      slopeMaskBias: 0,
      altitudeDensity: [
        { altitudeM: -5000, density: 1 },
        { altitudeM: 10000, density: 1 },
      ],
    },
  };
}

export interface BiomeWeights {
  indices: number[];
  weights: number[];
  dominant: number;
}

/** Native four-channel assignment. The first biome is the explicit fallback. */
export function sampleBiomeWeights(
  body: { surface: { biomes?: TerrainBiome[] } },
  direction: Direction,
  height = 0.5,
): BiomeWeights {
  const p = normalize(direction),
    latitude = (Math.asin(p[1]) * 180) / Math.PI;
  const biomes = body.surface.biomes;
  if (!biomes?.length) return { indices: [0, 0, 0, 0], weights: [1, 0, 0, 0], dominant: 0 };
  const candidates: { index: number; weight: number }[] = [];
  for (let index = 0; index < biomes.length; index++) {
    const biome = biomes[index];
    const heightEdge = Math.max(0.015, (biome.maxHeight - biome.minHeight) * 0.08);
    const latitudeEdge = Math.max(1, (biome.maxLatitude - biome.minLatitude) * 0.04);
    const h =
      smooth((height - biome.minHeight + heightEdge) / heightEdge) *
      smooth((biome.maxHeight - height + heightEdge) / heightEdge);
    const lat =
      smooth((latitude - biome.minLatitude + latitudeEdge) / latitudeEdge) *
      smooth((biome.maxLatitude - latitude + latitudeEdge) / latitudeEdge);
    const patch = noise3(
      p[0] * biome.scale + 3.7,
      p[1] * biome.scale - 2.1,
      p[2] * biome.scale + 8.3,
      biome.seed,
    );
    const weight = h * lat * smooth((patch - (1 - biome.coverage)) * 8);
    if (weight > 0) candidates.push({ index, weight });
  }
  // The first biome supplies uncovered terrain. Full regional coverage replaces
  // that fallback instead of permanently diluting every region to at most 50%.
  const base = candidates.find((entry) => entry.index === 0);
  if (base)
    base.weight *=
      1 -
      candidates.reduce((max, entry) => (entry.index === 0 ? max : Math.max(max, entry.weight)), 0);
  for (let index = candidates.length - 1; index >= 0; index--)
    if (candidates[index].weight <= 0) candidates.splice(index, 1);
  if (!candidates.length) candidates.push({ index: 0, weight: 1 });
  candidates.sort((a, b) => b.weight - a.weight || a.index - b.index);
  const top = candidates.slice(0, 4),
    total = top.reduce((sum, entry) => sum + entry.weight, 0);
  const indices = [0, 0, 0, 0],
    weights = [0, 0, 0, 0];
  if (biomes.length <= 4) {
    // Control maps are filtered separately from point-sampled ID maps. Stable
    // slots are essential: rank-sorting can blend a neighbor's weight into the
    // wrong biome at region boundaries.
    biomes.forEach((_, index) => {
      indices[index] = index;
    });
    top.forEach((entry) => {
      weights[entry.index] = entry.weight / total;
    });
  } else {
    top
      .sort((a, b) => a.index - b.index)
      .forEach((entry, channel) => {
        indices[channel] = entry.index;
        weights[channel] = entry.weight / total;
      });
  }
  return { indices, weights, dominant: candidates[0].index };
}

/** KSA does not decode raw IDs: uint(normalizedChannel * biomeCount + 0.4). */
export function encodeBiomeId(index: number, count: number): number {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 32 ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= count
  )
    throw new Error("Native biomes need 1–32 contiguous indices");
  return Math.round((index * 255) / count);
}

export function encodeBiomePixel(sample: BiomeWeights, count: number, blendStrength: number) {
  const ids = sample.indices.map((index) => encodeBiomeId(index, count));
  // Undo the native exponent so the desired weights survive the shader's pow.
  const controls = sample.weights.map((weight) =>
    Math.round(Math.pow(clamp01(weight), 1 / Math.max(0.001, blendStrength)) * 255),
  );
  return { ids, controls };
}

/** Periodic 2D field, built from original 3D noise on a torus. */
function tileNoise(u: number, v: number, frequency: number, seed: number): number {
  const a = u * Math.PI * 2,
    b = v * Math.PI * 2;
  return noise3(
    Math.cos(a) * frequency + 17,
    Math.sin(a) * frequency + Math.cos(b) * frequency * 0.65 + 23,
    Math.sin(b) * frequency + 31,
    seed,
  );
}

export type DetailPixels = {
  diffuse: Uint8Array;
  normal: Uint8Array;
  orm: Uint8Array;
  displacement: Uint8Array;
  height: Uint8Array;
};
export function generateTerrainPixels(
  material: TerrainMaterialSettings,
  size = 128,
  bakedNormalStrength = 1,
): DetailPixels {
  const heights = new Float32Array(size * size),
    first = parseColor(material.color),
    second = parseColor(material.secondaryColor);
  const result: DetailPixels = {
    diffuse: new Uint8Array(size * size * 4),
    normal: new Uint8Array(size * size * 4),
    orm: new Uint8Array(size * size * 4),
    displacement: new Uint8Array(size * size * 4),
    height: new Uint8Array(size * size * 4),
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size,
        coarse = tileNoise(u, v, 3.5, material.seed),
        fine = tileNoise(u, v, 19, material.seed + 31);
      let relief = coarse * 0.65 + fine * 0.35;
      if (material.pattern === "sand")
        relief =
          0.5 +
          Math.sin((u * 8 + Math.sin(v * Math.PI * 2) * 0.3) * Math.PI * 2) * 0.23 +
          (fine - 0.5) * 0.13;
      if (material.pattern === "basalt") relief = Math.pow(coarse, 0.65) * 0.72 + fine * 0.28;
      if (material.pattern === "ice") relief = Math.abs(coarse - 0.5) * 1.5 + fine * 0.2;
      if (material.pattern === "soil") relief = coarse * 0.4 + Math.pow(fine, 1.9) * 0.6;
      heights[y * size + x] = clamp01(0.5 + (relief - 0.5) * material.detailStrength);
    }
  const byte = (value: number) => Math.round(clamp01(value) * 255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4,
        h = heights[y * size + x];
      const dx = heights[y * size + ((x + 1) % size)] - heights[y * size + ((x + size - 1) % size)];
      const dy = heights[((y + 1) % size) * size + x] - heights[((y + size - 1) % size) * size + x];
      // Terrain NormalScale is applied by the native biome shader. Clutter has no
      // per-material GPU strength scalar, so its strength is baked explicitly.
      const n = normalize([-dx * bakedNormalStrength * 8, -dy * bakedNormalStrength * 8, 1]);
      for (let channel = 0; channel < 3; channel++)
        result.diffuse[at + channel] = byte(
          (first[channel] * (0.4 + h * 0.6) + second[channel] * (0.6 - h * 0.6)) * (0.8 + h * 0.3),
        );
      result.normal.set(
        [byte(n[0] * 0.5 + 0.5), byte(n[1] * 0.5 + 0.5), byte(n[2] * 0.5 + 0.5), 255],
        at,
      );
      result.orm.set(
        [
          byte(0.65 + h * 0.35),
          byte(material.roughness * (0.82 + h * 0.3)),
          byte(material.metalness),
          255,
        ],
        at,
      );
      result.displacement.set([byte(h), byte(h), byte(h), 255], at);
      result.height.set([byte(h), byte(h), byte(h), 255], at);
      result.diffuse[at + 3] = 255;
    }
  return result;
}

export function generateClutterPixels(
  type: ClutterType,
  size = type.importedAsset
    ? importedMaterialSize(type)
    : type.stockAssetId
      ? STOCK_TEXTURE_SIZE
      : 128,
  placementSize = size,
) {
  const material = {
    ...defaultTerrainMaterial(
      type.geometry.shape === "crystal" ? "ice" : "regolith",
      type.seed,
      type.material.color,
    ),
    secondaryColor: type.material.secondaryColor,
    roughness: type.material.roughness,
    metalness: type.material.metalness,
    normalScale: type.material.normalStrength,
    detailStrength: 0.8,
  };
  const stock = type.importedAsset
      ? getImportedMaterialPixels(type)
      : type.stockAssetId
        ? getStockPixels(type.stockAssetId, size, type.material, type.seed)
        : undefined,
    detail = stock ?? generateTerrainPixels(material, size, type.material.normalStrength),
    distribution = new Uint8Array(placementSize * placementSize * 4),
    opacity = new Uint8Array(placementSize * placementSize * 4);
  for (let y = 0; y < placementSize; y++)
    for (let x = 0; x < placementSize; x++) {
      const at = (y * placementSize + x) * 4,
        u = x / placementSize,
        v = y / placementSize;
      const patch = tileNoise(
        u,
        v,
        Math.max(0.1, type.distribution.patchScale),
        type.distribution.seed,
      );
      const density = clamp01(
        type.distribution.density * clamp01(0.5 + (patch - 0.5) * type.distribution.patchContrast),
      );
      const value = Math.round(density * 255);
      distribution.set([value, value, value, 255], at);
      const width = Math.max(0.05, Math.sin(v * Math.PI) * 0.44),
        mask = smooth(((width - Math.abs(u - 0.5)) * placementSize) / 2);
      const alpha = Math.round(mask * 255);
      opacity.set([alpha, alpha, alpha, 255], at);
    }
  return { ...detail, distribution, opacity: stock?.opacity ?? opacity };
}

export interface ClutterGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  tangents: Float32Array;
  indices: Uint32Array;
}

export interface StockClutterMeshData {
  positions: ArrayLike<number>;
  indices?: ArrayLike<number>;
  normals?: ArrayLike<number>;
  uvs?: ArrayLike<number>;
  tangents?: ArrayLike<number>;
}

/** Blender's authored vertex data, normalized to editable metre dimensions. */
export function normalizeStockClutterGeometry(
  source: StockClutterMeshData,
  type: ClutterType,
): ClutterGeometry {
  if (!source.positions.length || source.positions.length % 3)
    throw new Error("Stock clutter positions must contain complete XYZ vertices");
  const positions = Float32Array.from(source.positions),
    count = positions.length / 3;
  if (positions.some((value) => !Number.isFinite(value)))
    throw new Error("Stock clutter positions must be finite");
  if (source.indices)
    for (let index = 0; index < source.indices.length; index++)
      if (
        !Number.isInteger(source.indices[index]) ||
        source.indices[index] < 0 ||
        source.indices[index] >= count
      )
        throw new Error("Stock clutter needs valid triangle indices");
  const indices = source.indices
    ? Uint32Array.from(source.indices)
    : Uint32Array.from({ length: count }, (_, index) => index);
  if (indices.length % 3 || indices.some((index) => index >= count))
    throw new Error("Stock clutter needs valid triangle indices");
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < positions.length; at++) {
    const axis = at % 3;
    min[axis] = Math.min(min[axis], positions[at]);
    max[axis] = Math.max(max[axis], positions[at]);
  }
  const scales = [0, 1, 2].map(
    (axis) => type.geometry.dimensionsM[axis] / Math.max(1e-6, max[axis] - min[axis]),
  );
  for (let at = 0; at < positions.length; at++) {
    const axis = at % 3;
    positions[at] =
      (positions[at] - min[axis]) * scales[axis] -
      (axis === 1 ? 0 : type.geometry.dimensionsM[axis] / 2);
  }
  const normals = new Float32Array(positions.length),
    uvs = new Float32Array(count * 2),
    tangents = new Float32Array(count * 4);
  if (source.normals?.length === positions.length) {
    for (let at = 0; at < normals.length; at += 3)
      normals.set(
        normalize([
          source.normals[at] / scales[0],
          source.normals[at + 1] / scales[1],
          source.normals[at + 2] / scales[2],
        ]),
        at,
      );
  } else {
    const vertex = (index: number): Vec3 => [
      positions[index * 3],
      positions[index * 3 + 1],
      positions[index * 3 + 2],
    ];
    for (let at = 0; at < indices.length; at += 3) {
      const a = vertex(indices[at]),
        b = vertex(indices[at + 1]),
        c = vertex(indices[at + 2]),
        n = cross(subtract(b, a), subtract(c, a));
      for (const index of [indices[at], indices[at + 1], indices[at + 2]])
        for (let axis = 0; axis < 3; axis++) normals[index * 3 + axis] += n[axis];
    }
    for (let at = 0; at < normals.length; at += 3)
      normals.set(normalize([normals[at], normals[at + 1], normals[at + 2]]), at);
  }
  const repair = new Uint8Array(count);
  for (let index = 0; index < count; index++)
    if (Math.hypot(normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2]) < 1e-8)
      repair[index] = 1;
  if (repair.some(Boolean)) {
    // Decimation can leave Blender loop normals zero on otherwise valid faces.
    // Preserve authored normals and repair only these corners from geometry.
    const vertex = (index: number): Vec3 => [
      positions[index * 3],
      positions[index * 3 + 1],
      positions[index * 3 + 2],
    ];
    for (let at = 0; at < indices.length; at += 3) {
      const corners = [indices[at], indices[at + 1], indices[at + 2]],
        a = vertex(corners[0]),
        b = vertex(corners[1]),
        c = vertex(corners[2]),
        n = normalize(cross(subtract(b, a), subtract(c, a)));
      if (Math.hypot(...n) < 1e-8) continue;
      for (const index of corners)
        if (repair[index]) {
          normals.set(n, index * 3);
          repair[index] = 0;
        }
    }
    for (let index = 0; index < count; index++)
      if (repair[index]) normals.set([0, 1, 0], index * 3);
  }
  if (source.uvs?.length === uvs.length) uvs.set(source.uvs);
  else
    for (let index = 0; index < count; index++)
      uvs.set(
        [
          0.5 + Math.atan2(positions[index * 3 + 2], positions[index * 3]) / (Math.PI * 2),
          positions[index * 3 + 1] / type.geometry.dimensionsM[1],
        ],
        index * 2,
      );
  const tangentU = new Float32Array(count * 3),
    tangentV = new Float32Array(count * 3);
  for (let at = 0; at < indices.length; at += 3) {
    const a = indices[at] * 2,
      b = indices[at + 1] * 2,
      c = indices[at + 2] * 2;
    const area =
      (uvs[b] - uvs[a]) * (uvs[c + 1] - uvs[a + 1]) - (uvs[c] - uvs[a]) * (uvs[b + 1] - uvs[a + 1]);
    if (!Number.isFinite(area) || Math.abs(area) <= 1e-10)
      throw new Error(
        "Stock clutter triangles need nonzero UV area for the native cotangent frame",
      );
    const ia = indices[at],
      ib = indices[at + 1],
      ic = indices[at + 2];
    for (let axis = 0; axis < 3; axis++) {
      const e1 = positions[ib * 3 + axis] - positions[ia * 3 + axis],
        e2 = positions[ic * 3 + axis] - positions[ia * 3 + axis],
        du = (e1 * (uvs[c + 1] - uvs[a + 1]) - e2 * (uvs[b + 1] - uvs[a + 1])) / area,
        dv = (e2 * (uvs[b] - uvs[a]) - e1 * (uvs[c] - uvs[a])) / area;
      for (const index of [ia, ib, ic]) {
        tangentU[index * 3 + axis] += du;
        tangentV[index * 3 + axis] += dv;
      }
    }
  }
  for (let index = 0; index < count; index++) {
    const n: Vec3 = [normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2]];
    let t: Vec3;
    if (source.tangents?.length === tangents.length) {
      const original: Vec3 = [
        source.tangents[index * 4] * scales[0],
        source.tangents[index * 4 + 1] * scales[1],
        source.tangents[index * 4 + 2] * scales[2],
      ];
      const dot = n[0] * original[0] + n[1] * original[1] + n[2] * original[2];
      t = normalize([original[0] - n[0] * dot, original[1] - n[1] * dot, original[2] - n[2] * dot]);
    } else {
      const original: Vec3 = [
          tangentU[index * 3],
          tangentU[index * 3 + 1],
          tangentU[index * 3 + 2],
        ],
        dot = n[0] * original[0] + n[1] * original[1] + n[2] * original[2];
      t = normalize([original[0] - n[0] * dot, original[1] - n[1] * dot, original[2] - n[2] * dot]);
    }
    if (Math.hypot(...t) < 1e-8)
      t = normalize(cross(Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], n));
    const bitangent = cross(n, t),
      orientation =
        bitangent[0] * tangentV[index * 3] +
        bitangent[1] * tangentV[index * 3 + 1] +
        bitangent[2] * tangentV[index * 3 + 2];
    tangents.set([...t, source.tangents?.[index * 4 + 3] ?? (orientation < 0 ? -1 : 1)], index * 4);
  }
  return { positions, normals, uvs, tangents, indices };
}

/** Original shape meshes in metres. LOD simplification changes topology, preserving bounds. */
export function generateClutterGeometry(type: ClutterType, lod = 0): ClutterGeometry {
  if (type.importedAsset) return getImportedGeometry(type, lod);
  if (type.stockAssetId)
    return normalizeStockClutterGeometry(getStockMesh(type.stockAssetId, lod), type);
  const triangles: Vec3[][] = [],
    quality = 0.65 + Math.max(0, Math.min(4, type.geometry.detail)) * 0.35;
  const sides = Math.max(4, Math.round((16 - Math.min(4, Math.max(0, lod)) * 3) * quality));
  const add = (a: Vec3, b: Vec3, c: Vec3, centre: Vec3 = [0, 0.5, 0]) => {
    const n = cross(subtract(b, a), subtract(c, a)),
      outward = subtract(
        [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
        centre,
      );
    triangles.push(
      n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0 ? [a, c, b] : [a, b, c],
    );
  };
  const ellipsoid = (centre: Vec3, radii: Vec3, segments: number, rings: number, salt: number) => {
    const point = (ring: number, side: number): Vec3 => {
      const theta = (ring / rings) * Math.PI,
        phi = (side / segments) * Math.PI * 2;
      const p: Vec3 = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      ];
      const jitter =
        1 +
        (noise3(p[0] * 3 + 7, p[1] * 3 + 11, p[2] * 3 + 17, type.seed + salt) - 0.5) *
          type.geometry.irregularity *
          (type.geometry.shape === "pebble" ? 0.35 : 1);
      return [
        centre[0] + p[0] * radii[0] * jitter,
        centre[1] + p[1] * radii[1] * jitter,
        centre[2] + p[2] * radii[2] * jitter,
      ];
    };
    for (let ring = 0; ring < rings; ring++)
      for (let side = 0; side < segments; side++) {
        const a = point(ring, side),
          b = point(ring + 1, side),
          c = point(ring + 1, (side + 1) % segments),
          d = point(ring, (side + 1) % segments);
        if (ring > 0) add(a, b, d, centre);
        if (ring < rings - 1) add(d, b, c, centre);
      }
  };
  const shape = type.geometry.shape;
  if (shape === "boulder" || shape === "pebble")
    ellipsoid(
      [0, 0.5, 0],
      [0.5, shape === "pebble" ? 0.22 : 0.5, 0.5],
      sides,
      Math.max(2, Math.round(sides / 2)),
      shape === "pebble" ? 973 : 0,
    );
  if (shape === "shrub") {
    const clusters = Math.max(2, 7 - lod);
    for (let index = 0; index < clusters; index++) {
      const angle = (index * Math.PI * 2) / clusters;
      ellipsoid(
        [Math.cos(angle) * 0.25, 0.45 + (index % 2) * 0.15, Math.sin(angle) * 0.25],
        [0.28, 0.42, 0.28],
        Math.max(4, Math.round(sides * 0.6)),
        Math.max(2, Math.round(sides * 0.3)),
        index * 71,
      );
    }
  }
  if (shape === "crystal" || shape === "spire") {
    const segments = shape === "crystal" ? Math.max(3, Math.round(sides * 0.55)) : sides;
    const levels =
      shape === "crystal"
        ? [
            [0, 0.3],
            [0.72, 0.5],
            [1, 0],
          ]
        : [
            [0, 0.5],
            [0.32, 0.38],
            [0.7, 0.16],
            [1, 0],
          ];
    const ring = (level: number, side: number): Vec3 => {
      const [y, radius] = levels[level],
        a = (side * Math.PI * 2) / segments;
      const jitter =
        1 + (noise3(side * 0.73, level * 0.51, 3.1, type.seed) - 0.5) * type.geometry.irregularity;
      return [
        Math.cos(a) * radius * jitter + (shape === "spire" ? y * 0.09 : 0),
        y,
        Math.sin(a) * radius * jitter,
      ];
    };
    for (let side = 0; side < segments; side++) {
      const next = (side + 1) % segments;
      add([0, 0, 0], ring(0, next), ring(0, side));
      for (let level = 0; level < levels.length - 1; level++) {
        add(ring(level, side), ring(level, next), ring(level + 1, side));
        if (level < levels.length - 2)
          add(ring(level, next), ring(level + 1, next), ring(level + 1, side));
      }
    }
  }
  if (shape === "grass") {
    const blades = Math.max(2, Math.round((12 - lod * 2) * quality));
    for (let blade = 0; blade < blades; blade++) {
      const angle = blade * 2.39996,
        length = 0.8 + (noise3(blade, 1, 2, type.seed) - 0.5) * type.geometry.irregularity * 0.9,
        root: Vec3 = [Math.cos(angle) * 0.35, 0, Math.sin(angle) * 0.35];
      const width = 0.04 + noise3(blade, 4, 1, type.seed) * 0.055;
      const a: Vec3 = [root[0] - Math.cos(angle) * width, 0, root[2] - Math.sin(angle) * width];
      const b: Vec3 = [root[0] + Math.cos(angle) * width, 0, root[2] + Math.sin(angle) * width];
      const c: Vec3 = [root[0] + Math.sin(angle) * 0.15, length, root[2] - Math.cos(angle) * 0.15];
      triangles.push([a, b, c]);
    }
  }
  const all = triangles.flat(),
    min = [0, 1, 2].map((axis) => Math.min(...all.map((p) => p[axis]))),
    max = [0, 1, 2].map((axis) => Math.max(...all.map((p) => p[axis])));
  const reshape = (p: Vec3): Vec3 =>
    [0, 1, 2].map(
      (axis) =>
        ((p[axis] - min[axis]) / Math.max(1e-6, max[axis] - min[axis]) - (axis === 1 ? 0 : 0.5)) *
        type.geometry.dimensionsM[axis],
    ) as Vec3;
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    tangents: number[] = [];
  for (const source of triangles) {
    const points = source.map(reshape),
      n = normalize(cross(subtract(points[1], points[0]), subtract(points[2], points[0])));
    const t = normalize(cross(Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], n));
    points.forEach((p, index) => {
      positions.push(...p);
      normals.push(...n);
      tangents.push(...t, 1);
      if (shape === "grass") uvs.push(index === 0 ? 0 : index === 1 ? 1 : 0.5, index === 2 ? 1 : 0);
      else
        uvs.push(0.5 + Math.atan2(p[2], p[0]) / (Math.PI * 2), p[1] / type.geometry.dimensionsM[1]);
    });
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    tangents: new Float32Array(tangents),
    indices: Uint32Array.from({ length: positions.length / 3 }, (_, index) => index),
  };
}

/** Native altitude splines use zero tangent defaults (smoothstep between knots). */
export function sampleAltitudeDensity(type: ClutterType, altitudeM: number): number {
  const points = [...type.distribution.altitudeDensity].sort((a, b) => a.altitudeM - b.altitudeM);
  if (!points.length) return 1;
  if (altitudeM <= points[0].altitudeM) return clamp01(points[0].density);
  for (let index = 1; index < points.length; index++)
    if (altitudeM <= points[index].altitudeM) {
      const a = points[index - 1],
        b = points[index],
        t = smooth((altitudeM - a.altitudeM) / Math.max(1e-6, b.altitudeM - a.altitudeM));
      return clamp01(a.density + (b.density - a.density) * t);
    }
  return clamp01(points[points.length - 1].density);
}
