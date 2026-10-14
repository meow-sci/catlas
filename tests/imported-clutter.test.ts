import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import {
  importClutterGlb,
  getImportedGeometry,
  getImportedMaterialPixels,
  importedEncodeBytes,
  importedUsesCutout,
  importedAssetBytes,
  importedImageDimensions,
  validateImportedAsset,
  IMPORTED_LIMITS,
  type ImportedImageDecoder,
} from "../src/lib/imported-clutter";
import {
  createProject,
  cloneProjectForEdit,
  importedProjectBytes,
  importedProjectBudgetError,
  makePlanet,
  makeStar,
  parseProject,
  validateProject,
} from "../src/lib/project";
import { defaultBiome, defaultClutter, generateClutterGeometry } from "../src/lib/surface";
import {
  clutterAssetPaths,
  importedClutterMaterialPaths,
  generateClutterGlb,
  surfaceClutterAssetsXml,
} from "../src/lib/surfaceExport";
import { exportMod } from "../src/lib/export";
import { estimateExportBytes } from "../src/lib/exportBudget";
import { importedClutterFixture, fixtureGlbJson } from "./fixtures/imported-clutter";

const pngDecode: ImportedImageDecoder = async (bytes, mime) => {
  expect(mime).toBe("image/png");
  const [width, height] = importedImageDimensions(bytes, mime),
    chunks: Uint8Array[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at < bytes.length;) {
    const size = view.getUint32(at),
      type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8));
    if (type === "IDAT") chunks.push(bytes.subarray(at + 8, at + 8 + size));
    at += size + 12;
  }
  const decoded = inflateSync(Buffer.concat(chunks)),
    pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(decoded[y * (width * 4 + 1)]).toBe(0);
    pixels.set(decoded.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, pixels };
};
async function typeFixture(mutate?: (json: Record<string, any>) => void) {
  const type = defaultClutter("Imported");
  type.importedAsset = await importClutterGlb(
    await importedClutterFixture(mutate),
    "two-materials.glb",
    pngDecode,
  );
  type.geometry.dimensionsM = [...type.importedAsset.dimensionsM];
  Object.assign(type.material, {
    color: "#ffffff",
    secondaryColor: "#ffffff",
    roughness: 1,
    metalness: 1,
    normalStrength: 1,
    opacity: false,
    doubleSided: false,
    useTerrainMask: false,
  });
  return type;
}
const hash = (array: Uint8Array) => createHash("sha256").update(array).digest("hex");

describe("self-contained imported GLB clutter", () => {
  it("bakes mirrored parent transforms in authored metres and keeps both primitive/material bindings at every LOD", async () => {
    const type = await typeFixture(),
      asset = type.importedAsset!,
      mesh = getImportedGeometry(type),
      body = makePlanet("World", "World", "Sun");
    expect(asset.dimensionsM).toEqual([2, 3, 4]);
    expect(asset.vertexCount).toBe(6);
    expect(asset.triangleCount).toBe(2);
    expect(asset.groups).toEqual([
      { start: 0, count: 3, material: 0 },
      { start: 3, count: 3, material: 1 },
    ]);
    expect(Array.from(mesh.indices)).toEqual([0, 2, 1, 3, 5, 4]);
    expect(Math.min(...Array.from(mesh.positions).filter((_, i) => i % 3 === 1))).toBe(0);
    for (let at = 0; at < mesh.normals.length; at += 3) {
      expect(mesh.normals[at]).toBeCloseTo(0);
      expect(mesh.normals[at + 1]).toBeCloseTo(0);
      expect(mesh.normals[at + 2]).toBeCloseTo(1);
    }
    for (let lod = 0; lod < 5; lod++) expect(getImportedGeometry(type, lod)).toBe(mesh);
    const glb = fixtureGlbJson(generateClutterGlb(body, type));
    expect(glb.meshes.map((m: any) => m.name)).toEqual(clutterAssetPaths(body, type).meshes);
    for (const lod of glb.meshes) {
      expect(lod.primitives.map((p: any) => p.material)).toEqual([0, 1]);
      expect(lod.primitives.map((p: any) => glb.accessors[p.indices].count)).toEqual([3, 3]);
      expect(lod.primitives.map((p: any) => glb.accessors[p.attributes.POSITION].count)).toEqual([
        3, 3,
      ]);
    }
    body.clutter = [type];
    const xml = surfaceClutterAssetsXml(createProject(), body).join("\n");
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(
      `<Assets>${xml}</Assets>`,
    ).Assets;
    expect(parsed.GroundClutterMaterial).toHaveLength(2);
    for (const lod of parsed.ClutterObject.LODs.LOD)
      expect(lod.Material.map((m: any) => m.Id)).toEqual([
        "OrbitFoundry_World_Clutter_Imported_Material0",
        "OrbitFoundry_World_Clutter_Imported_Material1",
      ]);
    type.geometry.dimensionsM = [4, 6, 8];
    const resized = getImportedGeometry(type);
    expect(resized).not.toBe(mesh);
    expect(resized.positions[1]).toBe(0);
  });
  it("preserves texture row orientation, linear base-color factors, packed ORM, normals and each material's source mask threshold", async () => {
    const type = await typeFixture(),
      first = getImportedMaterialPixels(type, 0),
      second = getImportedMaterialPixels(type, 1);
    expect(Array.from(first.diffuse.subarray(0, 4))).toEqual([255, 32, 16, 255]);
    expect(Array.from(first.diffuse.subarray(3 * 4 * 4, 3 * 4 * 4 + 4))).toEqual([
      16, 48, 255, 255,
    ]);
    expect(second.diffuse[0]).toBe(188); // Linear .5 factor, re-encoded to sRGB.
    expect(Array.from(second.orm.subarray(0, 4))).toEqual([192, 16, 64, 255]);
    expect(second.normal[0]).toBeGreaterThan(180);
    expect(second.normal[0]).toBeLessThan(190);
    expect(Array.from(second.opacity.subarray(0, 4))).toEqual([0, 0, 0, 255]);
    expect(second.opacity[2 * 4]).toBe(255);
    expect(first.opacity[0]).toBe(255);
    expect(importedUsesCutout(type)).toBe(true);
    expect(importedUsesCutout(type, 0)).toBe(false);
    expect(getImportedMaterialPixels(type, 1)).toBe(second);
    type.material.roughness = 0.5;
    expect(getImportedMaterialPixels(type, 1).orm[1]).toBe(8);
  });
  it("round-trips model and texture data through project JSON and a fully closed native archive", async () => {
    const type = await typeFixture(),
      project = createProject(),
      body = makePlanet("World", "World", "Sun");
    project.systems = [
      {
        id: "System",
        name: "System",
        description: "",
        position: [0, 0, 0],
        bodies: [makeStar("Sun", "Sun"), body],
      },
    ];
    body.homeBody = true;
    body.ocean.enabled = true;
    body.surface.biomes = [defaultBiome("Base")];
    body.clutter = [type];
    body.clouds.enabled = false;
    project.exportResolution = 32;
    const original = JSON.stringify(project),
      restored = parseProject(original);
    const editable = cloneProjectForEdit(project),
      copyBody = editable.systems[0].bodies[1] as typeof body;
    expect(copyBody.clutter[0].importedAsset).toBe(type.importedAsset);
    copyBody.clutter[0].geometry.dimensionsM[0] = 9;
    expect(type.geometry.dimensionsM[0]).toBe(2);
    expect(validateProject(restored).filter((i) => i.severity === "error")).toEqual([]);
    const roundtrip = (restored.systems[0].bodies[1] as typeof body).clutter[0];
    expect(hash(getImportedMaterialPixels(roundtrip, 1).diffuse)).toBe(
      hash(getImportedMaterialPixels(type, 1).diffuse),
    );
    expect(hash(new Uint8Array(generateClutterGeometry(roundtrip).positions.buffer))).toBe(
      hash(new Uint8Array(generateClutterGeometry(type).positions.buffer)),
    );
    expect(estimateExportBytes(project)).toBeGreaterThan(importedAssetBytes(type.importedAsset!));
    type.enabled = false;
    const disabledBudget = estimateExportBytes(project);
    body.clutter = [];
    expect(disabledBudget - estimateExportBytes(project)).toBe(
      2 * importedAssetBytes(type.importedAsset!),
    );
    body.clutter = [type];
    type.enabled = true;
    const zip = await JSZip.loadAsync(await (await exportMod(project)).arrayBuffer()),
      root = project.id + "/";
    const xml = await zip.file(root + "Assets.xml")!.async("string");
    for (const match of xml.matchAll(/Path="([^"]+)"/g))
      expect(zip.file(root + match[1]), match[1]).not.toBeNull();
    const maskPath = importedClutterMaterialPaths(body, type, 1).opacity;
    expect(zip.file(root + maskPath)).not.toBeNull();
    const png = await zip
      .file(root + importedClutterMaterialPaths(body, type, 1).diffuse)!
      .async("uint8array");
    expect(hash((await pngDecode(png, "image/png")).pixels)).toBe(
      hash(getImportedMaterialPixels(type, 1).diffuse),
    );
    const native = fixtureGlbJson(
      await zip.file(root + clutterAssetPaths(body, type).model)!.async("uint8array"),
    );
    expect(native.meshes).toHaveLength(5);
    expect(native.images).toBeUndefined();
    expect(native.buffers[0].uri).toBeUndefined();
    expect(
      parseProject(await zip.file(root + "project.json")!.async("string")).systems[0].bodies,
    ).toHaveLength(2);
  }, 30_000);
  it.each([
    [
      "external buffers",
      (j: Record<string, any>) => (j.buffers[0].uri = "https://invalid.example/model.bin"),
      /URI resources/,
    ],
    [
      "Draco",
      (j: Record<string, any>) => (j.extensionsUsed = ["KHR_draco_mesh_compression"]),
      /KHR_draco_mesh_compression/,
    ],
    ["skinning", (j: Record<string, any>) => (j.skins = [{}]), /Skinned/],
    ["animation", (j: Record<string, any>) => (j.animations = [{}]), /Animated/],
    ["transparency", (j: Record<string, any>) => (j.materials[0].alphaMode = "BLEND"), /BLEND/],
    [
      "second UV set",
      (j: Record<string, any>) =>
        (j.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord = 1),
      /TEXCOORD_0/,
    ],
    [
      "missing UVs",
      (j: Record<string, any>) => delete j.meshes[0].primitives[0].attributes.TEXCOORD_0,
      /needs TEXCOORD_0/,
    ],
    [
      "clamp sampling",
      (j: Record<string, any>) => {
        j.samplers = [{ wrapS: 33071 }];
        j.textures[0].sampler = 0;
      },
      /repeat texture wrapping/,
    ],
    [
      "shared scene nodes",
      (j: Record<string, any>) => {
        j.nodes = [{ children: [1, 2] }, { children: [3] }, { children: [3] }, { mesh: 0 }];
      },
      /one parent/,
    ],
  ])("rejects %s with an actionable error", async (_, mutate, pattern) => {
    await expect(
      importClutterGlb(
        await importedClutterFixture(mutate as (j: Record<string, any>) => void),
        "bad.glb",
        pngDecode,
      ),
    ).rejects.toThrow(pattern as RegExp);
  });
  it("rejects resource excess and malformed saved model/primitive data without hiding it during migration", async () => {
    await expect(
      importClutterGlb(new Uint8Array(IMPORTED_LIMITS.fileBytes + 1), "large.glb", pngDecode),
    ).rejects.toThrow(/16 MB/);
    const type = await typeFixture(),
      asset = structuredClone(type.importedAsset!);
    asset.groups[0].count = 4;
    expect(validateImportedAsset(asset)).toMatch(/incomplete triangles/);
    asset.groups[0].count = 3;
    asset.geometry.uvs = importedEncodeBytes(new Float32Array(asset.vertexCount * 2));
    expect(validateImportedAsset(asset)).toMatch(/nonzero UV area/);
    const project = createProject(),
      body = project.systems[0].bodies.find((b) => b.id === "Earth") as ReturnType<
        typeof makePlanet
      >;
    body.clutter[0].importedAsset = asset;
    expect(() => parseProject(JSON.stringify(project))).toThrow(/nonzero UV area/);
    asset.geometry.uvs = type.importedAsset!.geometry.uvs;
    asset.materials[0].diffuse = "https://example.com/image.png";
    expect(validateImportedAsset(asset)).toMatch(/base64/);
  });

  it("counts disabled and shared imports across bodies against the same persisted collection budget", async () => {
    const type = await typeFixture(),
      project = createProject(),
      bodies = project.systems[0].bodies.filter((b): b is ReturnType<typeof makePlanet> => b.kind === "rocky"),
      bytes = importedAssetBytes(type.importedAsset!);
    bodies[0].clutter = [type];
    bodies[1].clutter = [{ ...type, enabled: false }];
    expect(importedProjectBytes(project)).toBe(bytes * 2);
    const limit = IMPORTED_LIMITS.projectBytes;
    try {
      IMPORTED_LIMITS.projectBytes = bytes * 2 - 1;
      expect(bytes).toBeLessThan(IMPORTED_LIMITS.projectBytes);
      expect(importedProjectBudgetError(project)).toMatch(/96 MB project budget/);
      expect(() => parseProject(JSON.stringify(project))).toThrow(/96 MB project budget/);
    } finally {
      IMPORTED_LIMITS.projectBytes = limit;
    }
  });
});
