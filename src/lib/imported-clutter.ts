import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from "three";
import { normalizeStockClutterGeometry, type ClutterGeometry } from "./surface";
import { parseColor } from "./procedural";
import type { ClutterType, ImportedClutterAsset, Vec3 } from "./types";

export const IMPORTED_LIMITS = {
  fileBytes: 16 * 1024 * 1024,
  vertices: 200_000,
  triangles: 100_000,
  primitives: 128,
  materials: 16,
  images: 32,
  imageSide: 1024,
  decodedImageBytes: 16 * 1024 * 1024,
  materialBytes: 32 * 1024 * 1024,
  projectBytes: 96 * 1024 * 1024,
};
export type ImportedImage = { width: number; height: number; pixels: Uint8Array };
export type ImportedImageDecoder = (bytes: Uint8Array, mime: string) => Promise<ImportedImage>;
// glTF's JSON schema is checked at each use, before allocation or traversal.
type Json = Record<string, any>;
function fail(message: string): never {
  throw new Error(`GLB import: ${message}`);
}
const integer = (value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label} must be an integer between ${min} and ${max}.`);
  return value as number;
};
const record = (v: unknown, label: string): Json => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) fail(`${label} is malformed.`);
  return v as Json;
};
const list = (v: unknown, label: string, max = 100_000): Json[] => {
  if (!Array.isArray(v) || v.length > max) fail(`${label} must contain at most ${max} entries.`);
  return (v as unknown[]).map((item, i) => record(item, `${label} ${i + 1}`));
};
const numbers = (v: unknown, count: number, label: string, fallback?: number[]): number[] => {
  if (v === undefined && fallback) return fallback;
  if (
    !Array.isArray(v) ||
    v.length !== count ||
    v.some((n) => typeof n !== "number" || !Number.isFinite(n))
  )
    fail(`${label} needs ${count} finite numbers.`);
  return v as number[];
};
const unit = (v: unknown, label: string, fallback: number): number => {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)
    fail(`${label} must be between 0 and 1.`);
  return v as number;
};
const byte = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
const linear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const srgb = (x: number) => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);
export function importedEncodeBytes(array: ArrayBufferView): string {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let result = "";
  for (let at = 0; at < bytes.length; at += 16_384)
    result += String.fromCharCode(...bytes.subarray(at, at + 16_384));
  return btoa(result);
}
export function importedDecodeBytes(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
}
function floatArray(encoded: string) {
  const bytes = importedDecodeBytes(encoded);
  return new Float32Array(bytes.buffer as ArrayBuffer);
}
function indexArray(encoded: string) {
  const bytes = importedDecodeBytes(encoded);
  return new Uint32Array(bytes.buffer as ArrayBuffer);
}

/** Checks encoded dimensions before asking the browser to allocate decoded pixels. */
export function importedImageDimensions(bytes: Uint8Array, mime: string): [number, number] {
  if (mime === "image/png") {
    if (
      bytes.length < 33 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) ||
      new TextDecoder().decode(bytes.subarray(12, 16)) !== "IHDR"
    )
      fail("Invalid embedded PNG header.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (mime === "image/jpeg") {
    if (bytes[0] !== 255 || bytes[1] !== 216) fail("Invalid embedded JPEG header.");
    for (let at = 2; at + 3 < bytes.length;) {
      if (bytes[at++] !== 255) fail("Invalid embedded JPEG marker.");
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = (bytes[at] << 8) | bytes[at + 1];
      if (length < 2 || at + length > bytes.length) fail("Truncated embedded JPEG.");
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) fail("Invalid JPEG dimensions.");
        return [(bytes[at + 5] << 8) | bytes[at + 6], (bytes[at + 3] << 8) | bytes[at + 4]];
      }
      at += length;
    }
    fail("Embedded JPEG has no supported dimension header.");
  }
  fail("Embedded images must be PNG or JPEG; compressed KTX2/WebP textures are unsupported.");
}
async function browserDecode(bytes: Uint8Array, mime: string): Promise<ImportedImage> {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: mime }), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
    imageOrientation: "none",
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) fail("Image decoding is unavailable in this browser.");
    ctx.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      pixels: new Uint8Array(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data),
    };
  } finally {
    bitmap.close();
  }
}
function sample(image: ImportedImage | undefined, u: number, v: number, channel: number): number {
  if (!image) return 1;
  // Source glTF UV v=0 is the top encoded PNG/JPEG row. No vertical flip.
  const x = u * image.width - 0.5,
    y = v * image.height - 0.5;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const pixel = (px: number, py: number) =>
    image.pixels[
      (((py + image.height) % image.height) * image.width + ((px + image.width) % image.width)) *
        4 +
        channel
    ] / 255;
  return (
    (pixel(ix, iy) * (1 - fx) + pixel(ix + 1, iy) * fx) * (1 - fy) +
    (pixel(ix, iy + 1) * (1 - fx) + pixel(ix + 1, iy + 1) * fx) * fy
  );
}

/** Import only detached static glTF 2.0 data. No loader or network fetch is invoked. */
export async function importClutterGlb(
  data: ArrayBuffer | Uint8Array,
  sourceName: string,
  decode: ImportedImageDecoder = browserDecode,
): Promise<ImportedClutterAsset> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length > IMPORTED_LIMITS.fileBytes)
    fail("File exceeds 16 MB. Export a smaller static GLB.");
  if (bytes.length < 28) fail("File is not a complete GLB 2.0 container.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length
  )
    fail("File must be a valid GLB 2.0 container with its complete declared length.");
  let json: Json | undefined, bin: Uint8Array | undefined;
  for (let at = 12; at < bytes.length;) {
    if (at + 8 > bytes.length) fail("Truncated chunk header.");
    const length = view.getUint32(at, true),
      type = view.getUint32(at + 4, true);
    if (length % 4 || at + 8 + length > bytes.length) fail("Invalid GLB chunk bounds.");
    if (type === 0x4e4f534a) {
      if (json || at !== 12 || length > 2 * 1024 * 1024)
        fail("GLB needs one JSON chunk of at most 2 MB first.");
      try {
        json = record(
          JSON.parse(new TextDecoder().decode(bytes.subarray(at + 8, at + 8 + length))),
          "glTF JSON",
        );
      } catch (error) {
        fail(`Invalid JSON chunk: ${(error as Error).message}`);
      }
    } else if (type === 0x004e4942) {
      if (bin) fail("Multiple binary chunks are unsupported.");
      bin = bytes.subarray(at + 8, at + 8 + length);
    } else fail("Unknown GLB chunk type.");
    at += 8 + length;
  }
  if (!json || !bin) fail("GLB needs embedded JSON and binary chunks.");
  const gltf = json as Json,
    binary = bin as Uint8Array;
  if (record(gltf.asset, "asset").version !== "2.0") fail("Only glTF 2.0 is supported.");
  if (gltf.asset.minVersion !== undefined && gltf.asset.minVersion !== "2.0")
    fail("Unsupported glTF minimum version.");
  const inspect = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const child of item) inspect(child);
      return;
    }
    const obj = item as Json;
    if (obj.extensions && Object.keys(record(obj.extensions, "extensions")).length)
      fail(
        `Unsupported extension ${Object.keys(obj.extensions).join(", ")}. Export standard uncompressed metallic-roughness glTF.`,
      );
    for (const [key, value] of Object.entries(obj)) {
      if (
        (key === "extensionsUsed" || key === "extensionsRequired") &&
        Array.isArray(value) &&
        value.length
      )
        fail(
          `Unsupported extension ${value.join(", ")}. Export standard uncompressed metallic-roughness glTF.`,
        );
      if (key === "uri")
        fail(
          "External and data URI resources are unsupported. Embed all buffers and PNG/JPEG images in the GLB binary chunk.",
        );
      if (key !== "extras") inspect(value);
    }
  };
  inspect(gltf);
  if (gltf.animations?.length)
    fail("Animated models are unsupported. Export the desired pose as a static mesh.");
  if (gltf.skins?.length)
    fail("Skinned models are unsupported. Apply armatures and export a static mesh.");
  const buffers = list(gltf.buffers, "buffers", 1);
  if (buffers.length !== 1) fail("Exactly one embedded binary buffer is required.");
  const declared = integer(buffers[0].byteLength, "buffer length", 1, binary.length);
  if (binary.length - declared > 3)
    fail("Binary chunk length differs from its buffer declaration.");
  const views = list(gltf.bufferViews, "buffer views"),
    accessors = list(gltf.accessors, "accessors");
  const slice = (index: unknown): { bytes: Uint8Array; stride?: number } => {
    const v = views[integer(index, "buffer view index", 0, views.length - 1)];
    if (v.buffer !== 0) fail("Buffer view must refer to the embedded buffer.");
    const start = integer(v.byteOffset ?? 0, "buffer view offset"),
      length = integer(v.byteLength, "buffer view length", 1, declared);
    if (start + length > declared) fail("Buffer view exceeds the embedded binary buffer.");
    return { bytes: binary.subarray(start, start + length), stride: v.byteStride };
  };
  const accessor = (
    index: unknown,
    components: number,
    type: string,
    indices = false,
  ): number[] => {
    const a = accessors[integer(index, "accessor index", 0, accessors.length - 1)];
    if (a.sparse) fail("Sparse accessors are unsupported. Export dense vertex buffers.");
    if (a.type !== type) fail(`Accessor must have ${type} components.`);
    if (
      indices
        ? ![5121, 5123, 5125].includes(a.componentType)
        : a.componentType !== 5126 || a.normalized
    )
      fail(
        indices
          ? "Triangle indices must be unsigned integers."
          : "Vertex attributes must be uncompressed float32.",
      );
    const count = integer(
      a.count,
      "accessor count",
      1,
      indices ? IMPORTED_LIMITS.triangles * 3 : IMPORTED_LIMITS.vertices,
    );
    const { bytes: source, stride: sourceStride } = slice(a.bufferView);
    const componentBytes = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
    const stride = integer(
      sourceStride ?? components * componentBytes,
      "vertex stride",
      components * componentBytes,
      252,
    );
    const start = integer(a.byteOffset ?? 0, "accessor offset");
    if (
      stride % componentBytes ||
      start % componentBytes ||
      start + (count - 1) * stride + components * componentBytes > source.length
    )
      fail("Accessor exceeds its buffer view or has invalid alignment.");
    const dv = new DataView(source.buffer, source.byteOffset, source.byteLength),
      values = new Array<number>(count * components);
    for (let i = 0; i < count; i++)
      for (let c = 0; c < components; c++) {
        const at = start + i * stride + c * componentBytes;
        const n =
          a.componentType === 5126
            ? dv.getFloat32(at, true)
            : a.componentType === 5125
              ? dv.getUint32(at, true)
              : a.componentType === 5123
                ? dv.getUint16(at, true)
                : dv.getUint8(at);
        if (!Number.isFinite(n)) fail("Mesh attributes must be finite.");
        values[i * components + c] = n;
      }
    return values;
  };
  const images = list(gltf.images ?? [], "images", IMPORTED_LIMITS.images),
    decoded: ImportedImage[] = [];
  let imageBytes = 0;
  for (const image of images) {
    const source = slice(image.bufferView).bytes,
      mime = image.mimeType;
    const [width, height] = importedImageDimensions(source, mime);
    if (
      width < 1 ||
      height < 1 ||
      width > IMPORTED_LIMITS.imageSide ||
      height > IMPORTED_LIMITS.imageSide
    )
      fail("Embedded image dimensions must be 1–1024 pixels. Resize textures before export.");
    imageBytes += width * height * 4;
    if (imageBytes > IMPORTED_LIMITS.decodedImageBytes)
      fail("Embedded images exceed the 16 MB decoded-image budget.");
    let imageData: ImportedImage;
    try {
      imageData = await decode(source, mime);
    } catch (error) {
      fail(`Cannot decode embedded image: ${(error as Error).message}`);
    }
    if (
      imageData.width !== width ||
      imageData.height !== height ||
      imageData.pixels.length !== width * height * 4
    )
      fail("Decoded image size differs from its header.");
    decoded.push(imageData);
  }
  const textures = list(gltf.textures ?? [], "textures", 64),
    samplers = list(gltf.samplers ?? [], "samplers", 64);
  const texture = (info: unknown): ImportedImage | undefined => {
    if (info === undefined) return;
    const t = record(info, "texture info");
    if ((t.texCoord ?? 0) !== 0)
      fail("Only TEXCOORD_0 is supported. Bake all material channels to the first UV set.");
    const entry = textures[integer(t.index, "texture index", 0, textures.length - 1)];
    if (entry.sampler !== undefined) {
      const sampler = samplers[integer(entry.sampler, "sampler index", 0, samplers.length - 1)];
      if ((sampler.wrapS ?? 10497) !== 10497 || (sampler.wrapT ?? 10497) !== 10497)
        fail(
          "Native clutter requires repeat texture wrapping. Bake clamp/mirrored textures to repeat UVs.",
        );
    }
    return decoded[integer(entry.source, "image index", 0, decoded.length - 1)];
  };
  const sourceMaterials = list(gltf.materials ?? [], "materials", IMPORTED_LIMITS.materials);
  const meshes = list(gltf.meshes, "meshes", 128),
    nodes = list(gltf.nodes, "nodes", 512),
    scenes = list(gltf.scenes, "scenes", 64);
  if (!scenes.length) fail("Model has no scene.");
  const scene = scenes[integer(gltf.scene ?? 0, "scene index", 0, scenes.length - 1)];
  if (!Array.isArray(scene.nodes) || !scene.nodes.length) fail("Default scene has no root nodes.");
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const groups: ImportedClutterAsset["groups"] = [],
    materialIds: number[] = [];
  const visited = new Set<number>();
  const visit = (index: unknown, parent: Matrix4, ancestors: Set<number>) => {
    const nodeIndex = integer(index, "node index", 0, nodes.length - 1),
      node = nodes[nodeIndex];
    if (ancestors.has(nodeIndex)) fail("Scene contains a node cycle.");
    if (visited.has(nodeIndex))
      fail(
        "Scene nodes must have one parent and unique roots; shared or repeated nodes are unsupported.",
      );
    visited.add(nodeIndex);
    if (node.skin !== undefined || node.weights !== undefined)
      fail("Skinned or morph-target nodes are unsupported. Apply deformations before export.");
    const local = new Matrix4();
    if (node.matrix !== undefined) {
      if (node.translation || node.rotation || node.scale)
        fail("Node cannot define both matrix and TRS transforms.");
      local.fromArray(numbers(node.matrix, 16, "node matrix"));
      if (
        local.elements[3] !== 0 ||
        local.elements[7] !== 0 ||
        local.elements[11] !== 0 ||
        local.elements[15] !== 1
      )
        fail("Node matrix must be affine.");
    } else {
      const q = numbers(node.rotation, 4, "node quaternion", [0, 0, 0, 1]);
      if (Math.abs(Math.hypot(...q) - 1) > 0.001)
        fail("Node rotation quaternion must be normalized.");
      local.compose(
        new Vector3().fromArray(numbers(node.translation, 3, "node translation", [0, 0, 0])),
        new Quaternion().fromArray(q),
        new Vector3().fromArray(numbers(node.scale, 3, "node scale", [1, 1, 1])),
      );
    }
    const world = parent.clone().multiply(local),
      determinant = world.determinant();
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
      fail("Node has a singular transform.");
    if (node.mesh !== undefined) {
      const mesh = meshes[integer(node.mesh, "mesh index", 0, meshes.length - 1)];
      if (mesh.weights !== undefined) fail("Morph-target meshes are unsupported.");
      for (const primitive of list(
        mesh.primitives,
        "mesh primitives",
        IMPORTED_LIMITS.primitives,
      )) {
        if (groups.length >= IMPORTED_LIMITS.primitives) fail("Scene exceeds 128 mesh primitives.");
        if ((primitive.mode ?? 4) !== 4)
          fail(
            "Only triangle meshes are supported. Triangulate lines, points and strips before export.",
          );
        if (primitive.targets?.length)
          fail("Morph targets are unsupported. Apply deformations before export.");
        const attrs = record(primitive.attributes, "mesh attributes");
        if (
          Object.keys(attrs).some(
            (key) => !["POSITION", "NORMAL", "TEXCOORD_0", "TANGENT"].includes(key),
          )
        )
          fail(
            "Only POSITION, NORMAL, TEXCOORD_0 and TANGENT attributes are supported; bake vertex colors and additional UV sets.",
          );
        if (attrs.TEXCOORD_0 === undefined)
          fail(
            "Every primitive needs TEXCOORD_0 UVs for native shading. Unwrap the mesh before export.",
          );
        const p = accessor(attrs.POSITION, 3, "VEC3"),
          uv = accessor(attrs.TEXCOORD_0, 2, "VEC2"),
          vertexCount = p.length / 3;
        const ix =
          primitive.indices === undefined
            ? Array.from({ length: vertexCount }, (_, i) => i)
            : accessor(primitive.indices, 1, "SCALAR", true);
        if (uv.length !== vertexCount * 2 || ix.length % 3 || ix.some((i) => i >= vertexCount))
          fail("Mesh needs valid triangle indices and matching UVs.");
        if (
          positions.length / 3 + vertexCount > IMPORTED_LIMITS.vertices ||
          indices.length + ix.length > IMPORTED_LIMITS.triangles * 3
        )
          fail(
            "Scene exceeds 200,000 vertices or 100,000 triangles. Simplify the static mesh before export.",
          );
        if (determinant < 0)
          for (let at = 0; at < ix.length; at += 3)
            [ix[at + 1], ix[at + 2]] = [ix[at + 2], ix[at + 1]];
        const geo = new BufferGeometry();
        geo.setAttribute("position", new BufferAttribute(Float32Array.from(p), 3));
        geo.setIndex(ix);
        const original = attrs.NORMAL === undefined ? undefined : accessor(attrs.NORMAL, 3, "VEC3");
        if (original && original.length !== p.length)
          fail("Normals must match the position count.");
        if (original)
          geo.setAttribute("normal", new BufferAttribute(Float32Array.from(original), 3));
        geo.applyMatrix4(world);
        if (!original) geo.computeVertexNormals();
        // BufferGeometry applies the inverse-transpose normal matrix.
        const gp = geo.getAttribute("position"),
          gn = geo.getAttribute("normal");
        const offset = positions.length / 3,
          start = indices.length;
        for (let i = 0; i < vertexCount; i++) {
          positions.push(gp.getX(i), gp.getY(i), gp.getZ(i));
          normals.push(gn.getX(i), gn.getY(i), gn.getZ(i));
          uvs.push(uv[i * 2], uv[i * 2 + 1]);
        }
        for (const i of ix) indices.push(offset + i);
        geo.dispose();
        const sourceMaterial =
          primitive.material === undefined
            ? -1
            : integer(primitive.material, "material index", 0, sourceMaterials.length - 1);
        let material = materialIds.indexOf(sourceMaterial);
        if (material < 0) {
          material = materialIds.length;
          materialIds.push(sourceMaterial);
        }
        groups.push({ start, count: ix.length, material });
      }
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children) || node.children.length > 512)
        fail("Invalid node children.");
      const chain = new Set(ancestors).add(nodeIndex);
      for (const child of node.children) visit(child, world, chain);
    }
  };
  for (const node of scene.nodes) visit(node, new Matrix4(), new Set());
  if (!positions.length || !indices.length) fail("Default scene has no triangle geometry.");
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const a = i % 3;
    min[a] = Math.min(min[a], positions[i]);
    max[a] = Math.max(max[a], positions[i]);
  }
  const dimensionsM = max.map((v, a) => Math.max(0.001, v - min[a])) as Vec3;
  if (dimensionsM.some((n) => !Number.isFinite(n) || n > 100_000))
    fail("Model bounds exceed 100,000 metres or contain invalid transforms.");
  const geometry = normalizeStockClutterGeometry({ positions, normals, uvs, indices }, {
    geometry: { dimensionsM },
  } as ClutterType);
  let materialBytes = 0;
  const materials: ImportedClutterAsset["materials"] = [];
  for (const sourceId of materialIds) {
    const m = sourceId < 0 ? {} : sourceMaterials[sourceId],
      pbr = record(m.pbrMetallicRoughness ?? {}, "metallic-roughness material");
    if (m.alphaMode !== undefined && !["OPAQUE", "MASK"].includes(m.alphaMode))
      fail("BLEND transparency is unsupported. Export opaque or alpha-mask materials.");
    if (
      m.emissiveTexture ||
      (m.emissiveFactor && numbers(m.emissiveFactor, 3, "emissive factor").some((n) => n !== 0))
    )
      fail(
        "Emissive materials are unsupported by native clutter. Bake their colors into the base-color texture.",
      );
    if (m.doubleSided !== undefined && typeof m.doubleSided !== "boolean")
      fail("Material doubleSided must be a boolean.");
    const base = texture(pbr.baseColorTexture),
      mr = texture(pbr.metallicRoughnessTexture),
      ao = texture(m.occlusionTexture),
      normal = texture(m.normalTexture);
    const factor = numbers(pbr.baseColorFactor, 4, "base color factor", [1, 1, 1, 1]);
    if (factor.some((n) => n < 0 || n > 1)) fail("Base color factor must be in the 0–1 range.");
    const rough = unit(pbr.roughnessFactor, "roughness factor", 1),
      metal = unit(pbr.metallicFactor, "metallic factor", 1),
      strength = unit(m.occlusionTexture?.strength, "occlusion strength", 1),
      cutoff = unit(m.alphaCutoff, "alpha cutoff", 0.5);
    const normalScale = m.normalTexture?.scale ?? 1;
    if (
      typeof normalScale !== "number" ||
      !Number.isFinite(normalScale) ||
      normalScale < 0 ||
      normalScale > 10
    )
      fail("Normal texture scale must be 0–10.");
    const extent = Math.max(
      4,
      ...[base, mr, ao, normal]
        .filter((i): i is ImportedImage => !!i)
        .flatMap((i) => [i.width, i.height]),
    );
    const size = 2 ** Math.ceil(Math.log2(extent));
    materialBytes += size * size * 16;
    if (materialBytes > IMPORTED_LIMITS.materialBytes)
      fail(
        "Converted material channels exceed the 32 MB pixel budget. Reduce texture sizes or material count.",
      );
    const maps = {
      diffuse: new Uint8Array(size * size * 4),
      normal: new Uint8Array(size * size * 4),
      orm: new Uint8Array(size * size * 4),
      opacity: new Uint8Array(size * size * 4),
    };
    const cutout = m.alphaMode === "MASK";
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const at = (y * size + x) * 4,
          u = (x + 0.5) / size,
          v = (y + 0.5) / size;
        for (let c = 0; c < 3; c++)
          maps.diffuse[at + c] = byte(srgb(linear(sample(base, u, v, c)) * factor[c]));
        maps.diffuse[at + 3] = 255;
        maps.orm.set(
          [
            byte(1 + (sample(ao, u, v, 0) - 1) * strength),
            byte(sample(mr, u, v, 1) * rough),
            byte(sample(mr, u, v, 2) * metal),
            255,
          ],
          at,
        );
        const nx = normal ? (sample(normal, u, v, 0) * 2 - 1) * normalScale : 0,
          ny = normal ? (sample(normal, u, v, 1) * 2 - 1) * normalScale : 0,
          nz = normal ? sample(normal, u, v, 2) * 2 - 1 : 1,
          length = Math.hypot(nx, ny, nz) || 1;
        maps.normal.set(
          [
            byte((nx / length) * 0.5 + 0.5),
            byte((ny / length) * 0.5 + 0.5),
            byte((nz / length) * 0.5 + 0.5),
            255,
          ],
          at,
        );
        const alpha = !cutout || sample(base, u, v, 3) * factor[3] >= cutoff ? 255 : 0;
        maps.opacity.set([alpha, alpha, alpha, 255], at);
      }
    materials.push({
      name: typeof m.name === "string" ? m.name.slice(0, 160) : `Material ${materials.length + 1}`,
      size,
      diffuse: importedEncodeBytes(maps.diffuse),
      normal: importedEncodeBytes(maps.normal),
      orm: importedEncodeBytes(maps.orm),
      opacity: importedEncodeBytes(maps.opacity),
      cutout,
      doubleSided: m.doubleSided === true,
    });
  }
  const asset: ImportedClutterAsset = {
    version: 1,
    sourceName: sourceName.replace(/[\u0000-\u001f\ud800-\udfff]/gu, "").slice(0, 160),
    sourceBytes: bytes.length,
    dimensionsM,
    vertexCount: geometry.positions.length / 3,
    triangleCount: geometry.indices.length / 3,
    groups,
    materials,
    geometry: {
      positions: importedEncodeBytes(geometry.positions),
      normals: importedEncodeBytes(geometry.normals),
      uvs: importedEncodeBytes(geometry.uvs),
      tangents: importedEncodeBytes(geometry.tangents),
      indices: importedEncodeBytes(geometry.indices),
    },
  };
  const error = validateImportedAsset(asset);
  if (error) fail(error);
  return asset;
}

export function importedMaterialSize(type: ClutterType, index = 0): number {
  return type.importedAsset?.materials[index]?.size ?? 128;
}
export function importedUsesCutout(type: ClutterType, index?: number): boolean {
  return index === undefined
    ? !!type.importedAsset?.materials.some((m) => m.cutout)
    : !!type.importedAsset?.materials[index]?.cutout;
}
type GroupedGeometry = ClutterGeometry & { groups: ImportedClutterAsset["groups"] };
type MaterialPixels = {
  diffuse: Uint8Array;
  normal: Uint8Array;
  orm: Uint8Array;
  opacity: Uint8Array;
};
const geometryCache = new WeakMap<ImportedClutterAsset, { key: string; result: GroupedGeometry }>();
const materialCache = new WeakMap<
  ImportedClutterAsset,
  { key: string; results: Map<number, MaterialPixels> }
>();
export function getImportedGeometry(type: ClutterType, _lod = 0): GroupedGeometry {
  const asset = type.importedAsset;
  if (!asset) throw new Error("Clutter type has no imported geometry.");
  const key = type.geometry.dimensionsM.join(","),
    cached = geometryCache.get(asset);
  if (cached?.key === key) return cached.result;
  const result = {
    ...normalizeStockClutterGeometry(
      {
        positions: floatArray(asset.geometry.positions),
        normals: floatArray(asset.geometry.normals),
        uvs: floatArray(asset.geometry.uvs),
        tangents: floatArray(asset.geometry.tangents),
        indices: indexArray(asset.geometry.indices),
      },
      type,
    ),
    groups: asset.groups,
  };
  geometryCache.set(asset, { key, result });
  return result;
}
export function getImportedMaterialPixels(type: ClutterType, index = 0): MaterialPixels {
  const asset = type.importedAsset,
    material = asset?.materials[index];
  if (!material) throw new Error("Imported material is missing.");
  const key = [
    type.material.color,
    type.material.normalStrength,
    type.material.roughness,
    type.material.metalness,
  ].join(",");
  let cache = materialCache.get(asset!);
  if (!cache || cache.key !== key) {
    cache = { key, results: new Map() };
    materialCache.set(asset!, cache);
  }
  const cached = cache.results.get(index);
  if (cached) return cached;
  const diffuse = importedDecodeBytes(material.diffuse),
    normal = importedDecodeBytes(material.normal),
    orm = importedDecodeBytes(material.orm),
    opacity = importedDecodeBytes(material.opacity);
  const tint = parseColor(type.material.color).map(linear);
  for (let at = 0; at < diffuse.length; at += 4) {
    for (let c = 0; c < 3; c++)
      diffuse[at + c] = byte(srgb(linear(diffuse[at + c] / 255) * tint[c]));
    const nx = ((normal[at] / 255) * 2 - 1) * type.material.normalStrength,
      ny = ((normal[at + 1] / 255) * 2 - 1) * type.material.normalStrength,
      nz = (normal[at + 2] / 255) * 2 - 1,
      length = Math.hypot(nx, ny, nz) || 1;
    normal.set(
      [
        byte((nx / length) * 0.5 + 0.5),
        byte((ny / length) * 0.5 + 0.5),
        byte((nz / length) * 0.5 + 0.5),
        255,
      ],
      at,
    );
    orm[at + 1] = byte((orm[at + 1] / 255) * type.material.roughness);
    orm[at + 2] = byte((orm[at + 2] / 255) * type.material.metalness);
  }
  const result = { diffuse, normal, orm, opacity };
  cache.results.set(index, result);
  return result;
}
export const getImportedPixels = getImportedMaterialPixels;
export function importedMeshByteEstimate(type: ClutterType): number {
  const a = type.importedAsset;
  return a
    ? (Math.min(a.triangleCount * 3, a.vertexCount * a.materials.length) * 48 +
        a.triangleCount * 12) *
        5 +
        64 * 1024
    : 0;
}
export function importedAssetBytes(asset: ImportedClutterAsset) {
  return (
    Object.values(asset.geometry).reduce((sum, v) => sum + v.length, 0) +
    asset.materials.reduce(
      (sum, m) => sum + m.diffuse.length + m.normal.length + m.orm.length + m.opacity.length,
      0,
    )
  );
}
/** Validate project data as strictly as upload data; malformed present fields never migrate away. */
export function validateImportedAsset(value: unknown): string | undefined {
  try {
    const a = record(value, "imported asset");
    if (a.version !== 1) fail("Unsupported imported asset version.");
    if (
      typeof a.sourceName !== "string" ||
      a.sourceName.length > 160 ||
      /[\u0000-\u001f\ud800-\udfff]/u.test(a.sourceName)
    )
      fail("Imported source name is invalid.");
    integer(a.sourceBytes, "imported source size", 1, IMPORTED_LIMITS.fileBytes);
    const dimensions = numbers(a.dimensionsM, 3, "imported dimensions");
    if (dimensions.some((n) => n < 0.001 || n > 100_000))
      fail("Imported dimensions are out of range.");
    const vertices = integer(a.vertexCount, "imported vertex count", 3, IMPORTED_LIMITS.vertices),
      triangles = integer(a.triangleCount, "imported triangle count", 1, IMPORTED_LIMITS.triangles);
    const geometry = record(a.geometry, "imported geometry");
    const encoded = (v: unknown, bytes: number, label: string): string => {
      if (
        typeof v !== "string" ||
        v.length !== 4 * Math.ceil(bytes / 3) ||
        /[^A-Za-z0-9+/=]/.test(v) ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(v)
      )
        fail(`${label} has invalid base64 or byte count.`);
      const decoded = importedDecodeBytes(v as string);
      if (decoded.length !== bytes) fail(`${label} byte count differs from its declaration.`);
      return v as string;
    };
    for (const [key, components] of [
      ["positions", 3],
      ["normals", 3],
      ["uvs", 2],
      ["tangents", 4],
    ] as const) {
      const values = floatArray(
        encoded(geometry[key], vertices * components * 4, `imported ${key}`),
      );
      if (values.some((n) => !Number.isFinite(n)))
        fail(`Imported ${key} contain non-finite values.`);
    }
    const indices = indexArray(encoded(geometry.indices, triangles * 12, "imported indices"));
    if (indices.some((n) => n >= vertices)) fail("Imported indices exceed the vertex count.");
    const uvs = floatArray(geometry.uvs);
    for (let i = 0; i < indices.length; i += 3) {
      const x = indices[i] * 2,
        y = indices[i + 1] * 2,
        z = indices[i + 2] * 2,
        det =
          (uvs[y] - uvs[x]) * (uvs[z + 1] - uvs[x + 1]) -
          (uvs[z] - uvs[x]) * (uvs[y + 1] - uvs[x + 1]);
      if (!Number.isFinite(det) || Math.abs(det) <= 1e-10)
        fail(
          "Imported triangles need nonzero UV area for native shading; unwrap degenerate UV triangles before export.",
        );
    }
    const materials = list(a.materials, "imported materials", IMPORTED_LIMITS.materials);
    if (!materials.length) fail("Imported material list is empty.");
    let pixels = 0;
    for (const m of materials) {
      const size = integer(m.size, "imported material size", 4, IMPORTED_LIMITS.imageSide);
      if ((size & (size - 1)) !== 0) fail("Imported material size must be a power of two.");
      pixels += size * size * 16;
      if (pixels > IMPORTED_LIMITS.materialBytes)
        fail("Imported material pixel budget exceeds 32 MB.");
      if (
        typeof m.name !== "string" ||
        m.name.length > 160 ||
        /[\u0000-\u001f\ud800-\udfff]/u.test(m.name)
      )
        fail("Imported material name is invalid.");
      if (typeof m.cutout !== "boolean" || typeof m.doubleSided !== "boolean")
        fail("Imported material flags are malformed.");
      for (const key of ["diffuse", "normal", "orm", "opacity"])
        encoded(m[key], size * size * 4, `imported ${key}`);
    }
    const groups = list(a.groups, "imported primitive groups", IMPORTED_LIMITS.primitives);
    let cursor = 0;
    const used = new Set<number>();
    for (const g of groups) {
      if (g.start !== cursor)
        fail("Imported primitive groups must cover contiguous triangle indices.");
      const count = integer(g.count, "primitive index count", 3, indices.length);
      if (count % 3) fail("Imported primitive group contains incomplete triangles.");
      used.add(integer(g.material, "primitive material", 0, materials.length - 1));
      cursor += count;
    }
    if (cursor !== indices.length || used.size !== materials.length)
      fail("Imported primitive/material references are incomplete.");
  } catch (error) {
    return (error as Error).message.replace(/^GLB import: /, "");
  }
}
