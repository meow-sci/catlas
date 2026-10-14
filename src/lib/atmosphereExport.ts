import { encodePng, type GeneratedAsset } from "./assets";
import {
  cloudLayerBounds,
  compileCloudProfile,
  nativeCloudDirection,
  sampleCloud,
} from "./atmosphere";
import { noise3, parseColor } from "./procedural";
import type { CloudLayerSettings, Planet, SplinePointSettings } from "./types";

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
const safeId = (v: string) => v.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]/, "_$&");
const xml = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const num = (v: number) => {
  if (!Number.isFinite(v)) throw new Error("Cloud export contains a non-finite number.");
  return String(Number(v.toPrecision(12)));
};

export function cloudAssetPaths(body: Pick<Planet, "id">, layer: Pick<CloudLayerSettings, "id">) {
  const root = `Textures/${body.id}_Clouds_${safeId(layer.id)}`;
  return {
    mask: `${root}_Mask.png`,
    detail: `${root}_Detail.png`,
    color: `${root}_Color.png`,
    normal: `${root}_Normal.png`,
    flow: `${root}_Flow.png`,
  };
}

export function cloudPixels(
  body: Planet,
  layer: CloudLayerSettings,
  width: number,
  height: number,
) {
  const mask = new Uint8Array(width * height * 4),
    color = new Uint8Array(mask.length);
  const flow = new Uint8Array(mask.length),
    normal = new Uint8Array(mask.length);
  const heights = new Float32Array(width * height);
  const cloudTopKm = new Float32Array(width * height);
  const profile = compileCloudProfile(layer),
    bounds = cloudLayerBounds(layer);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sample = sampleCloud(
        body,
        layer,
        nativeCloudDirection((x + 0.5) / width, (y + 0.5) / height),
      );
      const at = (y * width + x) * 4;
      // Coverage A and detail-selector R are independent native channels.
      mask.set([byte(sample.type), 255, 255, byte(sample.coverage)], at);
      color.set([...sample.color.map(byte), byte(sample.coverage * layer.opacity)], at);
      // Native flow is signed RGB mapped to [0,1]. Z must be neutral, not zero.
      flow.set([byte(0.5 + sample.flow[0]), byte(0.5 + sample.flow[1]), 128, 255], at);
      cloudTopKm[y * width + x] = profile.topAltitudeKm(sample.coverage, sample.type);
      heights[y * width + x] =
        (sample.coverage * (cloudTopKm[y * width + x] - bounds.bottomKm)) /
        Math.max(0.001, bounds.topKm - bounds.bottomKm);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = heights[y * width + ((x + width - 1) % width)];
      const right = heights[y * width + ((x + 1) % width)];
      const up = heights[Math.max(0, y - 1) * width + x];
      const down = heights[Math.min(height - 1, y + 1) * width + x];
      const nx = (left - right) * 2,
        ny = (up - down) * 2,
        length = Math.hypot(nx, ny, 1);
      normal.set(
        [
          byte((nx / length) * 0.5 + 0.5),
          byte((ny / length) * 0.5 + 0.5),
          byte((1 / length) * 0.5 + 0.5),
          255,
        ],
        (y * width + x) * 4,
      );
    }
  }
  const detail = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const u = (x / 32) * Math.PI * 2,
        v = (y / 32) * Math.PI * 2;
      const n = noise3(
        Math.cos(u) * 2,
        Math.sin(u) * 2,
        Math.cos(v) * 2 + Math.sin(v),
        layer.seed + 739,
      );
      // RG and BA store two periodic coverage/type fields. Their blend spans all
      // authored types because the native shader multiplies type by typeCount-1.
      detail.set(
        [byte(0.86 + n * 0.14), byte(n * 0.1), byte(0.88 + (1 - n) * 0.12), byte(0.9 + n * 0.1)],
        (y * 32 + x) * 4,
      );
    }
  return { mask, color, normal, flow, detail, cloudTopKm };
}

/** Original PNG weather assets; no stock textures, shader code, or models are bundled. */
export async function generateCloudAssets(body: Planet, faceSize = 256): Promise<GeneratedAsset[]> {
  if (!body.clouds.enabled || !body.atmosphere.enabled) return [];
  const assets: GeneratedAsset[] = [];
  const width = faceSize * 4,
    height = faceSize * 2;
  for (const layer of body.clouds.layers.filter((layer) => layer.enabled)) {
    const paths = cloudAssetPaths(body, layer),
      pixels = cloudPixels(body, layer, width, height);
    for (const kind of [
      "mask",
      "detail",
      "color",
      "normal",
      ...(layer.flow.enabled ? ["flow" as const] : []),
    ] as const) {
      assets.push({
        path: paths[kind],
        data: await encodePng(
          kind === "detail" ? 32 : width,
          kind === "detail" ? 32 : height,
          pixels[kind],
        ),
        mimeType: "image/png",
      });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return assets;
}

function curveXml(points: SplinePointSettings[], indent: string): string[] {
  return [...points]
    .sort((a, b) => a.key - b.key)
    .flatMap((p) => [
      `${indent}<SplinePoint>`,
      `${indent}  <Key Value="${num(p.key)}" />`,
      `${indent}  <Value Value="${num(p.value)}" />`,
      `${indent}  <InTangent Value="${num(p.inTangent)}" />`,
      `${indent}  <OutTangent Value="${num(p.outTangent)}" />`,
      `${indent}</SplinePoint>`,
    ]);
}

/** Complete native CloudsReference, a sibling of Atmosphere in AtmosphericBody. */
export function cloudsXml(body: Planet, assetPrefix: string, indent = "    "): string[] {
  const settings = body.clouds;
  if (!settings.enabled || !body.atmosphere.enabled) return [];
  const lines = [
    `${indent}<Clouds>`,
    `${indent}  <OrbitTransitionStartAltitude Km="${num(settings.orbitTransitionStartKm)}" />`,
    `${indent}  <OrbitTransitionEndAltitude Km="${num(settings.orbitTransitionEndKm)}" />`,
    `${indent}  <MaxShadowsAltitude Km="${num(settings.maxShadowsAltitudeKm)}" />`,
    `${indent}  <VolumetricsFlickerReductionDistance Km="${num(settings.flickerReductionKm)}" />`,
  ];
  for (const layer of settings.layers.filter((l) => l.enabled)) {
    const paths = cloudAssetPaths(body, layer),
      id = `${safeId(assetPrefix)}_Clouds_${safeId(layer.id)}`;
    const texture = (tag: string, kind: keyof typeof paths, depth: string, mipMaps: boolean) => [
      `${depth}<${tag} Id="${id}_${kind}" Path="${xml(paths[kind])}" Category="Terrain">`,
      `${depth}  <IsVirtual>false</IsVirtual>`,
      `${depth}  <Manifest><MaxSize>0</MaxSize><MipMaps>${mipMaps}</MipMaps></Manifest>`,
      `${depth}</${tag}>`,
    ];
    const tint = parseColor(layer.color).map(num);
    const color = `R="${tint[0]}" G="${tint[1]}" B="${tint[2]}"`;
    const flow = (tag: string, depth: string, includeAsset: boolean) => [
      `${depth}<${tag}>`,
      ...(includeAsset
        ? texture("Texture", "flow", `${depth}  `, true)
        : [`${depth}  <Texture Id="${id}_flow" />`]),
      `${depth}  <Displacement Km="${num(layer.flow.displacementKm)}" />`,
      `${depth}  <LoopDuration Hours="${num(layer.flow.loopHours)}" />`,
      `${depth}</${tag}>`,
    ];
    lines.push(
      `${indent}  <Layer Id="${id}">`,
      `${indent}    <RotationSpeed X="${num(layer.rotationSpeed[0])}" Y="${num(layer.rotationSpeed[1])}" Z="${num(layer.rotationSpeed[2])}" />`,
      `${indent}    <VolumetricCloud>`,
      ...texture("Texture", "mask", `${indent}      `, false),
      `${indent}      <Detail>`,
      `${indent}        <DetailSelector Id="${id}_mask" />`,
      ...texture("Texture", "detail", `${indent}        `, false),
      `${indent}        <Size Km="${num(layer.detailSizeKm)}" />`,
      `${indent}      </Detail>`,
      `${indent}      <Color ${color} />`,
      ...(layer.flow.enabled ? flow("VolumetricsFlowMap", `${indent}      `, true) : []),
      ...texture("VolumetricsColorMap", "color", `${indent}      `, true),
      `${indent}      <Raymarching>`,
      `${indent}        <Step Scale="${num(layer.raymarching.stepScale)}">`,
      `${indent}          <Size Km="${num(layer.raymarching.stepSizeKm)}" />`,
      `${indent}          <MaxSize Km="${num(layer.raymarching.maxStepSizeKm)}" />`,
      `${indent}        </Step>`,
      `${indent}        <LightDistance Km="${num(layer.raymarching.lightDistanceKm)}" />`,
      `${indent}        <LightSamples Value="${num(layer.raymarching.lightSamples)}" />`,
      `${indent}      </Raymarching>`,
      `${indent}      <Noise><ScrollSpeed Value="${num(layer.noiseScrollSpeed)}" /></Noise>`,
    );
    for (const type of layer.types) {
      lines.push(
        `${indent}      <CloudType Name="${xml(type.name)}">`,
        `${indent}        <StartAltitude Km="${num(type.startAltitudeKm)}" />`,
        `${indent}        <Height Km="${num(type.heightKm)}" />`,
        `${indent}        <Density Value="${num(type.density * layer.opacity)}" />`,
        `${indent}        <NoiseScale Km="${num(type.noiseScaleKm)}" />`,
        `${indent}        <EdgeSharpness Value="${num(type.edgeSharpness)}" />`,
        `${indent}        <MultipleScatteringBrightness Value="${num(type.multipleScatteringBrightness)}" />`,
        `${indent}        <CloudShape InterpolateShapes="${type.interpolateShapes}">`,
        `${indent}          <ShapeCurve>`,
        ...curveXml(type.shapeCurve, `${indent}            `),
        `${indent}          </ShapeCurve>`,
        `${indent}          <DensityCurve>`,
        ...curveXml(type.densityCurve, `${indent}            `),
        `${indent}          </DensityCurve>`,
        `${indent}        </CloudShape>`,
        `${indent}      </CloudType>`,
      );
    }
    lines.push(
      `${indent}    </VolumetricCloud>`,
      `${indent}    <TwoDimensionalCloud>`,
      `${indent}      <Texture Id="${id}_color" />`,
      ...texture("NormalMap", "normal", `${indent}      `, true),
      `${indent}      <UseAlphaOnly Value="${layer.useAlphaOnly}" />`,
      `${indent}      <Color ${color} />`,
      `${indent}      <Lambertian Value="${num(layer.lambertian)}" />`,
      ...(layer.flow.enabled ? flow("FlowMap", `${indent}      `, false) : []),
      `${indent}    </TwoDimensionalCloud>`,
      `${indent}    <MatchGroundColor Value="${layer.matchGroundColor}" />`,
      `${indent}  </Layer>`,
    );
  }
  lines.push(`${indent}</Clouds>`);
  return lines;
}
