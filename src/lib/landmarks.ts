import { BoxGeometry } from "three";
import { encodePng, type GeneratedAsset } from "./assets";
import { parseColor } from "./procedural";
import type { LandmarkSettings, Planet, Project } from "./types";

const escapeXml = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const safeId = (value: string) =>
  value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]/, "_$&");
const number = (value: number) => {
  if (!Number.isFinite(value)) throw new Error("Location contains a non-finite value.");
  return String(Number(value.toPrecision(12)));
};
const locationTags = {
  landmark: "Landmark",
  city: "City",
  crater: "Crater",
  mountain: "Mountain",
} as const;
const pads = (body: Planet) =>
  body.kind === "rocky"
    ? body.landmarks.filter(
        (site) => site.enabled && site.category === "landmark" && site.launchPad,
      )
    : [];

export function defaultLandmark(id = "LaunchPad", name = "Launch pad"): LandmarkSettings {
  return {
    id,
    name,
    enabled: true,
    category: "landmark",
    latitude: 0,
    longitude: 0,
    launchPad: true,
    groundOffsetM: 0.2,
    sizeM: [2, 80, 80],
    color: "#747b80",
  };
}

export function landmarkAssetPaths(body: Planet, site: LandmarkSettings) {
  const base = `${body.id}_Location_${site.id}`;
  return {
    mesh: `${base}_Mesh`,
    model: `Meshes/${base}.glb`,
    diffuse: `Textures/${base}_Diffuse.png`,
    normal: `Textures/${base}_Normal.png`,
    orm: `Textures/${base}_AoRoughMetal.png`,
  };
}
const staticId = (project: Project, body: Planet, site: LandmarkSettings) =>
  `${safeId(project.id)}_${body.id}_Location_${site.id}`;

/** Native locations are named coordinates. Only launch landmarks render a static object. */
export function landmarksXml(project: Project, body: Planet, indent: string): string[] {
  return body.landmarks
    .filter((site) => site.enabled)
    .flatMap((site) => {
      const tag = locationTags[site.category];
      const physical = body.kind === "rocky" && site.category === "landmark" && site.launchPad;
      return [
        `${indent}<${tag} Id="${escapeXml(site.name)}"${physical ? ` IsLaunchPad="true" StaticObject="${staticId(project, body, site)}"` : ""}>`,
        `${indent}  <Latitude Degrees="${number(site.latitude)}" />`,
        `${indent}  <Longitude Degrees="${number(site.longitude)}" />`,
        `${indent}</${tag}>`,
      ];
    });
}

export function landmarkAssetsXml(project: Project, body: Planet): string[] {
  return pads(body).flatMap((site) => {
    const id = staticId(project, body, site),
      path = landmarkAssetPaths(body, site);
    const [height, width, length] = site.sizeM;
    // Spawn height applies inside a circle: inscribe it in the usable rectangular platform.
    const footprint = Math.min(width, length) / 2;
    return [
      `  <MeshAtlas Path="${path.model}" />`,
      `  <PbrMaterial Id="${id}_Material">`,
      `    <Diffuse Path="${path.diffuse}" Category="Vessel" />`,
      `    <Normal Path="${path.normal}" Category="Vessel" />`,
      `    <AoRoughMetal Path="${path.orm}" Category="Vessel" />`,
      `  </PbrMaterial>`,
      `  <StaticObject Id="${id}">`,
      `    <PartModel Id="${id}_Model"><Mesh Id="${path.mesh}" /><Material Id="${id}_Material" /></PartModel>`,
      `    <Collider Id="${id}_Collider">`,
      `      <Box Id="${id}_Box">`,
      `        <LocationAsmb X="${number(height / 2)}" Y="0" Z="0" />`,
      `        <Collider2Asmb X="0" Y="0" Z="0" />`,
      `        <LengthX M="${number(height)}" /><LengthY M="${number(width)}" /><LengthZ M="${number(length)}" />`,
      `      </Box>`,
      `    </Collider>`,
      `    <GroundOffset M="${number(site.groundOffsetM)}" />`,
      `    <SurfaceHeight M="${number(height)}" />`,
      `    <FootprintRadius M="${number(footprint)}" />`,
      `  </StaticObject>`,
    ];
  });
}

/** Bake the native assembly frame (+X up) into vertices; KSA ignores glTF node transforms. */
export function generateLaunchPadGlb(body: Planet, site: LandmarkSettings): Uint8Array {
  const geometry = new BoxGeometry(...site.sizeM).translate(site.sizeM[0] / 2, 0, 0);
  geometry.computeTangents();
  const position = geometry.getAttribute("position"),
    normal = geometry.getAttribute("normal"),
    uv = geometry.getAttribute("uv"),
    tangent = geometry.getAttribute("tangent");
  const arrays = [position.array, normal.array, uv.array, tangent.array, geometry.index!.array];
  const views: { buffer: number; byteOffset: number; byteLength: number; target: number }[] = [];
  let length = 0;
  for (const [i, array] of arrays.entries()) {
    length = Math.ceil(length / 4) * 4;
    views.push({
      buffer: 0,
      byteOffset: length,
      byteLength: array.byteLength,
      target: i === 4 ? 34963 : 34962,
    });
    length += array.byteLength;
  }
  const binary = new Uint8Array(Math.ceil(length / 4) * 4);
  arrays.forEach((array, i) =>
    binary.set(
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
      views[i].byteOffset,
    ),
  );
  const [height, width, depth] = site.sizeM;
  const json = {
    asset: { version: "2.0", generator: "Orbit Foundry" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        name: landmarkAssetPaths(body, site).mesh,
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
        pbrMetallicRoughness: {
          baseColorFactor: [...parseColor(site.color), 1],
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
      },
    ],
    buffers: [{ byteLength: binary.length }],
    bufferViews: views,
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: position.count,
        type: "VEC3",
        min: [0, -width / 2, -depth / 2],
        max: [height, width / 2, depth / 2],
      },
      { bufferView: 1, componentType: 5126, count: normal.count, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: uv.count, type: "VEC2" },
      { bufferView: 3, componentType: 5126, count: tangent.count, type: "VEC4" },
      { bufferView: 4, componentType: 5123, count: geometry.index!.count, type: "SCALAR" },
    ],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonSize = Math.ceil(text.length / 4) * 4;
  const output = new Uint8Array(12 + 8 + jsonSize + 8 + binary.length),
    header = new DataView(output.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, output.length, true);
  header.setUint32(12, jsonSize, true);
  header.setUint32(16, 0x4e4f534a, true);
  output.fill(32, 20, 20 + jsonSize);
  output.set(text, 20);
  header.setUint32(20 + jsonSize, binary.length, true);
  header.setUint32(24 + jsonSize, 0x004e4942, true);
  output.set(binary, 28 + jsonSize);
  geometry.dispose();
  return output;
}

export async function generateLandmarkAssets(body: Planet): Promise<GeneratedAsset[]> {
  const result: GeneratedAsset[] = [];
  for (const site of pads(body)) {
    const path = landmarkAssetPaths(body, site),
      size = 128,
      diffuse = new Uint8Array(size * size * 4),
      normal = new Uint8Array(diffuse.length),
      orm = new Uint8Array(diffuse.length),
      color = parseColor(site.color);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4,
          edge = Math.min(x, y, size - 1 - x, size - 1 - y);
        const ring = Math.abs(Math.hypot(x - size / 2, y - size / 2) - size * 0.32) < 1.6;
        const center = Math.abs(x - size / 2) < 1 || Math.abs(y - size / 2) < 1;
        const paint = (edge > 4 && edge < 8) || ring || (center && edge > 32);
        const grain = 0.88 + (((x * 37 + y * 71) ^ (x * y)) & 31) / 220;
        for (let c = 0; c < 3; c++)
          diffuse[i + c] = Math.round(
            Math.min(1, paint ? [0.93, 0.77, 0.33][c] : color[c] * grain) * 255,
          );
        diffuse[i + 3] = 255;
        normal.set([128, 128, 255, 255], i);
        orm.set([255, paint ? 145 : 210, 0, 255], i);
      }
    result.push({
      path: path.model,
      data: generateLaunchPadGlb(body, site),
      mimeType: "model/gltf-binary",
    });
    for (const [key, pixels] of [
      ["diffuse", diffuse],
      ["normal", normal],
      ["orm", orm],
    ] as const)
      result.push({
        path: path[key],
        data: await encodePng(size, size, pixels),
        mimeType: "image/png",
      });
  }
  return result;
}
