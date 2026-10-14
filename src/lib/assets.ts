import type { Planet } from "./types";
import {
  compileSurfaceSampler,
  nativeToAuthorDirection,
  noise3,
  parseColor,
  type Vec3,
} from "./procedural";
import { defaultClutter, generateClutterPixels } from "./surface";
import { biomeMaterialPaths, generateSurfaceAssets } from "./surfaceExport";

export interface GeneratedAsset {
  path: string;
  data: Uint8Array;
  mimeType: string;
}

export function bodyAssetPaths(body: Planet) {
  const root = `Textures/${body.id}`;
  return {
    diffuse: `${root}_Diffuse.ktx2`,
    normal: `${root}_Normal.ktx2`,
    height: `${root}_Height.ktx2`,
    biomeId: `${root}_Biome_ID.ktx2`,
    biomeControl: `${root}_Biome_Control.ktx2`,
    scattering: `${root}_Scattering.ktx2`,
    surge: `${root}_Surge.ktx2`,
    terrainDiffuse: body.surface.biomes?.length
      ? biomeMaterialPaths(body, body.surface.biomes[0], "Ground").diffuse
      : `${root}_Terrain_Diffuse.png`,
    terrainNormal: body.surface.biomes?.length
      ? biomeMaterialPaths(body, body.surface.biomes[0], "Ground").normal
      : `${root}_Terrain_Normal.png`,
    terrainOrm: body.surface.biomes?.length
      ? biomeMaterialPaths(body, body.surface.biomes[0], "Ground").orm
      : `${root}_Terrain_AoRoughMetal.png`,
    rings: `${root}_Rings.png`,
    ringsControl: `${root}_RingsControl.png`,
    rockModel: `Meshes/${body.id}_Rock.glb`,
    rockMesh: `${body.id}_RockMesh`,
    rockDiffuse: `${root}_Rock_Diffuse.png`,
    rockNormal: `${root}_Rock_Normal.png`,
    rockOrm: `${root}_Rock_AoRoughMetal.png`,
    rockDistribution: `${root}_Rock_Distribution.png`,
  };
}

const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
const align = (n: number, size: number) => Math.ceil(n / size) * size;
const utf8 = (value: string) => new TextEncoder().encode(value);

/** KTX2 writer for native, uncompressed Vulkan RGBA8 and R16 cubemaps. */
export function encodeKtx2Cube(
  faces: Uint8Array[],
  size: number,
  format: "rgba8" | "r16",
  mipFilter: "average" | "nearest" = "average",
): Uint8Array {
  if (faces.length !== 6 || !Number.isInteger(size) || size < 1 || (size & (size - 1)) !== 0)
    throw new Error("KTX2 cube needs six square power-of-two faces");
  const bpp = format === "rgba8" ? 4 : 2;
  for (const face of faces)
    if (face.length !== size * size * bpp) throw new Error("KTX2 cube face byte count mismatch");
  const mipCount = Math.log2(size) + 1;
  const mipFaces: Uint8Array[][] = [faces];
  for (let level = 1; level < mipCount; level++) {
    const previous = mipFaces[level - 1],
      oldSize = size >> (level - 1),
      nextSize = size >> level;
    mipFaces.push(
      previous.map((source) => {
        const target = new Uint8Array(nextSize * nextSize * bpp);
        for (let y = 0; y < nextSize; y++)
          for (let x = 0; x < nextSize; x++) {
            if (bpp === 4) {
              for (let channel = 0; channel < 4; channel++) {
                if (mipFilter === "nearest") {
                  target[(y * nextSize + x) * 4 + channel] =
                    source[(y * 2 * oldSize + x * 2) * 4 + channel];
                  continue;
                }
                let sum = 0;
                for (let dy = 0; dy < 2; dy++)
                  for (let dx = 0; dx < 2; dx++)
                    sum += source[((y * 2 + dy) * oldSize + x * 2 + dx) * 4 + channel];
                target[(y * nextSize + x) * 4 + channel] = Math.round(sum / 4);
              }
            } else {
              let sum = 0;
              for (let dy = 0; dy < 2; dy++)
                for (let dx = 0; dx < 2; dx++) {
                  const index = ((y * 2 + dy) * oldSize + x * 2 + dx) * 2;
                  sum += source[index] | (source[index + 1] << 8);
                }
              const value = Math.round(sum / 4),
                index = (y * nextSize + x) * 2;
              target[index] = value & 255;
              target[index + 1] = value >>> 8;
            }
          }
        return target;
      }),
    );
  }
  // Khronos Data Format basic descriptor: 4 unsigned 8-bit channels or one unsigned 16-bit channel.
  const dfd =
    format === "rgba8"
      ? new Uint8Array([
          92, 0, 0, 0, 0, 0, 0, 0, 2, 0, 88, 0, 1, 1, 1, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 8, 0, 7, 1, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0,
          0, 0, 16, 0, 7, 2, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 24, 0, 7, 15, 0, 0, 0, 0, 0, 0,
          0, 0, 255, 0, 0, 0,
        ])
      : new Uint8Array([
          44, 0, 0, 0, 0, 0, 0, 0, 2, 0, 40, 0, 1, 1, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0,
        ]);
  const indexEnd = 80 + mipCount * 24;
  const dfdOffset = indexEnd;
  let cursor = align(dfdOffset + dfd.length, 8);
  const offsets: { offset: number; length: number }[] = Array(mipCount);
  for (let level = mipCount - 1; level >= 0; level--) {
    const faceBytes = (size >> level) ** 2 * bpp;
    const length = faceBytes * 6;
    offsets[level] = { offset: cursor, length };
    cursor = align(cursor + length, 8);
  }
  const out = new Uint8Array(cursor),
    view = new DataView(out.buffer);
  out.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const words = [format === "rgba8" ? 37 : 70, bpp === 4 ? 1 : 2, size, size, 0, 0, 6, mipCount, 0];
  words.forEach((value, i) => view.setUint32(12 + i * 4, value, true));
  view.setUint32(48, dfdOffset, true);
  view.setUint32(52, dfd.length, true);
  out.set(dfd, dfdOffset);
  for (let level = 0; level < mipCount; level++) {
    const entry = offsets[level];
    view.setBigUint64(80 + level * 24, BigInt(entry.offset), true);
    view.setBigUint64(88 + level * 24, BigInt(entry.length), true);
    view.setBigUint64(96 + level * 24, BigInt(entry.length), true);
    const stride = mipFaces[level][0].length;
    mipFaces[level].forEach((face, i) => out.set(face, entry.offset + stride * i));
  }
  return out;
}

/** Khronos cube order and direction mapping: +X, -X, +Y, -Y, +Z, -Z. */
export function cubeDirection(face: number, x: number, y: number, size: number): Vec3 {
  const u = (2 * (x + 0.5)) / size - 1,
    v = (2 * (y + 0.5)) / size - 1;
  switch (face) {
    case 0:
      return [1, -v, -u];
    case 1:
      return [-1, -v, u];
    case 2:
      return [u, 1, v];
    case 3:
      return [u, -1, -v];
    case 4:
      return [u, -v, 1];
    default:
      return [-u, -v, -1];
  }
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of data) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length),
    view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(utf8(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
export async function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Promise<Uint8Array> {
  if (rgba.length !== width * height * 4) throw new Error("PNG pixel byte count mismatch");
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
  const zipped = new Uint8Array(await new Response(stream).arrayBuffer());
  const ihdr = new Uint8Array(13),
    header = new DataView(ihdr.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zipped),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function normal(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** A faceted, generated glTF 2.0 rock with positions baked into the mesh. */
export function generateRockGlb(body: Planet): Uint8Array {
  const rock = body.clutter[0] ?? defaultClutter("ring_rock", body.rings.seed);
  const golden = (1 + Math.sqrt(5)) / 2;
  const cornerCoords: Vec3[] = [
    [-1, golden, 0],
    [1, golden, 0],
    [-1, -golden, 0],
    [1, -golden, 0],
    [0, -1, golden],
    [0, 1, golden],
    [0, -1, -golden],
    [0, 1, -golden],
    [golden, 0, -1],
    [golden, 0, 1],
    [-golden, 0, -1],
    [-golden, 0, 1],
  ];
  const corners = cornerCoords.map(normal);
  const triangles = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1,
    8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    tangents: number[] = [],
    indices: number[] = [];
  const shape = (p: Vec3): Vec3 => {
    const n = normal(p);
    const grain = noise3(n[0] * 4 + 5, n[1] * 4 + 7, n[2] * 4 + 11, rock.seed);
    const facets = noise3(n[0] * 10 + 3, n[1] * 10 + 13, n[2] * 10 + 17, rock.seed + 37);
    const r = 1.15 + (grain - 0.5) * 0.44 + (facets - 0.5) * 0.24;
    return [n[0] * r * 1.25, n[1] * r * 0.78 + 0.8, n[2] * r * 1.08];
  };
  for (let i = 0; i < triangles.length; i += 3) {
    const a = corners[triangles[i]],
      b = corners[triangles[i + 1]],
      c = corners[triangles[i + 2]];
    const ab = normal([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    const bc = normal([(b[0] + c[0]) / 2, (b[1] + c[1]) / 2, (b[2] + c[2]) / 2]);
    const ca = normal([(c[0] + a[0]) / 2, (c[1] + a[1]) / 2, (c[2] + a[2]) / 2]);
    for (const tri of [
      [a, ab, ca],
      [ab, b, bc],
      [ca, bc, c],
      [ab, bc, ca],
    ] as Vec3[][]) {
      const points = tri.map(shape);
      const faceNormal = normal(cross(sub(points[1], points[0]), sub(points[2], points[0])));
      const tangent = normal(
        cross(Math.abs(faceNormal[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], faceNormal),
      );
      for (let j = 0; j < 3; j++) {
        const point = points[j],
          original = tri[j];
        positions.push(...point);
        normals.push(...faceNormal);
        uvs.push(
          0.5 + Math.atan2(original[2], original[0]) / (2 * Math.PI),
          0.5 - Math.asin(original[1]) / Math.PI,
        );
        tangents.push(...tangent, 1);
        indices.push(indices.length);
      }
    }
  }
  const positionArray = new Float32Array(positions),
    normalArray = new Float32Array(normals),
    uvArray = new Float32Array(uvs),
    tangentArray = new Float32Array(tangents),
    indexArray = new Uint16Array(indices);
  const binaryParts = [
    new Uint8Array(positionArray.buffer),
    new Uint8Array(normalArray.buffer),
    new Uint8Array(uvArray.buffer),
    new Uint8Array(tangentArray.buffer),
    new Uint8Array(indexArray.buffer),
  ];
  const views: { buffer: number; byteOffset: number; byteLength: number; target: number }[] = [];
  let binaryLength = 0;
  for (let i = 0; i < binaryParts.length; i++) {
    binaryLength = align(binaryLength, 4);
    views.push({
      buffer: 0,
      byteOffset: binaryLength,
      byteLength: binaryParts[i].length,
      target: i === 4 ? 34963 : 34962,
    });
    binaryLength += binaryParts[i].length;
  }
  binaryLength = align(binaryLength, 4);
  const binary = new Uint8Array(binaryLength);
  binaryParts.forEach((part, i) => binary.set(part, views[i].byteOffset));
  const min: number[] = [Infinity, Infinity, Infinity],
    max: number[] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  const json = {
    asset: { version: "2.0", generator: "Orbit Foundry" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: bodyAssetPaths(body).rockMesh, mesh: 0 }],
    meshes: [
      {
        name: bodyAssetPaths(body).rockMesh,
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TANGENT: 3 },
            indices: 4,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    materials: [
      {
        name: `${body.id}_RockMaterial`,
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: uvs.length / 2, type: "VEC2" },
      { bufferView: 3, componentType: 5126, count: tangents.length / 4, type: "VEC4" },
      { bufferView: 4, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: views,
    buffers: [{ byteLength: binary.length }],
  };
  const jsonBytes = utf8(JSON.stringify(json)),
    paddedJsonLength = align(jsonBytes.length, 4);
  const out = new Uint8Array(12 + 8 + paddedJsonLength + 8 + binary.length),
    view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + paddedJsonLength);
  out.set(jsonBytes, 20);
  const binOffset = 20 + paddedJsonLength;
  view.setUint32(binOffset, binary.length, true);
  view.setUint32(binOffset + 4, 0x004e4942, true);
  out.set(binary, binOffset + 8);
  return out;
}

function rockTexture(
  body: Planet,
  kind: "diffuse" | "normal" | "orm" | "distribution",
  size = 64,
): Uint8Array {
  const rock = body.clutter[0] ?? defaultClutter("ring_rock", body.rings.seed);
  return generateClutterPixels(rock, size)[kind];
}

/** Direction lookup crosses cube edges, so finite differences do not create seams. */
function sampleCubeScalar(faces: Float32Array[], direction: Vec3, size: number): number {
  const [x, y, z] = direction,
    ax = Math.abs(x),
    ay = Math.abs(y),
    az = Math.abs(z);
  let face: number, u: number, v: number;
  if (ax >= ay && ax >= az) {
    face = x >= 0 ? 0 : 1;
    u = x >= 0 ? -z / ax : z / ax;
    v = -y / ax;
  } else if (ay >= az) {
    face = y >= 0 ? 2 : 3;
    u = x / ay;
    v = y >= 0 ? z / ay : -z / ay;
  } else {
    face = z >= 0 ? 4 : 5;
    u = z >= 0 ? x / az : -x / az;
    v = -y / az;
  }
  const px = Math.max(0, Math.min(size - 1, ((u + 1) * size) / 2 - 0.5)),
    py = Math.max(0, Math.min(size - 1, ((v + 1) * size) / 2 - 0.5));
  const x0 = Math.floor(px),
    y0 = Math.floor(py),
    x1 = Math.min(size - 1, x0 + 1),
    y1 = Math.min(size - 1, y0 + 1),
    tx = px - x0,
    ty = py - y0;
  const source = faces[face];
  return (
    (source[y0 * size + x0] * (1 - tx) + source[y0 * size + x1] * tx) * (1 - ty) +
    (source[y1 * size + x0] * (1 - tx) + source[y1 * size + x1] * tx) * ty
  );
}

async function derivePlanetNormals(
  body: Planet,
  heights: Float32Array[],
  size: number,
): Promise<Uint8Array[]> {
  const epsilon = 1 / size,
    faces: Uint8Array[] = [];
  let lastYield = performance.now();
  for (let face = 0; face < heights.length; face++) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = normal(cubeDirection(face, x, y, size));
        // The native TBN projects -Z onto the tangent plane, with +Y fallback.
        const up: Vec3 = Math.abs(p[2]) > 0.999999 ? [0, 1, 0] : [0, 0, -1];
        const dot = up[0] * p[0] + up[1] * p[1] + up[2] * p[2];
        const b = normal([up[0] - p[0] * dot, up[1] - p[1] * dot, up[2] - p[2] * dot]);
        const t = cross(b, p).map((value) => -value) as unknown as Vec3;
        const derivative = (axis: Vec3) => {
          const plus = normal([
            p[0] + axis[0] * epsilon,
            p[1] + axis[1] * epsilon,
            p[2] + axis[2] * epsilon,
          ]);
          const minus = normal([
            p[0] - axis[0] * epsilon,
            p[1] - axis[1] * epsilon,
            p[2] - axis[2] * epsilon,
          ]);
          return (
            ((sampleCubeScalar(heights, plus, size) - sampleCubeScalar(heights, minus, size)) *
              body.surface.elevation) /
            (2 * epsilon * Math.max(0.001, body.radiusKm))
          );
        };
        const n = normal([-derivative(t), -derivative(b), 1]);
        data.set(
          [byte(n[0] * 0.5 + 0.5), byte(n[1] * 0.5 + 0.5), byte(n[2] * 0.5 + 0.5), 255],
          (y * size + x) * 4,
        );
      }
      if ((y & 7) === 7 && performance.now() - lastYield >= 12) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
    faces.push(data);
  }
  return faces;
}

function ringPixels(body: Planet): { band: Uint8Array; control: Uint8Array } {
  const width = 2048,
    band = new Uint8Array(width * 4),
    control = new Uint8Array(width * 4);
  const first = parseColor(body.rings.color),
    second = parseColor(body.rings.secondaryColor);
  for (let x = 0; x < width; x++) {
    const radial = x / (width - 1),
      fade = Math.min(1, radial * 30, (1 - radial) * 30);
    const n = noise3(radial * body.rings.bands * 0.75, 0.3, 1, body.rings.seed);
    const fine = noise3(radial * body.rings.bands * 3.8, 2.3, 2, body.rings.seed + 19);
    const gap = n * 0.75 + fine * 0.25;
    const density = Math.max(0, Math.min(1, (gap - 0.24) * 1.5)) * fade;
    const color = [0, 1, 2].map((c) => first[c] * (1 - n) + second[c] * n);
    for (let c = 0; c < 3; c++) band[x * 4 + c] = byte(color[c]);
    band[x * 4 + 3] = byte(density * body.rings.opacity);
    control[x * 4] = byte(density > 0.37 ? 1 : 0); // rock mesh visibility
    control[x * 4 + 1] = byte(density); // volumetric thickness interpolation
    control[x * 4 + 2] = byte(fine); // detail/noise visibility
    control[x * 4 + 3] = 255;
  }
  return { band, control };
}

export async function generateBodyAssets(body: Planet, faceSize = 256): Promise<GeneratedAsset[]> {
  const paths = bodyAssetPaths(body);
  const assets: GeneratedAsset[] = [];
  const rgbaMaps: Record<string, Uint8Array[]> = {};
  for (const name of body.kind === "rocky"
    ? ["diffuse", "normal", "scattering", "surge"]
    : ["diffuse"])
    rgbaMaps[name] = [];
  const heightFaces: Uint8Array[] = [];
  const scalarFaces: Float32Array[] = [];
  const sampleSurface = compileSurfaceSampler(body);
  let lastYield = performance.now();
  for (let face = 0; face < 6; face++) {
    const maps = Object.fromEntries(
      Object.keys(rgbaMaps).map((name) => [name, new Uint8Array(faceSize * faceSize * 4)]),
    ) as Record<string, Uint8Array>;
    const height = new Uint8Array(faceSize * faceSize * 2);
    const scalars = new Float32Array(faceSize * faceSize);
    for (let y = 0; y < faceSize; y++) {
      for (let x = 0; x < faceSize; x++) {
        const direction = cubeDirection(face, x, y, faceSize);
        const sample = sampleSurface(nativeToAuthorDirection(direction));
        const at = (y * faceSize + x) * 4;
        maps.diffuse[at] = byte(sample.color[0]);
        maps.diffuse[at + 1] = byte(sample.color[1]);
        maps.diffuse[at + 2] = byte(sample.color[2]);
        maps.diffuse[at + 3] = 255;
        if (body.kind === "rocky") {
          scalars[y * faceSize + x] = sample.height;
          const grain = noise3(
            direction[0] * 7,
            direction[1] * 7,
            direction[2] * 7,
            body.surface.seed + 331,
          );
          // Lighting.glsl: Hapke amount/HG b/HG c; CBOE amplitude/width and SHOE amplitude/width.
          maps.scattering.set(
            [
              byte(0.35 + body.surface.roughness * 0.5),
              byte(0.35 + grain * 0.15),
              byte(0.5 + grain * 0.2),
              255,
            ],
            at,
          );
          maps.surge.set(
            [0, 255, byte(0.15 + body.surface.roughness * 0.25), byte(0.04 + grain * 0.035)],
            at,
          );
          const h = Math.round(sample.height * 65535),
            hi = (y * faceSize + x) * 2;
          height[hi] = h & 255;
          height[hi + 1] = h >>> 8;
        }
      }
      if ((y & 7) === 7 && performance.now() - lastYield >= 12) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
    for (const [name, data] of Object.entries(maps)) rgbaMaps[name].push(data);
    if (body.kind === "rocky") {
      heightFaces.push(height);
      scalarFaces.push(scalars);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (body.kind === "rocky")
    rgbaMaps.normal = await derivePlanetNormals(body, scalarFaces, faceSize);
  for (const [name, faces] of Object.entries(rgbaMaps)) {
    const path = paths[name as keyof typeof paths];
    assets.push({ path, data: encodeKtx2Cube(faces, faceSize, "rgba8"), mimeType: "image/ktx2" });
  }
  if (body.kind === "rocky") {
    assets.push({
      path: paths.height,
      data: encodeKtx2Cube(heightFaces, faceSize, "r16"),
      mimeType: "image/ktx2",
    });
    assets.push(...(await generateSurfaceAssets(body, faceSize)));
  }
  if (body.rings.enabled) {
    const { band, control } = ringPixels(body);
    assets.push({ path: paths.rings, data: await encodePng(2048, 1, band), mimeType: "image/png" });
    assets.push({
      path: paths.ringsControl,
      data: await encodePng(2048, 1, control),
      mimeType: "image/png",
    });
  }
  if (body.rings.enabled) {
    assets.push({
      path: paths.rockModel,
      data: generateRockGlb(body),
      mimeType: "model/gltf-binary",
    });
    for (const [kind, path] of [
      ["diffuse", paths.rockDiffuse],
      ["normal", paths.rockNormal],
      ["orm", paths.rockOrm],
      ["distribution", paths.rockDistribution],
    ] as const)
      assets.push({
        path,
        data: await encodePng(64, 64, rockTexture(body, kind)),
        mimeType: "image/png",
      });
  }
  return assets;
}
