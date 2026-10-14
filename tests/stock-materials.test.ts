import { describe, expect, it } from "vitest";
import {
  decodeStockMesh,
  getStockMesh,
  getStockPixels,
  STOCK_ASSETS,
  STOCK_TEXTURE_SIZE,
  stockScatterLod,
  type PackedStockMesh,
} from "../src/lib/stock-assets";
import {
  defaultClutter,
  generateClutterPixels,
  normalizeStockClutterGeometry,
} from "../src/lib/surface";

function triangle(indexBits: 16 | 32 = 16): PackedStockMesh {
  const bytes = new Uint8Array(3 * 16 + (3 * indexBits) / 8),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < 3; i++) {
    view.setUint16(i * 16, i === 1 ? 65535 : 0, true);
    view.setUint16(i * 16 + 4, i === 2 ? 65535 : 0, true);
    view.setInt16(i * 16 + 8, 32767, true);
    view.setUint16(i * 16 + 12, i === 1 ? 65535 : 0, true);
    view.setUint16(i * 16 + 14, i === 2 ? 65535 : 0, true);
    if (indexBits === 16) view.setUint16(48 + i * 2, i, true);
    else view.setUint32(48 + i * 4, i, true);
  }
  return {
    vertexCount: 3,
    indexCount: 3,
    indexBits,
    min: [-2, 0, -4],
    max: [2, 0, 4],
    data: Buffer.from(bytes).toString("base64"),
  };
}

describe("compact stock geometry", () => {
  it("decodes explicit little-endian quantized records with both index widths", () => {
    for (const bits of [16, 32] as const) {
      const mesh = decodeStockMesh(triangle(bits));
      expect(Array.from(mesh.positions)).toEqual([-2, 0, -4, 2, 0, -4, -2, 0, 4]);
      expect(Array.from(mesh.normals)).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
      expect(Array.from(mesh.uvs)).toEqual([0, 0, 1, 0, 0, 1]);
      expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
      expect(mesh.indices.BYTES_PER_ELEMENT).toBe(bits / 8);
    }
    expect(getStockMesh(STOCK_ASSETS[0].id, 0)).toBe(getStockMesh(STOCK_ASSETS[0].id, 0));
    expect(() => getStockMesh(STOCK_ASSETS[0].id, 5)).toThrow(/LOD/);
  });

  it("rejects corrupt payload length, invalid normals and out-of-range indices", () => {
    const source = triangle();
    expect(() => decodeStockMesh({ ...source, vertexCount: 4 })).toThrow(/length/);
    expect(() => decodeStockMesh({ ...source, min: [NaN, 0, 0] })).toThrow(/metadata/);
    const bytes = Buffer.from(source.data, "base64");
    bytes.writeUInt16LE(5, 48);
    expect(() => decodeStockMesh({ ...source, data: bytes.toString("base64") })).toThrow(/index/);
    bytes.writeUInt16LE(0, 48);
    bytes.writeInt16LE(0, 8);
    expect(() => decodeStockMesh({ ...source, data: bytes.toString("base64") })).toThrow(/normal/);
  });

  it("derives tangent direction and handedness from UVs after nonuniform scaling", () => {
    const type = defaultClutter();
    type.geometry.dimensionsM = [6, 2, 3];
    const source = decodeStockMesh(triangle()),
      geometry = normalizeStockClutterGeometry(source, type);
    for (let i = 0; i < 3; i++) {
      expect(Array.from(geometry.tangents.subarray(i * 4, i * 4 + 4))).toEqual([1, 0, 0, -1]);
    }
    source.uvs[2] = -1;
    const mirrored = normalizeStockClutterGeometry(source, type);
    expect(Array.from(mirrored.tangents.subarray(0, 4))).toEqual([-1, 0, 0, 1]);
  });

  it("uses simpler foliage for distant or crowded terrain previews", () => {
    for (const id of ["wind_pine", "umbrella_tree"]) {
      expect(stockScatterLod(id, 200, 1)).toBe(1);
      expect(stockScatterLod(id, 8, 1)).toBe(4);
      const crowded = stockScatterLod(id, 200, 256);
      expect(crowded).toBeGreaterThan(1);
      expect((getStockMesh(id, crowded).indices.length / 3) * 256).toBeLessThanOrEqual(600_000);
    }
    expect(stockScatterLod(undefined, 8, 256)).toBe(1);
  });
});

describe("original stock surface atlases", () => {
  const material = { ...defaultClutter().material, color: "#ffffff", secondaryColor: "#ffffff" };

  it("contains varied opaque surface color, roughness and normalized tangent relief in every semantic tile", () => {
    for (const asset of STOCK_ASSETS) {
      const size = 64,
        pixels = getStockPixels(asset.id, size, material, 79);
      for (let slot = 0; slot < 8; slot++) {
        const colors = new Set<string>(),
          roughness = new Set<number>();
        let normalVariation = 0;
        for (let y = 3; y < size / 2 - 3; y++)
          for (let x = 3; x < size / 4 - 3; x++) {
            const at = ((((slot >> 2) * size) / 2 + y) * size + ((slot % 4) * size) / 4 + x) * 4;
            colors.add(Array.from(pixels.diffuse.subarray(at, at + 3)).join(","));
            roughness.add(pixels.orm[at + 1]);
            expect(pixels.diffuse[at + 3]).toBe(255);
            const normal = Array.from(
              pixels.normal.subarray(at, at + 3),
              (value) => (value / 255) * 2 - 1,
            );
            expect(Math.abs(Math.hypot(...normal) - 1)).toBeLessThan(Math.sqrt(3) / 255);
            normalVariation +=
              Math.abs(pixels.normal[at] - 128) + Math.abs(pixels.normal[at + 1] - 128);
          }
        expect(colors.size, `${asset.id} slot ${slot} color`).toBeGreaterThan(15);
        expect(roughness.size, `${asset.id} slot ${slot} roughness`).toBeGreaterThan(6);
        expect(normalVariation, `${asset.id} slot ${slot} relief`).toBeGreaterThan(30);
      }
    }
  });

  it("caches material maps independently of placement and keeps placement resolution separate", () => {
    const type = defaultClutter("Pine", 19, "#ffffff");
    type.stockAssetId = "wind_pine";
    type.material = material;
    const before = generateClutterPixels(type, STOCK_TEXTURE_SIZE, 32);
    type.distribution.density = 0.08;
    const after = generateClutterPixels(type, STOCK_TEXTURE_SIZE, 32);
    expect(before.diffuse.length).toBe(512 * 512 * 4);
    expect(before.distribution.length).toBe(32 * 32 * 4);
    expect(before.opacity.length).toBe(512 * 512 * 4);
    expect(after.diffuse).toBe(before.diffuse);
    expect(after.normal).toBe(before.normal);
    expect(after.opacity).toBe(before.opacity);
    expect(after.distribution).not.toEqual(before.distribution);
    expect(getStockPixels(type.stockAssetId, 512, material, 20).diffuse).not.toEqual(
      before.diffuse,
    );
    const flat = getStockPixels(type.stockAssetId, 64, { ...material, normalStrength: 0 }, 19);
    for (let at = 0; at < flat.normal.length; at += 4)
      expect(Array.from(flat.normal.subarray(at, at + 4))).toEqual([128, 128, 255, 255]);
  });

  it("keeps bark opaque and foliage silhouettes well covered with open gaps", () => {
    for (const id of STOCK_ASSETS.filter((asset) => asset.cutout).map((asset) => asset.id)) {
      const mask = getStockPixels(id, 512, material, 1).opacity!;
      for (let slot = 0; slot < 8; slot++) {
        let filled = 0;
        for (let y = 0; y < 256; y++)
          for (let x = 0; x < 128; x++) {
            const at = (((slot >> 2) * 256 + y) * 512 + (slot % 4) * 128 + x) * 4;
            if (mask[at] >= 102) filled++;
          }
        const fraction = filled / (128 * 256);
        if (slot >= 1 && slot <= 4) {
          expect(fraction).toBeGreaterThan(0.22);
          expect(fraction).toBeLessThan(0.6);
        } else expect(fraction).toBe(1);
      }
    }
  });

  it("generates continuous native thickness for all four ground-cover styles", () => {
    const groundcover = STOCK_ASSETS.filter((asset) => asset.category === "groundcover");
    expect(groundcover).toHaveLength(4);
    for (const asset of groundcover) {
      const pixels = getStockPixels(asset.id, 64, material, 1);
      expect(pixels.thickness?.length).toBe(64 * 64 * 4);
      const red = pixels.thickness!.filter((_, at) => at % 4 === 0);
      expect(Math.min(...red)).toBeGreaterThan(0);
      expect(Math.max(...red)).toBeLessThan(255);
      expect(new Set(red).size).toBeGreaterThan(20);
    }
  });
});
