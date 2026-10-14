import { describe, expect, it } from "vitest";
import { read as readKtx2 } from "ktx-parse";
import { inflateSync } from "node:zlib";
import { makePlanet } from "../src/lib/project";
import {
  bodyAssetPaths,
  encodeKtx2Cube,
  generateBodyAssets,
  generateRockGlb,
} from "../src/lib/assets";

describe("native asset output", () => {
  it("packs six distinct R16 cube faces contiguously at the 1x1 mip", () => {
    const faces = [0, 1, 2, 3, 4, 5].map((face) => {
      const pixels = new Uint8Array(2 * 2 * 2);
      for (let i = 0; i < 4; i++) {
        pixels[i * 2] = face + 1;
        pixels[i * 2 + 1] = 0;
      }
      return pixels;
    });
    const output = encodeKtx2Cube(faces, 2, "r16");
    const parsed = readKtx2(output);
    expect(parsed.faceCount).toBe(6);
    expect(parsed.levels[1].levelData.length).toBe(12);
    expect(parsed.dataFormatDescriptor[0].samples[0].bitLength).toBe(15);
    const view = new DataView(output.buffer);
    expect(view.getUint32(12, true)).toBe(70); // VK_FORMAT_R16_UNORM
    expect(view.getUint32(36, true)).toBe(6); // face count
    expect(view.getUint32(40, true)).toBe(2); // mip count
    const offset = Number(view.getBigUint64(80 + 24, true));
    expect(Number(view.getBigUint64(88 + 24, true))).toBe(12);
    for (let face = 0; face < 6; face++)
      expect(view.getUint16(offset + face * 2, true)).toBe(face + 1);
  });

  it("generates self-contained maps and a named rock mesh deterministically", async () => {
    const body = makePlanet("TestWorld", "Test World", "Sol");
    body.rings.enabled = true;
    const one = await generateBodyAssets(body, 8);
    const two = await generateBodyAssets(body, 8);
    const paths = bodyAssetPaths(body);
    expect(one.map((asset) => asset.path)).toEqual(two.map((asset) => asset.path));
    expect(one.find((asset) => asset.path === paths.height)?.data).toEqual(
      two.find((asset) => asset.path === paths.height)?.data,
    );
    for (const path of [
      paths.diffuse,
      paths.normal,
      paths.height,
      paths.biomeId,
      paths.biomeControl,
      paths.scattering,
      paths.surge,
      paths.terrainDiffuse,
      paths.terrainNormal,
      paths.terrainOrm,
      paths.rings,
      paths.ringsControl,
      paths.rockModel,
      paths.rockDiffuse,
      paths.rockNormal,
      paths.rockOrm,
      paths.rockDistribution,
    ]) {
      expect(
        one.some((asset) => asset.path === path),
        path,
      ).toBe(true);
    }
    const ringPng = one.find((asset) => asset.path === paths.rings)!.data;
    const pngHeader = new DataView(ringPng.buffer, ringPng.byteOffset, ringPng.byteLength);
    expect(pngHeader.getUint32(16)).toBe(2048);
    expect(pngHeader.getUint32(20)).toBe(1);
    const idatLength = pngHeader.getUint32(33);
    expect(inflateSync(ringPng.subarray(41, 41 + idatLength)).length).toBe(2048 * 4 + 1);
    const ormPng = one.find((asset) => asset.path === paths.terrainOrm)!.data;
    const ormView = new DataView(ormPng.buffer, ormPng.byteOffset, ormPng.byteLength);
    const ormRaw = inflateSync(ormPng.subarray(41, 41 + ormView.getUint32(33)));
    const roughnessValues: number[] = [];
    const width = ormView.getUint32(16),
      height = ormView.getUint32(20);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        roughnessValues.push(ormRaw[y * (width * 4 + 1) + 1 + x * 4 + 1]);
    expect(new Set(roughnessValues).size).toBeGreaterThan(2);
    expect(Math.min(...roughnessValues)).toBeGreaterThan(
      body.surface.biomes[0].ground.roughness * 255 * 0.8,
    );
    expect(Math.max(...roughnessValues)).toBeLessThanOrEqual(255);
    const glb = generateRockGlb(body),
      view = new DataView(glb.buffer);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    const json = JSON.parse(
      new TextDecoder().decode(glb.subarray(20, 20 + view.getUint32(12, true))),
    );
    expect(json.meshes[0].name).toBe(paths.rockMesh);
    expect(json.meshes[0].primitives[0].attributes).toHaveProperty("POSITION");
    expect(json.meshes[0].primitives[0].attributes).toHaveProperty("TANGENT");
    const binaryStart = 20 + view.getUint32(12, true) + 8;
    const positionStart = binaryStart + json.bufferViews[0].byteOffset;
    const indexStart = binaryStart + json.bufferViews[4].byteOffset;
    const position = (index: number): [number, number, number] =>
      [0, 1, 2].map((axis) => view.getFloat32(positionStart + (index * 3 + axis) * 4, true)) as [
        number,
        number,
        number,
      ];
    const vertexIndex = (at: number) => view.getUint16(indexStart + at * 2, true);
    let signedVolume = 0;
    const edges = new Map<string, number>();
    for (let at = 0; at < json.accessors[4].count; at += 3) {
      const corners = [0, 1, 2].map((offset) => position(vertexIndex(at + offset)));
      const [a, b, c] = corners;
      signedVolume +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6;
      const names = corners.map((corner) => corner.join(","));
      for (const [i, j] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ]) {
        const key = [names[i], names[j]].sort().join("|");
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect(signedVolume).toBeGreaterThan(0);
    expect([...edges.values()].every((count) => count === 2)).toBe(true);
  });
});
