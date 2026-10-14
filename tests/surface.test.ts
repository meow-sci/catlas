import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { read as readKtx2 } from "ktx-parse";
import { makePlanet, createProject } from "../src/lib/project";
import {
  defaultBiome,
  defaultClutter,
  encodeBiomeId,
  encodeBiomePixel,
  generateClutterGeometry,
  generateClutterPixels,
  generateTerrainPixels,
  normalizeStockClutterGeometry,
  sampleAltitudeDensity,
  sampleBiomeWeights,
} from "../src/lib/surface";
import {
  clutterAssetPaths,
  generateClutterGlb,
  generateSurfaceAssets,
  surfaceBiomesXml,
  surfaceClutterAssetsXml,
  surfaceClutterBodyXml,
  surfaceTerrainXml,
} from "../src/lib/surfaceExport";
import { cubeDirection, generateBodyAssets } from "../src/lib/assets";
import {
  authorToNativeDirection,
  compileSurfaceSampler,
  nativeLocationDirection,
  nativeToAuthorDirection,
  sampleSurface,
} from "../src/lib/procedural";
import type { ClutterType } from "../src/lib/types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
const list = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);
const glbJson = (data: Uint8Array) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + view.getUint32(12, true))));
};

describe("verified native surface semantics", () => {
  it("round trips every normalized native biome index and shader exponent", () => {
    for (let count = 1; count <= 32; count++)
      for (let index = 0; index < count; index++) {
        const encoded = encodeBiomeId(index, count);
        expect(Math.floor((encoded / 255) * count + 0.4)).toBe(index);
      }
    const pixel = encodeBiomePixel(
      { indices: [2, 1, 0, 0], weights: [0.65, 0.25, 0.1, 0], dominant: 2 },
      3,
      2.25,
    );
    const powered = pixel.controls.map((channel) => (channel / 255) ** 2.25),
      sum = powered.reduce((a, b) => a + b, 0);
    expect(powered.map((v) => v / sum)[0]).toBeCloseTo(0.65, 2);
    expect(pixel.ids.map((value) => Math.floor((value / 255) * 3 + 0.4))).toEqual([2, 1, 0, 0]);
    expect(() => encodeBiomeId(1, 1)).toThrow();
  });

  it("selects independent authored latitude and elevation regions with four normalized channels", () => {
    const body = makePlanet("test", "Test", "Sun");
    body.surface.biomes = [
      defaultBiome("Base", 1),
      { ...defaultBiome("Polar", 2), minLatitude: 65 },
      { ...defaultBiome("High", 3), minHeight: 0.7 },
    ];
    const equator = sampleBiomeWeights(body, [1, 0, 0], 0.4),
      polar = sampleBiomeWeights(body, [0.2, 1, 0.2], 0.4),
      high = sampleBiomeWeights(body, [1, 0, 0], 0.9);
    expect(equator.weights).toEqual([1, 0, 0, 0]);
    expect(polar.indices.slice(0, 2)).toEqual([0, 1]);
    expect(high.indices).toEqual(equator.indices); // Filtered weights keep permanent biome slots.
    expect(high.weights[2]).toBeGreaterThan(0);
    expect(high.weights[1]).toBe(0);
    expect(polar.dominant).toBe(1);
    expect(polar.weights[1]).toBe(1);
    expect(high.dominant).toBe(2);
    expect(polar.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    const compiled = compileSurfaceSampler(body);
    expect(compiled([1, 0, 0])).toEqual(sampleSurface(body, [1, 0, 0]));
  });

  it("generates categorical ID cubemaps and spatial control weights with meaningful material maps", async () => {
    const body = makePlanet("test", "Test", "Sun");
    body.surface.biomes = [
      defaultBiome("Base", 1),
      { ...defaultBiome("Polar", 2), minLatitude: 40 },
    ];
    const assets = await generateSurfaceAssets(body, 8),
      ids = readKtx2(assets.find((asset) => asset.path.endsWith("_Biome_ID.ktx2"))!.data),
      controls = readKtx2(assets.find((asset) => asset.path.endsWith("_Biome_Control.ktx2"))!.data);
    expect(ids.faceCount).toBe(6);
    for (const level of ids.levels)
      for (const channel of level.levelData) expect([0, 128]).toContain(channel);
    const center = (4 * 8 + 4) * 4;
    expect(ids.levels[0].levelData[4 * 8 * 8 * 4 + center + 1]).toBe(128); // +Z is native north.
    expect(controls.levels[0].levelData[4 * 8 * 8 * 4 + center + 1]).toBeGreaterThan(0);
    expect(controls.levels[0].levelData[2 * 8 * 8 * 4 + center + 1]).toBe(0); // +Y is equatorial.
    expect(new Set(controls.levels[0].levelData).size).toBeGreaterThan(3);
    expect(assets.filter((asset) => asset.path.endsWith(".png"))).toHaveLength(20 + 4);
    const material = body.surface.biomes[0].ground,
      maps = generateTerrainPixels(material, 32);
    expect(new Set(maps.normal.filter((_, index) => index % 4 < 2)).size).toBeGreaterThan(8);
    expect(new Set(maps.displacement.filter((_, index) => index % 4 === 0)).size).toBeGreaterThan(
      20,
    );
    expect(maps.height).toEqual(maps.displacement);
    expect(maps.normal).not.toEqual(
      generateTerrainPixels({ ...material, seed: material.seed + 1 }, 32).normal,
    );
  });

  it("rotates native +Z latitude into authoring +Y without changing handedness", () => {
    const native = nativeLocationDirection(90, 17);
    expect(native[2]).toBeCloseTo(1);
    expect(nativeToAuthorDirection(native)[1]).toBeCloseTo(1);
    const point = [0.3, -0.4, 0.7] as const;
    expect(authorToNativeDirection(nativeToAuthorDirection(point))).toEqual(point);
    expect(nativeToAuthorDirection(nativeLocationDirection(0, 90))[2]).toBeCloseTo(-1);
  });

  it("derives native tangent normals from the same physical height field across all six faces", async () => {
    const body = makePlanet("test", "Test", "Sun");
    body.radiusKm = 25;
    body.surface.elevation = 5;
    const assets = await generateBodyAssets(body, 8),
      heights = readKtx2(assets.find((asset) => asset.path === "Textures/test_Height.ktx2")!.data)
        .levels[0].levelData;
    const normal = readKtx2(
      assets.find((asset) => asset.path === "Textures/test_Normal.ktx2")!.data,
    ).levels[0].levelData;
    const sample = compileSurfaceSampler(body);
    for (let face = 0; face < 6; face++) {
      const at = face * 8 * 8 * 2 + (4 * 8 + 4) * 2;
      expect((heights[at] | (heights[at + 1] << 8)) / 65535).toBeCloseTo(
        sample(nativeToAuthorDirection(cubeDirection(face, 4, 4, 8))).height,
        4,
      );
    }
    expect(new Set(normal.filter((_, index) => index % 4 < 2)).size).toBeGreaterThan(20);
    body.surface.elevation = 0;
    const flat = await generateBodyAssets(body, 8),
      neutral = readKtx2(flat.find((asset) => asset.path === "Textures/test_Normal.ktx2")!.data)
        .levels[0].levelData;
    for (let at = 0; at < neutral.length; at += 4)
      expect(Array.from(neutral.subarray(at, at + 4))).toEqual([128, 128, 255, 255]);
  });

  it("authors six geometry families with five genuinely simplified LODs and metre bounds", () => {
    const type = defaultClutter(),
      signatures = new Set<string>();
    for (const shape of ["boulder", "pebble", "crystal", "grass", "shrub", "spire"] as const) {
      type.geometry.shape = shape;
      const counts: number[] = [];
      for (let lod = 0; lod < 5; lod++) {
        const geometry = generateClutterGeometry(type, lod);
        counts.push(geometry.indices.length);
        expect(geometry.indices.length % 3).toBe(0);
        expect(
          [...geometry.positions, ...geometry.normals, ...geometry.tangents].every(Number.isFinite),
        ).toBe(true);
        for (let at = 0; at < geometry.normals.length; at += 3) {
          const vertex = at / 3,
            n = Array.from(geometry.normals.subarray(at, at + 3)),
            t = Array.from(geometry.tangents.subarray(vertex * 4, vertex * 4 + 3));
          expect(Math.hypot(...n)).toBeCloseTo(1, 5);
          expect(n.reduce((sum, value, axis) => sum + value * t[axis], 0)).toBeCloseTo(0, 5);
        }
        for (let axis = 0; axis < 3; axis++) {
          const values = Array.from(geometry.positions).filter((_, index) => index % 3 === axis);
          expect(Math.max(...values) - Math.min(...values)).toBeCloseTo(
            type.geometry.dimensionsM[axis],
            5,
          );
        }
        if (lod === 0) signatures.add(Array.from(geometry.positions).join(","));
      }
      expect(counts[0]).toBeGreaterThan(counts[4]);
      expect(counts.every((count, index) => index === 0 || count <= counts[index - 1])).toBe(true);
    }
    expect(signatures.size).toBe(6);
    const detailCounts = [0, 1, 2, 3, 4].map(
      (detail) =>
        generateClutterGeometry({
          ...type,
          geometry: { ...type.geometry, shape: "boulder", detail },
        }).indices.length,
    );
    expect(new Set(detailCounts).size).toBe(5);
  });

  it("connects each native atlas, five LODs, material, ecotype and distribution to its own original assets", async () => {
    const project = createProject(),
      body = makePlanet("test", "Test", "Sun");
    body.surface.biomes = [defaultBiome("Base", 1), defaultBiome("Frost", 2)];
    body.clutter = Array.from({ length: 12 }, (_, index) => {
      const type = defaultClutter(`Type${index}`, index + 1);
      type.name = `Type ${index}`;
      type.distribution.biomeIds = [index % 2 ? "Frost" : "Base"];
      return type;
    });
    const biomes = parser.parse(
      `<Body>${surfaceBiomesXml(project, body, "").join("\n")}${surfaceTerrainXml(project, body, "").join("\n")}${surfaceClutterBodyXml(project, body, "").join("\n")}</Body>`,
    ).Body;
    const xml = `<Assets>${surfaceClutterAssetsXml(project, body).join("\n")}</Assets>`,
      catalog = parser.parse(xml).Assets;
    expect(list(biomes.Biomes.Biome).map((biome: any) => Number(biome.IdMapIndex))).toEqual([0, 1]);
    expect(
      list(biomes.Terrain.BiomeMaterials.BiomeMaterial).map((biome: any) => biome.Biome),
    ).toEqual(["Base", "Frost"]);
    expect(list(biomes.GroundClutter.Ecotype)).toHaveLength(12);
    const assets = await generateSurfaceAssets(body, 4),
      paths = new Set(assets.map((asset) => asset.path));
    for (const match of (
      xml +
      surfaceTerrainXml(project, body, "").join("\n") +
      surfaceClutterBodyXml(project, body, "").join("\n")
    ).matchAll(/\bPath="([^"]+)"/g))
      expect(paths.has(match[1]), match[1]).toBe(true);
    for (const object of list<any>(catalog.ClutterObject)) {
      const atlas = list<any>(catalog.MeshAtlas).find((entry) => entry.Id === object.Atlas);
      const data = assets.find((asset) => asset.path === atlas.Path)!.data,
        glb = glbJson(data),
        lods = list<any>(object.LODs.LOD);
      expect(lods).toHaveLength(5);
      expect(glb.meshes.map((mesh: any) => mesh.name)).toEqual(lods.map((lod) => lod.Mesh.Id));
      expect(glb.meshes.every((mesh: any) => mesh.primitives[0].material === 0)).toBe(true);
      expect(new Set(lods.map((lod) => lod.Material.Id)).size).toBe(1);
      const sizes = glb.meshes.map((mesh: any) => glb.accessors[mesh.primitives[0].indices].count);
      expect(sizes[0]).toBeGreaterThan(sizes[4]);
    }
    expect(assets.every((asset) => !asset.path.includes("Core/"))).toBe(true);
  });

  it("keeps distribution, geometry and material seeds independent and evaluates native altitude curves", () => {
    const type = defaultClutter(),
      before = generateClutterPixels(type, 32);
    const recolored: ClutterType = structuredClone(type);
    recolored.material.color = "#ff2200";
    expect(generateClutterPixels(recolored, 32).distribution).toEqual(before.distribution);
    expect(generateClutterPixels(recolored, 32).diffuse).not.toEqual(before.diffuse);
    const redistributed = structuredClone(type);
    redistributed.distribution.seed++;
    expect(generateClutterPixels(redistributed, 32).distribution).not.toEqual(before.distribution);
    expect(generateClutterPixels(redistributed, 32).diffuse).toEqual(before.diffuse);
    type.distribution.altitudeDensity = [
      { altitudeM: 0, density: 0 },
      { altitudeM: 1000, density: 1 },
    ];
    expect(sampleAltitudeDensity(type, 250)).toBeCloseTo(0.15625);
    expect(sampleAltitudeDensity(type, -20)).toBe(0);
    expect(sampleAltitudeDensity(type, 1500)).toBe(1);
  });

  it("rejects aliases and masks that native loaders cannot resolve", () => {
    const project = createProject(),
      body = makePlanet("test", "Test", "Sun");
    body.surface.biomes = [defaultBiome("same-id"), defaultBiome("same_id")];
    expect(() => surfaceBiomesXml(project, body, "")).toThrow(/unique/);
    body.surface.biomes = [defaultBiome("Base")];
    body.clutter = [defaultClutter()];
    body.clutter[0].distribution.biomeIds = ["missing"];
    expect(() => surfaceClutterBodyXml(project, body, "")).toThrow(/unknown biome/);
    body.clutter[0].material.opacity = true;
    expect(surfaceClutterAssetsXml(project, body).join("\n")).toContain("<Opacity");
    const glb = glbJson(generateClutterGlb(body, body.clutter[0]));
    expect(glb.meshes.map((mesh: any) => mesh.name)).toEqual(
      clutterAssetPaths(body, body.clutter[0]).meshes,
    );
  });

  it("preserves native detail fade ordering and inherited constant altitude density", () => {
    const project = createProject(),
      body = makePlanet("test", "Test", "Sun");
    expect(body.surface.detailFadeStartM).toBeGreaterThan(body.surface.detailFadeEndM);
    body.surface.detailFadeStartM = 100;
    body.surface.detailFadeEndM = 200;
    expect(() => surfaceTerrainXml(project, body, "")).toThrow(/greater/);
    body.clutter[0].distribution.altitudeDensity = [];
    expect(surfaceClutterBodyXml(project, body, "").join("\n")).not.toContain(
      "AltitudeDensityCurve",
    );
    expect(sampleAltitudeDensity(body.clutter[0], 1000)).toBe(1);
  });

  it("preserves authored stock mesh UVs and normal directions under nonuniform metre scaling", () => {
    const type = defaultClutter(),
      mesh = normalizeStockClutterGeometry(
        {
          positions: [0, 0, 0, 1, 1, 0, 0, 1, 1],
          indices: [0, 1, 2],
          normals: [-1, 1, -1, -1, 1, -1, -1, 1, -1],
          uvs: [0, 0, 1, 0, 0, 1],
        },
        type,
      );
    expect(Array.from(mesh.uvs)).toEqual([0, 0, 1, 0, 0, 1]);
    for (let axis = 0; axis < 3; axis++) {
      const values = Array.from(mesh.positions).filter((_, index) => index % 3 === axis);
      expect(Math.max(...values) - Math.min(...values)).toBeCloseTo(
        type.geometry.dimensionsM[axis],
      );
    }
    expect(mesh.normals[0] / mesh.normals[1]).toBeCloseTo(
      -type.geometry.dimensionsM[1] / type.geometry.dimensionsM[0],
    );
    expect(Math.hypot(...mesh.normals.subarray(0, 3))).toBeCloseTo(1);
    expect(() =>
      normalizeStockClutterGeometry({ positions: [0, 0, 0], indices: [0, 1, 2] }, type),
    ).toThrow(/indices/);
  });
});
