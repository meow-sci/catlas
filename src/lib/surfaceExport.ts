import { cubeDirection, encodeKtx2Cube, encodePng, type GeneratedAsset } from "./assets";
import { compileSurfaceSampler, nativeToAuthorDirection, parseColor } from "./procedural";
import {
  encodeBiomePixel,
  generateClutterGeometry,
  generateClutterPixels,
  generateTerrainPixels,
  sampleBiomeWeights,
  type ClutterGeometry,
} from "./surface";
import {
  CLUTTER_ALPHA_CUTOFF,
  getStockPixels,
  stockIsGroundcover,
  stockUsesCutout,
  STOCK_TEXTURE_SIZE,
} from "./stock-assets";
import { getImportedMaterialPixels, importedMaterialSize } from "./imported-clutter";
import type {
  ClutterType,
  Planet,
  Project,
  TerrainBiome,
  TerrainMaterialSettings,
  Vec3,
} from "./types";

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const numeric = (value: number) => {
  if (!Number.isFinite(value)) throw new Error("Surface export contains a non-finite number");
  return String(Number(value.toPrecision(12)));
};
const safe = (value: string) => value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]/, "_$&");
const prefix = (project: Project, body: Planet) => `${safe(project.id)}_${body.id}`;
const alias = (biome: TerrainBiome) => safe(biome.id);
const vectorXml = (vector: Vec3) =>
  vector.map((value, axis) => ` ${"XYZ"[axis]}="${numeric(value)}"`).join("");

export function biomeMaterialPaths(body: Planet, biome: TerrainBiome, side: "Ground" | "Slope") {
  const root = `Textures/${body.id}_Biome_${safe(biome.id)}_${side}`;
  return {
    diffuse: `${root}_Diffuse.png`,
    normal: `${root}_Normal.png`,
    orm: `${root}_AoRoughMetal.png`,
    displacement: `${root}_Displacement.png`,
    height: `${root}_Height.png`,
  };
}
export function clutterAssetPaths(body: Planet, type: ClutterType) {
  const stem = `${body.id}_Clutter_${safe(type.id)}`,
    root = `Textures/${stem}`;
  return {
    model: `Meshes/${stem}.glb`,
    meshes: Array.from({ length: 5 }, (_, lod) => `${stem}_LOD${lod}`),
    diffuse: `${root}_Diffuse.png`,
    normal: `${root}_Normal.png`,
    orm: `${root}_AoRoughMetal.png`,
    opacity: `${root}_Opacity.png`,
    thickness: `${root}_Thickness.png`,
    distribution: `${root}_Distribution.png`,
  };
}

/** Native LOD material slots are sorted GLB material indices, independently of primitive order. */
export function importedClutterMaterialPaths(body: Planet, type: ClutterType, material: number) {
  const root = `Textures/${body.id}_Clutter_${safe(type.id)}_Material${material}`;
  return {
    diffuse: `${root}_Diffuse.png`,
    normal: `${root}_Normal.png`,
    orm: `${root}_AoRoughMetal.png`,
    opacity: `${root}_Opacity.png`,
  };
}

function assertNativeBiomes(body: Planet) {
  const biomes = body.surface.biomes;
  if (!biomes.length || biomes.length > 32)
    throw new Error(`${body.name}: native biome masks require 1–32 biomes`);
  const aliases = biomes.map(alias);
  if (new Set(aliases).size !== aliases.length)
    throw new Error(`${body.name}: biome aliases must be unique after native ID sanitization`);
}

export function surfaceBiomesXml(project: Project, body: Planet, indent: string): string[] {
  if (body.kind !== "rocky") return [];
  assertNativeBiomes(body);
  const id = prefix(project, body);
  return [
    `${indent}<Biomes>`,
    `${indent}  <BiomeIDMap Id="${id}_Biome_ID" Path="Textures/${body.id}_Biome_ID.ktx2" Category="TerrainHeight" />`,
    `${indent}  <BiomeControlMap Id="${id}_Biome_Control" Path="Textures/${body.id}_Biome_Control.ktx2" Category="TerrainHeight" />`,
    `${indent}  <BlendStrength Value="${numeric(body.surface.biomeBlendStrength)}" />`,
    ...body.surface.biomes.map(
      (biome, index) =>
        `${indent}  <Biome IdMapIndex="${index}" Alias="${escapeXml(alias(biome))}" />`,
    ),
    `${indent}</Biomes>`,
  ];
}

function terrainMaterialXml(
  project: Project,
  body: Planet,
  biome: TerrainBiome,
  side: "Ground" | "Slope",
  indent: string,
): string[] {
  const material: TerrainMaterialSettings = side === "Ground" ? biome.ground : biome.slope;
  const paths = biomeMaterialPaths(body, biome, side),
    id = `${prefix(project, body)}_Biome_${alias(biome)}_${side}`;
  return [
    `${indent}<${side}Material>`,
    `${indent}  <Diffuse Id="${id}_Diffuse" Path="${paths.diffuse}" Category="Terrain" />`,
    `${indent}  <Normal Id="${id}_Normal" Path="${paths.normal}" Category="Terrain" />`,
    `${indent}  <AoRoughMetal Id="${id}_AoRoughMetal" Path="${paths.orm}" Category="Terrain" />`,
    `${indent}  <Displacement Id="${id}_Displacement" Path="${paths.displacement}" Category="Terrain" />`,
    `${indent}  <Height Id="${id}_Height" Path="${paths.height}" Category="TerrainHeight"><Minimum M="0" /><Maximum M="${numeric(material.heightDeformityM)}" /></Height>`,
    ...(
      [
        ["TextureTiling", material.textureTiling],
        ["HeightTiling", material.heightTiling],
        ["HeightDeformity", material.heightDeformityM],
        ["DiffuseScale", material.diffuseScale],
        ["NormalScale", material.normalScale],
        ["DisplacementScale", material.displacementScale],
      ] as const
    ).map(([tag, value]) => `${indent}  <${tag} Value="${numeric(value)}" />`),
    `${indent}</${side}Material>`,
  ];
}

export function surfaceTerrainXml(project: Project, body: Planet, indent: string): string[] {
  if (body.kind !== "rocky") return [];
  assertNativeBiomes(body);
  if (!(body.surface.detailFadeStartM > body.surface.detailFadeEndM))
    throw new Error(`${body.name}: native terrain detail fade start must be greater than end`);
  return [
    `${indent}<Terrain>`,
    `${indent}  <BiomeMaterials>`,
    `${indent}    <BlendStrength Value="${numeric(body.surface.biomeBlendStrength)}" />`,
    `${indent}    <DetailFadeInStart M="${numeric(body.surface.detailFadeStartM)}" />`,
    `${indent}    <DetailFadeInEnd M="${numeric(body.surface.detailFadeEndM)}" />`,
    ...body.surface.biomes.flatMap((biome) => [
      `${indent}    <BiomeMaterial Biome="${escapeXml(alias(biome))}">`,
      ...(
        [
          ["SlopeBlendStrength", biome.slopeBlendStrength],
          ["SlopeBlendContrast", biome.slopeBlendContrast],
          ["SlopeBlendBias", biome.slopeBlendBias],
        ] as const
      ).map(([tag, value]) => `${indent}      <${tag} Value="${numeric(value)}" />`),
      ...terrainMaterialXml(project, body, biome, "Ground", `${indent}      `),
      ...terrainMaterialXml(project, body, biome, "Slope", `${indent}      `),
      `${indent}    </BiomeMaterial>`,
    ]),
    `${indent}  </BiomeMaterials>`,
    `${indent}</Terrain>`,
  ];
}

export function surfaceClutterAssetsXml(project: Project, body: Planet): string[] {
  if (body.kind !== "rocky") return [];
  return body.clutter
    .filter((type) => type.enabled)
    .flatMap((type) => {
      const paths = clutterAssetPaths(body, type),
        id = `${prefix(project, body)}_Clutter_${safe(type.id)}`;
      if (type.importedAsset) {
        return [
          `  <MeshAtlas Id="${id}_Atlas" Path="${paths.model}" HostOnly="true" />`,
          ...type.importedAsset.materials.flatMap((material, index) => {
            const maps = importedClutterMaterialPaths(body, type, index),
              mid = `${id}_Material${index}`;
            return [
              `  <GroundClutterMaterial Id="${mid}">`,
              `    <Diffuse Id="${mid}_Diffuse" Path="${maps.diffuse}" Category="Terrain" />`,
              `    <Normal Id="${mid}_Normal" Path="${maps.normal}" Category="Terrain" />`,
              `    <AoRoughMetal Id="${mid}_AoRoughMetal" Path="${maps.orm}" Category="Terrain" />`,
              ...(material.cutout || type.material.opacity
                ? [
                    `    <Opacity Id="${mid}_Opacity" Path="${maps.opacity}" Category="Terrain" />`,
                    `    <AlphaCutoff Value="${CLUTTER_ALPHA_CUTOFF}" />`,
                  ]
                : []),
              `    <DoubleSided Value="${material.doubleSided || type.material.doubleSided}" />`,
              `    <UseTerrainMask Value="${type.material.useTerrainMask}" />`,
              `    <ReceiveShadows Value="true" />`,
              `    <CastShadows Value="true" />`,
              `  </GroundClutterMaterial>`,
            ];
          }),
          `  <ClutterObject Id="${id}_Object" Atlas="${id}_Atlas">`,
          `    <LODs>`,
          ...[128, 64, 32, 16, 8].map(
            (size, lod) =>
              `      <LOD MinScreenSize="${size}"><Mesh Id="${paths.meshes[lod]}" />${type.importedAsset!.materials.map((_, i) => `<Material Id="${id}_Material${i}" />`).join("")}</LOD>`,
          ),
          `    </LODs>`,
          `  </ClutterObject>`,
        ];
      }
      return [
        `  <MeshAtlas Id="${id}_Atlas" Path="${paths.model}" HostOnly="true" />`,
        `  <GroundClutterMaterial Id="${id}_Material">`,
        `    <Diffuse Id="${id}_Diffuse" Path="${paths.diffuse}" Category="Terrain" />`,
        `    <Normal Id="${id}_Normal" Path="${paths.normal}" Category="Terrain" />`,
        `    <AoRoughMetal Id="${id}_AoRoughMetal" Path="${paths.orm}" Category="Terrain" />`,
        ...(type.material.opacity || stockUsesCutout(type.stockAssetId)
          ? [
              `    <Opacity Id="${id}_Opacity" Path="${paths.opacity}" Category="Terrain" />`,
              `    <AlphaCutoff Value="${CLUTTER_ALPHA_CUTOFF}" />`,
            ]
          : []),
        ...(stockIsGroundcover(type.stockAssetId)
          ? [
              `    <Thickness Id="${id}_Thickness" Path="${paths.thickness}" Category="Terrain" />`,
              `    <BiasNormalsUp Value="true" />`,
              `    <ApplyExtraSpec Value="true" />`,
              `    <DistanceFadeDither Value="true" />`,
            ]
          : []),
        `    <DoubleSided Value="${type.material.doubleSided || stockUsesCutout(type.stockAssetId) || stockIsGroundcover(type.stockAssetId)}" />`,
        `    <UseTerrainMask Value="${type.material.useTerrainMask}" />`,
        `    <ReceiveShadows Value="true" />`,
        `    <CastShadows Value="${!stockIsGroundcover(type.stockAssetId)}" />`,
        `  </GroundClutterMaterial>`,
        `  <ClutterObject Id="${id}_Object" Atlas="${id}_Atlas">`,
        `    <LODs>`,
        ...[128, 64, 32, 16, 8].map(
          (size, lod) =>
            `      <LOD MinScreenSize="${size}"><Mesh Id="${paths.meshes[lod]}" /><Material Id="${id}_Material" /></LOD>`,
        ),
        `    </LODs>`,
        `  </ClutterObject>`,
      ];
    });
}

export function surfaceClutterBodyXml(project: Project, body: Planet, indent: string): string[] {
  const types = body.kind === "rocky" ? body.clutter.filter((type) => type.enabled) : [];
  if (!types.length) return [];
  const biomeIds = new Map(body.surface.biomes.map((biome) => [biome.id, alias(biome)]));
  return [
    `${indent}<GroundClutter>`,
    ...types.flatMap((type) => {
      const id = `${prefix(project, body)}_Clutter_${safe(type.id)}`,
        d = type.distribution,
        paths = clutterAssetPaths(body, type);
      const mask = d.biomeIds
        .map((biomeId) => {
          const found = biomeIds.get(biomeId);
          if (!found) throw new Error(`${type.name}: unknown biome ${biomeId}`);
          return found;
        })
        .join(",");
      return [
        `${indent}  <Ecotype Name="${escapeXml(type.name)}">`,
        `${indent}    <ClutterObject Id="${id}_Object" />`,
        `${indent}    <CollisionType Value="None" />`,
        `${indent}    <Placement${mask ? ` Biomes="${escapeXml(mask)}"` : ""}>`,
        `${indent}      <DistributionTexture Id="${id}_Distribution" Path="${paths.distribution}" Category="Terrain" />`,
        `${indent}      <ObjectSeparation M="${numeric(d.objectSeparationM)}" />`,
        `${indent}      <GenerationRange M="${numeric(d.generationRangeM)}" />`,
        `${indent}      <DistributionTextureTiling Value="${numeric(d.textureTiling)}" />`,
        `${indent}      <MinScale${vectorXml(d.minScale)} />`,
        `${indent}      <MaxScale${vectorXml(d.maxScale)} />`,
        `${indent}      <Orientation Mode="${d.orientation}" />`,
        `${indent}      <MinRotation Degrees="${numeric(d.minRotationDeg)}" />`,
        `${indent}      <MaxRotation Degrees="${numeric(d.maxRotationDeg)}" />`,
        ...(
          [
            ["SlopeMaskStrength", d.slopeMaskStrength],
            ["SlopeMaskContrast", d.slopeMaskContrast],
            ["SlopeMaskBias", d.slopeMaskBias],
          ] as const
        ).map(([tag, value]) => `${indent}      <${tag} Value="${numeric(value)}" />`),
        ...(d.altitudeDensity.length
          ? [
              `${indent}      <AltitudeDensityCurve>`,
              ...[...d.altitudeDensity]
                .sort((a, b) => a.altitudeM - b.altitudeM)
                .map(
                  (point) =>
                    `${indent}        <SplinePoint><Key Value="${numeric(point.altitudeM)}" /><Value Value="${numeric(point.density)}" /><InTangent Value="0" /><OutTangent Value="0" /></SplinePoint>`,
                ),
              `${indent}      </AltitudeDensityCurve>`,
            ]
          : []),
        `${indent}      <UseObjectTypeTexture Value="false" />`,
        `${indent}    </Placement>`,
        `${indent}  </Ecotype>`,
      ];
    }),
    `${indent}</GroundClutter>`,
  ];
}

/** The native loader uploads each primitive's complete accessor arrays, so keep each material compact. */
function compactImportedMaterials(geometry: ClutterGeometry, type: ClutterType) {
  return type.importedAsset!.materials.map((_, material) => {
    const remap = new Map<number, number>(),
      sourceVertices: number[] = [],
      indices: number[] = [];
    for (const group of type.importedAsset!.groups.filter((g) => g.material === material))
      for (let at = group.start; at < group.start + group.count; at++) {
        const source = geometry.indices[at];
        let local = remap.get(source);
        if (local === undefined) {
          local = sourceVertices.length;
          remap.set(source, local);
          sourceVertices.push(source);
        }
        indices.push(local);
      }
    const attribute = (source: Float32Array, components: number) => {
      const output = new Float32Array(sourceVertices.length * components);
      sourceVertices.forEach((vertex, index) =>
        output.set(
          source.subarray(vertex * components, (vertex + 1) * components),
          index * components,
        ),
      );
      return output;
    };
    return {
      material,
      geometry: {
        positions: attribute(geometry.positions, 3),
        normals: attribute(geometry.normals, 3),
        uvs: attribute(geometry.uvs, 2),
        tangents: attribute(geometry.tangents, 4),
        indices: Uint32Array.from(indices),
      },
    };
  });
}

/** Each GLB contains all five native LOD meshes, in metres and with a shared material slot. */
export function generateClutterGlb(body: Planet, type: ClutterType): Uint8Array {
  const paths = clutterAssetPaths(body, type),
    binaries: Uint8Array[] = [],
    views: Record<string, number>[] = [],
    accessors: Record<string, unknown>[] = [],
    meshes: Record<string, unknown>[] = [];
  let byteLength = 0;
  const align4 = (n: number) => Math.ceil(n / 4) * 4;
  const importedPrimitives = type.importedAsset
    ? compactImportedMaterials(generateClutterGeometry(type), type)
    : undefined;
  for (let lod = 0; lod < 5; lod++) {
    const sources = importedPrimitives ?? [
      { material: 0, geometry: generateClutterGeometry(type, lod) },
    ];
    const primitives = sources.map(({ material, geometry }) => {
      const attributes: Record<string, number> = {};
      for (const [semantic, array, components] of [
        ["POSITION", geometry.positions, 3],
        ["NORMAL", geometry.normals, 3],
        ["TEXCOORD_0", geometry.uvs, 2],
        ["TANGENT", geometry.tangents, 4],
        ["indices", geometry.indices, 1],
      ] as const) {
        const data = new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
          padded = new Uint8Array(align4(data.length));
        padded.set(data);
        const view = views.length;
        views.push({
          buffer: 0,
          byteOffset: byteLength,
          byteLength: data.length,
          target: semantic === "indices" ? 34963 : 34962,
        });
        binaries.push(padded);
        byteLength += padded.length;
        const accessor: Record<string, unknown> = {
          bufferView: view,
          byteOffset: 0,
          componentType: semantic === "indices" ? 5125 : 5126,
          count: array.length / components,
          type: components === 1 ? "SCALAR" : `VEC${components}`,
        };
        if (semantic === "POSITION") {
          const min = [Infinity, Infinity, Infinity],
            max = [-Infinity, -Infinity, -Infinity];
          for (let at = 0; at < array.length; at++) {
            const axis = at % 3;
            min[axis] = Math.min(min[axis], array[at]);
            max[axis] = Math.max(max[axis], array[at]);
          }
          accessor.min = min;
          accessor.max = max;
        }
        attributes[semantic] = accessors.length;
        accessors.push(accessor);
      }
      const indices = attributes.indices;
      delete attributes.indices;
      return { attributes, indices, material, mode: 4 };
    });
    meshes.push({
      name: paths.meshes[lod],
      primitives,
    });
  }
  const json = {
    asset: {
      version: "2.0",
      generator: type.importedAsset
        ? "Orbit Foundry static GLB import; five unchanged LOD sources"
        : "Orbit Foundry original procedural clutter",
    },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2, 3, 4] }],
    nodes: paths.meshes.map((name, mesh) => ({ name, mesh })),
    meshes,
    materials: type.importedAsset
      ? type.importedAsset.materials.map((material) => ({
          name: material.name,
          doubleSided: material.doubleSided || type.material.doubleSided,
          alphaMode: material.cutout || type.material.opacity ? "MASK" : "OPAQUE",
          alphaCutoff: CLUTTER_ALPHA_CUTOFF,
          pbrMetallicRoughness: {
            baseColorFactor: [1, 1, 1, 1],
            metallicFactor: 1,
            roughnessFactor: 1,
          },
        }))
      : [
          {
            name: `${type.id}_Material`,
            doubleSided:
              type.material.doubleSided ||
              stockUsesCutout(type.stockAssetId) ||
              stockIsGroundcover(type.stockAssetId),
            pbrMetallicRoughness: {
              baseColorFactor: [...parseColor(type.material.color), 1],
              metallicFactor: type.material.metalness,
              roughnessFactor: type.material.roughness,
            },
          },
        ],
    buffers: [{ byteLength }],
    bufferViews: views,
    accessors,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json)),
    jsonLength = align4(encoded.length),
    output = new Uint8Array(12 + 8 + jsonLength + 8 + byteLength),
    view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(32, 20, 20 + jsonLength);
  output.set(encoded, 20);
  const start = 20 + jsonLength;
  view.setUint32(start, byteLength, true);
  view.setUint32(start + 4, 0x004e4942, true);
  let cursor = start + 8;
  for (const data of binaries) {
    output.set(data, cursor);
    cursor += data.length;
  }
  return output;
}

export async function generateSurfaceAssets(
  body: Planet,
  faceSize = 256,
): Promise<GeneratedAsset[]> {
  if (body.kind !== "rocky") return [];
  assertNativeBiomes(body);
  const assets: GeneratedAsset[] = [],
    idFaces: Uint8Array[] = [],
    controlFaces: Uint8Array[] = [],
    sampleSurface = compileSurfaceSampler(body);
  let lastYield = performance.now();
  for (let face = 0; face < 6; face++) {
    const ids = new Uint8Array(faceSize * faceSize * 4),
      controls = new Uint8Array(ids.length);
    for (let y = 0; y < faceSize; y++) {
      for (let x = 0; x < faceSize; x++) {
        const direction = nativeToAuthorDirection(cubeDirection(face, x, y, faceSize)),
          sample = sampleSurface(direction);
        const pixel = encodeBiomePixel(
            sampleBiomeWeights(body, direction, sample.height),
            body.surface.biomes.length,
            body.surface.biomeBlendStrength,
          ),
          at = (y * faceSize + x) * 4;
        ids.set(pixel.ids, at);
        controls.set(pixel.controls, at);
      }
      if ((y & 7) === 7 && performance.now() - lastYield >= 12) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
    idFaces.push(ids);
    controlFaces.push(controls);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assets.push(
    {
      path: `Textures/${body.id}_Biome_ID.ktx2`,
      data: encodeKtx2Cube(idFaces, faceSize, "rgba8", "nearest"),
      mimeType: "image/ktx2",
    },
    {
      path: `Textures/${body.id}_Biome_Control.ktx2`,
      data: encodeKtx2Cube(controlFaces, faceSize, "rgba8"),
      mimeType: "image/ktx2",
    },
  );
  const detailSize = Math.max(64, Math.min(256, faceSize));
  for (const biome of body.surface.biomes)
    for (const side of ["Ground", "Slope"] as const) {
      const paths = biomeMaterialPaths(body, biome, side),
        pixels = generateTerrainPixels(side === "Ground" ? biome.ground : biome.slope, detailSize);
      for (const key of ["diffuse", "normal", "orm", "displacement", "height"] as const)
        assets.push({
          path: paths[key],
          data: await encodePng(detailSize, detailSize, pixels[key]),
          mimeType: "image/png",
        });
    }
  for (const type of body.clutter.filter((entry) => entry.enabled)) {
    if (type.importedAsset) {
      const paths = clutterAssetPaths(body, type);
      assets.push({
        path: paths.model,
        data: generateClutterGlb(body, type),
        mimeType: "model/gltf-binary",
      });
      for (let index = 0; index < type.importedAsset.materials.length; index++) {
        const material = type.importedAsset.materials[index],
          maps = importedClutterMaterialPaths(body, type, index),
          size = importedMaterialSize(type, index),
          pixels = getImportedMaterialPixels(type, index);
        for (const key of [
          "diffuse",
          "normal",
          "orm",
          ...(material.cutout || type.material.opacity ? (["opacity"] as const) : []),
        ] as const)
          assets.push({
            path: maps[key],
            data: await encodePng(size, size, pixels[key]),
            mimeType: "image/png",
          });
      }
      const distribution = generateClutterPixels(
        type,
        importedMaterialSize(type),
        detailSize,
      ).distribution;
      assets.push({
        path: paths.distribution,
        data: await encodePng(detailSize, detailSize, distribution),
        mimeType: "image/png",
      });
      continue;
    }
    const paths = clutterAssetPaths(body, type),
      materialSize = type.stockAssetId ? STOCK_TEXTURE_SIZE : detailSize,
      pixels = generateClutterPixels(type, materialSize, detailSize);
    assets.push({
      path: paths.model,
      data: generateClutterGlb(body, type),
      mimeType: "model/gltf-binary",
    });
    for (const key of [
      "diffuse",
      "normal",
      "orm",
      "distribution",
      ...(type.material.opacity || stockUsesCutout(type.stockAssetId)
        ? (["opacity"] as const)
        : []),
    ] as const) {
      const isMaterial =
          key === "diffuse" ||
          key === "normal" ||
          key === "orm" ||
          (key === "opacity" && stockUsesCutout(type.stockAssetId)),
        size = isMaterial ? materialSize : detailSize;
      assets.push({
        path: paths[key],
        data: await encodePng(size, size, pixels[key]),
        mimeType: "image/png",
      });
    }
    if (!type.importedAsset && stockIsGroundcover(type.stockAssetId)) {
      const thickness = getStockPixels(
        type.stockAssetId!,
        STOCK_TEXTURE_SIZE,
        type.material,
        type.seed,
      ).thickness!;
      assets.push({
        path: paths.thickness,
        data: await encodePng(STOCK_TEXTURE_SIZE, STOCK_TEXTURE_SIZE, thickness),
        mimeType: "image/png",
      });
    }
  }
  return assets;
}
