import meshes from "./stock-meshes.json" with { type: "json" };
import { generateStockMaterialPixels, usesStockFoliageCutout } from "./stock-materials";
import type { ClutterType, Vec3 } from "./types";

export interface StockMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
}
export interface StockAsset {
  id: string;
  name: string;
  description: string;
  category: "rock" | "tree" | "alien" | "groundcover";
  dimensionsM: Vec3;
  palette: string[];
  cutout?: boolean;
  materialFamily?: string;
  foliageStyle?: "needles" | "compound" | "broadleaf";
}
/** LE records: UNORM16 position XYZ, SNORM16 normal XYZ, UNORM16 UV; then indices. */
export interface PackedStockMesh {
  vertexCount: number;
  indexCount: number;
  indexBits: 16 | 32;
  min: Vec3;
  max: Vec3;
  data: string;
}
type LegacyStockMesh = { positions: number[]; normals: number[]; uvs: number[]; indices: number[] };
const library = meshes as unknown as (StockAsset & {
  lods: (PackedStockMesh | LegacyStockMesh)[];
})[];
/** Original Blender meshes embedded in the module graph: no runtime network or filesystem. */
export const STOCK_ASSETS: readonly StockAsset[] = library.map(({ lods: _, ...asset }) => asset);
export const STOCK_TEXTURE_SIZE = 512;
const byId = new Map(library.map((asset) => [asset.id, asset]));
export function stockUsesCutout(id: string | undefined) {
  const asset = id ? byId.get(id) : undefined;
  return !!asset && usesStockFoliageCutout(asset);
}
export function stockIsGroundcover(id: string | undefined) {
  return !!id && byId.get(id)?.category === "groundcover";
}
export function stockPreviewInstanceLimit(id: string | undefined) {
  const asset = id ? byId.get(id) : undefined;
  if (!asset) return 256;
  const far = asset.lods[4],
    triangles = ("data" in far ? far.indexCount : far.indices.length) / 3;
  return Math.max(
    1,
    Math.min(asset.category === "groundcover" ? 4096 : 256, Math.floor(600_000 / triangles)),
  );
}
/** Pick a patch-preview LOD without decoding any mesh. Keep dense patches affordable. */
export function stockScatterLod(
  id: string | undefined,
  projectedPixels: number,
  instances: number,
) {
  const asset = id ? byId.get(id) : undefined;
  if (!asset) return 1;
  const thresholds = [128, 64, 32, 16, 0];
  let lod = Math.max(
    1,
    thresholds.findIndex((threshold) => projectedPixels >= threshold),
  );
  while (lod < 4) {
    const mesh = asset.lods[lod];
    const triangles = ("data" in mesh ? mesh.indexCount : mesh.indices.length) / 3;
    if (triangles * instances <= 600_000) break;
    lod++;
  }
  return lod;
}
export const CLUTTER_ALPHA_CUTOFF = 0.4;
const decoded = new Map<string, StockMesh>();
const materialCache = new Map<string, ReturnType<typeof generateStockMaterialPixels>>();
const MATERIAL_CACHE_BUDGET = 32 * 1024 * 1024;
let materialCacheBytes = 0;

/** Synchronous and identical in browsers and Node; each LOD is decoded only on first use. */
export function decodeStockMesh(source: PackedStockMesh): StockMesh {
  const { vertexCount, indexCount, indexBits, min, max } = source;
  if (
    !Number.isSafeInteger(vertexCount) ||
    vertexCount <= 0 ||
    !Number.isSafeInteger(indexCount) ||
    indexCount <= 0 ||
    indexCount % 3 ||
    ![16, 32].includes(indexBits) ||
    min.length !== 3 ||
    max.length !== 3 ||
    !min.every(Number.isFinite) ||
    !max.every(Number.isFinite) ||
    max.some((value, axis) => value < min[axis])
  )
    throw new Error("Invalid packed stock mesh metadata");
  const raw = atob(source.data);
  if (raw.length !== vertexCount * 16 + indexCount * (indexBits / 8))
    throw new Error("Packed stock mesh byte length does not match its metadata");
  const bytes = Uint8Array.from(raw, (value) => value.charCodeAt(0)),
    view = new DataView(bytes.buffer),
    positions = new Float32Array(vertexCount * 3),
    normals = new Float32Array(vertexCount * 3),
    uvs = new Float32Array(vertexCount * 2),
    indices = indexBits === 16 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const at = vertex * 16;
    for (let axis = 0; axis < 3; axis++) {
      positions[vertex * 3 + axis] =
        min[axis] + (view.getUint16(at + axis * 2, true) / 65535) * (max[axis] - min[axis]);
      normals[vertex * 3 + axis] = view.getInt16(at + 6 + axis * 2, true) / 32767;
    }
    const length = Math.hypot(
      normals[vertex * 3],
      normals[vertex * 3 + 1],
      normals[vertex * 3 + 2],
    );
    if (length < 0.5) throw new Error("Packed stock mesh contains an invalid normal");
    for (let axis = 0; axis < 3; axis++) normals[vertex * 3 + axis] /= length;
    uvs[vertex * 2] = view.getUint16(at + 12, true) / 65535;
    uvs[vertex * 2 + 1] = view.getUint16(at + 14, true) / 65535;
  }
  for (let index = 0; index < indexCount; index++) {
    const at = vertexCount * 16 + index * (indexBits / 8);
    indices[index] = indexBits === 16 ? view.getUint16(at, true) : view.getUint32(at, true);
    if (indices[index] >= vertexCount) throw new Error("Packed stock mesh index is out of range");
  }
  return { positions, normals, uvs, indices };
}

export function getStockMesh(id: string, lod = 0): StockMesh {
  const asset = byId.get(id);
  if (!asset) throw new Error(`Unknown stock clutter asset: ${id}`);
  if (!Number.isInteger(lod) || lod < 0 || lod >= 5 || !asset.lods[lod])
    throw new Error(`Stock clutter ${id} requires a valid native LOD from 0 to 4`);
  const key = `${id}:${lod}`;
  let mesh = decoded.get(key);
  if (!mesh) {
    const source = asset.lods[lod];
    mesh =
      "data" in source
        ? decodeStockMesh(source)
        : {
            positions: Float32Array.from(source.positions),
            normals: Float32Array.from(source.normals),
            uvs: Float32Array.from(source.uvs),
            indices: Uint32Array.from(source.indices),
          };
    decoded.set(key, mesh);
  }
  return mesh;
}

export function getStockPixels(
  id: string,
  size: number,
  material: ClutterType["material"],
  seed: number,
) {
  const asset = byId.get(id);
  if (!asset) throw new Error(`Unknown stock clutter asset: ${id}`);
  const key = JSON.stringify([
    id,
    size,
    seed,
    material.color,
    material.secondaryColor,
    material.roughness,
    material.metalness,
    material.normalStrength,
  ]);
  let pixels = materialCache.get(key);
  if (pixels) {
    materialCache.delete(key);
    materialCache.set(key, pixels);
    return pixels;
  }
  pixels = generateStockMaterialPixels(asset, size, material, seed);
  const bytes =
    pixels.diffuse.byteLength * 3 +
    (pixels.opacity?.byteLength ?? 0) +
    (pixels.thickness?.byteLength ?? 0);
  if (bytes <= MATERIAL_CACHE_BUDGET) {
    while (materialCacheBytes + bytes > MATERIAL_CACHE_BUDGET) {
      const oldest = materialCache.keys().next().value!;
      const previous = materialCache.get(oldest)!;
      materialCacheBytes -=
        previous.diffuse.byteLength * 3 +
        (previous.opacity?.byteLength ?? 0) +
        (previous.thickness?.byteLength ?? 0);
      materialCache.delete(oldest);
    }
    materialCache.set(key, pixels);
    materialCacheBytes += bytes;
  }
  return pixels;
}

/** Native GLB writes positions, normals, UVs, tangents and 32-bit indices for each LOD. */
export function stockMeshByteEstimate(id: string) {
  const asset = byId.get(id);
  return asset
    ? asset.lods.reduce(
        (total, mesh) =>
          total +
          ("data" in mesh ? mesh.vertexCount : mesh.positions.length / 3) * 48 +
          ("data" in mesh ? mesh.indexCount : mesh.indices.length) * 4 +
          4096,
        0,
      )
    : 1024 * 1024;
}
