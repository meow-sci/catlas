import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, Vector3 } from "three";
import { createProject, makePlanet } from "../src/lib/project";
import {
  defaultLandmark,
  generateLandmarkAssets,
  generateLaunchPadGlb,
  landmarkAssetPaths,
  landmarkAssetsXml,
  landmarksXml,
} from "../src/lib/landmarks";

const parser = new XMLParser({ ignoreAttributes: false });
describe("native named locations and generated launch pads", () => {
  it("connects location, mesh, material, files and collision in the native X-up frame", async () => {
    const body = makePlanet("World", "World", "Sun"),
      project = createProject();
    const pad = defaultLandmark("LaunchA", 'Site <A> & "B"');
    pad.latitude = -21.4;
    pad.longitude = 145.2;
    pad.sizeM = [3, 100, 60];
    body.landmarks = [pad];
    const assets = await generateLandmarkAssets(body),
      paths = new Set(assets.map((a) => a.path));
    const native = parser.parse(
      `<Assets>${landmarkAssetsXml(project, body).join("\n")}</Assets>`,
    ).Assets;
    const landmark = parser.parse(`<Body>${landmarksXml(project, body, "").join("\n")}</Body>`).Body
      .Landmark;
    expect(landmark["@_Id"]).toBe(pad.name);
    expect(landmark["@_StaticObject"]).toBe(native.StaticObject["@_Id"]);
    expect(landmark["@_IsLaunchPad"]).toBe("true");
    expect(Number(landmark.Latitude["@_Degrees"])).toBe(-21.4);
    expect(native.StaticObject.PartModel.Material["@_Id"]).toBe(native.PbrMaterial["@_Id"]);
    for (const texture of [
      native.PbrMaterial.Diffuse,
      native.PbrMaterial.Normal,
      native.PbrMaterial.AoRoughMetal,
    ])
      expect(paths.has(texture["@_Path"])).toBe(true);
    expect(paths.has(native.MeshAtlas["@_Path"])).toBe(true);
    expect(native.StaticObject.PartModel.Mesh["@_Id"]).toBe(landmarkAssetPaths(body, pad).mesh);
    const box = native.StaticObject.Collider.Box;
    expect([box.LengthX, box.LengthY, box.LengthZ].map((v) => Number(v["@_M"]))).toEqual(pad.sizeM);
    expect(Number(box.LocationAsmb["@_X"])).toBe(1.5);
    expect(Number(native.StaticObject.SurfaceHeight["@_M"])).toBe(3);
    expect(Number(native.StaticObject.FootprintRadius["@_M"])).toBe(30);
    const data = generateLaunchPadGlb(body, pad);
    const gltf = await new GLTFLoader().parseAsync(data.slice().buffer, "");
    const bounds = new Box3().setFromObject(gltf.scene);
    expect(bounds.min.toArray()).toEqual([0, -50, -30]);
    expect(bounds.max.toArray()).toEqual([3, 50, 30]);
    expect(bounds.getSize(new Vector3()).toArray()).toEqual(pad.sizeM);
    // Native MeshAtlas resolves meshes[].name, independently of node names/transforms.
    const view = new DataView(data.buffer);
    const json = JSON.parse(
      new TextDecoder().decode(data.subarray(20, 20 + view.getUint32(12, true))),
    );
    expect(json.meshes[0].name).toBe(native.StaticObject.PartModel.Mesh["@_Id"]);
    expect(json.nodes[0]).not.toHaveProperty("matrix");
    expect(json.meshes[0].primitives[0].attributes.TANGENT).toBeDefined();
  });

  it("exports named categories without pretending they create geometry; skips disabled sites", async () => {
    const body = makePlanet("World", "World", "Sun");
    body.landmarks = [
      { ...defaultLandmark("City"), category: "city", name: "Town", launchPad: false },
      { ...defaultLandmark("Crater"), category: "crater", name: "Impact", launchPad: false },
      { ...defaultLandmark("Mountain"), category: "mountain", name: "Summit", launchPad: false },
      { ...defaultLandmark("Marker"), name: "Landing destination", launchPad: false },
      { ...defaultLandmark("Hidden"), enabled: false },
    ];
    const xml = landmarksXml(createProject(), body, "").join("\n");
    const decoded = parser.parse(`<Body>${xml}</Body>`).Body;
    expect(Object.keys(decoded)).toEqual(["City", "Crater", "Mountain", "Landmark"]);
    expect(xml).not.toContain("StaticObject");
    expect(xml).not.toContain("Hidden");
    expect(await generateLandmarkAssets(body)).toEqual([]);
    expect(landmarkAssetsXml(createProject(), body)).toEqual([]);
  });
});
