import { encodePng } from "../../src/lib/assets";

/** Two textured primitives, distinct PBR factors/alpha flags and a mirrored nonuniform parent transform. */
export async function importedClutterFixture(
  mutate?: (json: Record<string, any>) => void,
  side = 4,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [],
    views: Record<string, number>[] = [],
    accessors: Record<string, unknown>[] = [];
  let length = 0;
  const append = (data: Uint8Array) => {
    const at = views.length,
      padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
    padded.set(data);
    views.push({ buffer: 0, byteOffset: length, byteLength: data.length });
    chunks.push(padded);
    length += padded.length;
    return at;
  };
  const attr = (values: number[], components: number, indices = false) => {
    const array = indices ? Uint16Array.from(values) : Float32Array.from(values),
      bufferView = append(new Uint8Array(array.buffer));
    const index = accessors.length;
    accessors.push({
      bufferView,
      componentType: indices ? 5123 : 5126,
      count: values.length / components,
      type: components === 1 ? "SCALAR" : `VEC${components}`,
    });
    return index;
  };
  const primitives = [0, 1].map((material) => ({
    attributes: {
      POSITION: attr([0, 0, material, 1, 0, material, 0, 1, material], 3),
      NORMAL: attr([0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
      TEXCOORD_0: attr([0, 0, 1, 0, 0, 1], 2),
    },
    indices: attr([0, 1, 2], 1, true),
    material,
    mode: 4,
  }));
  const base = new Uint8Array(side * side * 4),
    mr = new Uint8Array(side * side * 4),
    ao = new Uint8Array(side * side * 4),
    normal = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const at = (y * side + x) * 4;
      base.set(
        y < side / 2
          ? [255, 32, 16, x < side / 2 ? 64 : 220]
          : [16, 48, 255, x < side / 2 ? 220 : 64],
        at,
      );
      mr.set([255, 64, 128, 255], at);
      ao.set([128, 128, 128, 255], at);
      normal.set([255, 128, 255, 255], at);
    }
  const images = [];
  for (const pixels of [base, mr, ao, normal])
    images.push({ bufferView: append(await encodePng(side, side, pixels)), mimeType: "image/png" });
  const json: Record<string, any> = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ translation: [10, 4, -3], scale: [-2, 3, 4], children: [1] }, { mesh: 0 }],
    meshes: [{ primitives }],
    materials: [
      {
        name: "Paint",
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
      },
      {
        name: "Cutout alloy",
        alphaMode: "MASK",
        alphaCutoff: 0.65,
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          baseColorFactor: [0.5, 0.75, 1, 1],
          metallicRoughnessTexture: { index: 1 },
          roughnessFactor: 0.25,
          metallicFactor: 0.5,
        },
        occlusionTexture: { index: 2, strength: 0.5 },
        normalTexture: { index: 3, scale: 0.5 },
      },
    ],
    images,
    textures: images.map((_, source) => ({ source })),
    buffers: [{ byteLength: length }],
    bufferViews: views,
    accessors,
  };
  mutate?.(json);
  const encoded = new TextEncoder().encode(JSON.stringify(json)),
    jsonLength = Math.ceil(encoded.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + length),
    view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + jsonLength);
  out.set(encoded, 20);
  view.setUint32(20 + jsonLength, length, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  let at = 28 + jsonLength;
  for (const data of chunks) {
    out.set(data, at);
    at += data.length;
  }
  return out;
}
export function fixtureGlbJson(bytes: Uint8Array): Record<string, any> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
}
