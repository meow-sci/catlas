import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { createProject, makePlanet } from "../src/lib/project";
import { defaultClutter, generateClutterGeometry, generateClutterPixels } from "../src/lib/surface";
import {
  clutterAssetPaths,
  generateClutterGlb,
  generateSurfaceAssets,
  surfaceClutterAssetsXml,
} from "../src/lib/surfaceExport";
import {
  getStockMesh,
  getStockPixels,
  STOCK_ASSETS,
  STOCK_TEXTURE_SIZE,
} from "../src/lib/stock-assets";

const expectedIds = [
  "basalt_spires",
  "layered_sandstone",
  "glacial_shard",
  "wind_pine",
  "umbrella_tree",
  "alien_lantern",
  "ribbon_fern",
  "coral_fan",
  "river_boulder",
  "talus_cluster",
  "desert_arch",
  "lava_pebble",
  "giant_redwood",
  "dwarf_juniper",
  "silver_birch",
  "fan_palm",
  "spiral_succulent",
  "trumpet_fungus",
  "sail_pod",
  "glass_urchin",
  "shell_grazer",
  "meadow_grass",
  "dry_bunchgrass",
  "alien_ribbon_grass",
  "alien_spore_mat",
];
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
const list = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);
const digest = (...arrays: ArrayBufferView[]) => {
  const hash = createHash("sha256");
  for (const array of arrays)
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  return hash.digest("hex");
};
const glbJson = (data: Uint8Array) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + view.getUint32(12, true))));
};

describe("original Blender stock clutter", () => {
  it("ships a varied original rock, tree and alien library with five distinct native LODs", () => {
    expect(STOCK_ASSETS.map((asset) => asset.id).sort()).toEqual([...expectedIds].sort());
    for (const id of expectedIds) {
      const counts: number[] = [],
        signatures = new Set<string>();
      for (let lod = 0; lod < 5; lod++) {
        const source = getStockMesh(id, lod);
        expect(source.positions.length).toBeGreaterThan(0);
        expect(source.positions.length % 3).toBe(0);
        expect(source.indices.length).toBeGreaterThan(0);
        expect(source.indices.length % 3).toBe(0);
        expect(source.normals.length).toBe(source.positions.length);
        expect(source.uvs.length).toBe((source.positions.length / 3) * 2);
        expect(source.positions.every(Number.isFinite)).toBe(true);
        expect(
          source.indices.every(
            (index) => Number.isInteger(index) && index >= 0 && index < source.positions.length / 3,
          ),
        ).toBe(true);
        counts.push(source.indices.length);
        signatures.add(digest(source.positions, source.indices));
      }
      expect(signatures.size, id).toBe(5);
      expect(counts[0], id).toBeGreaterThan(counts[4]);
      expect(
        counts.every((count, index) => index === 0 || count <= counts[index - 1]),
        id,
      ).toBe(true);
    }
    expect(() => getStockMesh("missing-model", 0)).toThrow();
  });

  it("includes ground-cover, canopy and giant scales for mixed biomes", () => {
    const heights = STOCK_ASSETS.filter((asset) => asset.category === "tree").map(
      (asset) => asset.dimensionsM[1],
    );
    expect(Math.min(...heights)).toBeLessThan(2.5);
    expect(Math.max(...heights)).toBeGreaterThan(30);
    const stones = STOCK_ASSETS.filter((asset) => asset.category === "rock").map((asset) =>
      Math.max(...asset.dimensionsM),
    );
    expect(Math.min(...stones)).toBeLessThan(0.6);
    expect(Math.max(...stones)).toBeGreaterThan(5);
  });

  it("preserves surface atlas UVs, authored stock topology and editable metre dimensions", () => {
    for (const id of expectedIds) {
      const type = defaultClutter("Stock");
      type.stockAssetId = id;
      type.geometry.dimensionsM = [3, 5, 2];
      for (let lod = 0; lod < 5; lod++) {
        const source = getStockMesh(id, lod),
          geometry = generateClutterGeometry(type, lod);
        // Comparing byte hashes avoids enumerating millions of typed-array properties.
        expect(digest(geometry.indices), `${id} LOD${lod} indices`).toBe(
          digest(Uint32Array.from(source.indices)),
        );
        expect(digest(geometry.uvs), `${id} LOD${lod} UVs`).toBe(digest(source.uvs));
        expect(
          geometry.uvs.every((value) => value > 0 && value < 1),
          `${id} LOD${lod} atlas border inset`,
        ).toBe(true);
        let minimumUvArea = Infinity,
          crossingTriangles = 0;
        for (let at = 0; at < geometry.indices.length; at += 3) {
          const corners = [0, 1, 2].map((corner) => {
            const index = geometry.indices[at + corner];
            return [geometry.uvs[index * 2], geometry.uvs[index * 2 + 1]];
          });
          const [a, b, c] = corners,
            area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
          minimumUvArea = Math.min(minimumUvArea, Math.abs(area));
          if (
            new Set(corners.map((uv) => Math.floor(uv[0] * 4) + 4 * Math.floor(uv[1] * 2))).size !==
            1
          )
            crossingTriangles++;
        }
        expect(minimumUvArea, `${id} LOD${lod} native cotangent frame`).toBeGreaterThan(1e-10);
        expect(crossingTriangles, `${id} LOD${lod} triangles crossing atlas tiles`).toBe(0);
        for (let axis = 0; axis < 3; axis++) {
          let minimum = Infinity,
            maximum = -Infinity;
          for (let at = axis; at < geometry.positions.length; at += 3) {
            minimum = Math.min(minimum, geometry.positions[at]);
            maximum = Math.max(maximum, geometry.positions[at]);
          }
          expect(maximum - minimum).toBeCloseTo(type.geometry.dimensionsM[axis], 4);
        }
        let normalError = 0;
        for (let at = 0; at < geometry.normals.length; at += 3)
          normalError = Math.max(
            normalError,
            Math.abs(Math.hypot(...geometry.normals.subarray(at, at + 3)) - 1),
          );
        expect(normalError, `${id} LOD${lod} unit normals`).toBeLessThan(0.00005);
      }
    }
  });

  it("uses each stock palette atlas while preserving independent generated distribution and opacity", () => {
    const type = defaultClutter("Tree", 53, "#ffffff");
    type.stockAssetId = "wind_pine";
    const pixels = generateClutterPixels(type, 64),
      stock = getStockPixels("wind_pine", 64, type.material, type.seed);
    expect(pixels.diffuse).toEqual(stock.diffuse);
    expect(pixels.normal).toEqual(stock.normal);
    expect(pixels.orm).toEqual(stock.orm);
    const swatches = new Set<string>();
    for (let swatch = 0; swatch < 8; swatch++) {
      const at = ((Math.floor(swatch / 4) * 32 + 16) * 64 + (swatch % 4) * 16 + 8) * 4;
      swatches.add(Array.from(pixels.diffuse.subarray(at, at + 3)).join(","));
    }
    expect(swatches.size).toBeGreaterThan(3);
    const procedural = generateClutterPixels({ ...type, stockAssetId: undefined }, 64);
    expect(pixels.distribution).toEqual(procedural.distribution);
    expect(pixels.opacity).toEqual(stock.opacity);
    expect(pixels.opacity).not.toEqual(procedural.opacity);
    expect(pixels.diffuse).not.toEqual(procedural.diffuse);
    const tinted = generateClutterPixels(
      { ...type, material: { ...type.material, color: "#ff2200" } },
      64,
    );
    expect(tinted.diffuse).not.toEqual(pixels.diffuse);
    expect(tinted.distribution).toEqual(pixels.distribution);
  });

  it("packages all stock models as independent self-contained native atlases and five LOD references", async () => {
    const project = createProject(),
      body = makePlanet("StockWorld", "Stock World", "Sun");
    body.clutter = expectedIds.map((id, index) => {
      const type = defaultClutter(`Type${index}`, index + 1, "#ffffff");
      type.stockAssetId = id;
      return type;
    });
    const assets = await generateSurfaceAssets(body, 4),
      catalog = parser.parse(
        `<Assets>${surfaceClutterAssetsXml(project, body).join("\n")}</Assets>`,
      ).Assets;
    expect(list(catalog.MeshAtlas)).toHaveLength(expectedIds.length);
    for (const [index, object] of list<any>(catalog.ClutterObject).entries()) {
      const paths = clutterAssetPaths(body, body.clutter[index]),
        model = assets.find((asset) => asset.path === paths.model);
      expect(model, paths.model).toBeDefined();
      const glb = glbJson(model!.data),
        lods = list<any>(object.LODs.LOD);
      expect(lods).toHaveLength(5);
      expect(glb.meshes.map((mesh: any) => mesh.name)).toEqual(paths.meshes);
      expect(lods.map((lod) => lod.Mesh.Id)).toEqual(paths.meshes);
      expect(
        glb.meshes.map((mesh: any) => glb.accessors[mesh.primitives[0].indices].count),
      ).toEqual([0, 1, 2, 3, 4].map((lod) => getStockMesh(expectedIds[index], lod).indices.length));
      expect(digest(generateClutterGlb(body, body.clutter[index]))).toBe(digest(model!.data));
      const foliage = STOCK_ASSETS.find((asset) => asset.id === expectedIds[index])!.cutout;
      const groundcover =
        STOCK_ASSETS.find((asset) => asset.id === expectedIds[index])!.category === "groundcover";
      if (foliage) {
        const material = list<any>(catalog.GroundClutterMaterial)[index];
        expect(material.Opacity.Path).toBe(paths.opacity);
        expect(Number(material.AlphaCutoff.Value)).toBe(0.4);
        expect(String(material.DoubleSided.Value)).toBe("true");
      }
      if (groundcover) {
        const material = list<any>(catalog.GroundClutterMaterial)[index];
        expect(material.Thickness.Path).toBe(paths.thickness);
        expect(String(material.BiasNormalsUp.Value)).toBe("true");
        expect(String(material.ApplyExtraSpec.Value)).toBe("true");
        expect(String(material.DistanceFadeDither.Value)).toBe("true");
        expect(String(material.DoubleSided.Value)).toBe("true");
        expect(String(material.CastShadows.Value)).toBe("false");
      }
      for (const path of [
        paths.diffuse,
        paths.normal,
        paths.orm,
        ...(foliage ? [paths.opacity] : []),
        ...(groundcover ? [paths.thickness] : []),
      ]) {
        const png = assets.find((asset) => asset.path === path)!.data;
        const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
        expect(view.getUint32(16), path).toBe(STOCK_TEXTURE_SIZE);
        expect(view.getUint32(20), path).toBe(STOCK_TEXTURE_SIZE);
      }
      const distribution = assets.find((asset) => asset.path === paths.distribution)!.data;
      expect(new DataView(distribution.buffer, distribution.byteOffset).getUint32(16)).toBe(64);
    }
    const filePaths = new Set(assets.map((asset) => asset.path));
    for (const match of surfaceClutterAssetsXml(project, body)
      .join("\n")
      .matchAll(/\bPath="([^"]+)"/g))
      expect(filePaths.has(match[1]), match[1]).toBe(true);
    expect(assets.every((asset) => !asset.path.includes("Core/"))).toBe(true);
  }, 20000);
});
