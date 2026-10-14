import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Celestial, ClutterType, Planet, StarSystem } from "../lib/types";
import { isPlanet } from "../lib/types";
import {
  bodyOrbitScale,
  bodyPosition,
  orbitPoint,
  physicalBodyRadiusAu,
  physicalScenePosition,
  physicalSystemLayout,
  type PhysicalSystemLayout,
} from "../lib/orbits";
import {
  compileSurfaceSampler,
  nativeLocationDirection,
  nativeToAuthorDirection,
} from "../lib/procedural";
import { generateClutterGeometry, generateClutterPixels } from "../lib/surface";
import {
  CLUTTER_ALPHA_CUTOFF,
  stockScatterLod,
  stockIsGroundcover,
  stockPreviewInstanceLimit,
  stockUsesCutout,
  STOCK_TEXTURE_SIZE,
} from "../lib/stock-assets";
import {
  getImportedGeometry,
  getImportedMaterialPixels,
  importedMaterialSize,
} from "../lib/imported-clutter";
import {
  addAtmospherePreview,
  createOceanPreviewMaterial,
  disposePreviewMaterial,
  updateAtmospherePreview,
  updateOceanPreview,
} from "../lib/atmospherePreview";
import { terrainHitToNativeSite } from "../lib/sitePlacement";
import { sampleClutterPatch } from "../lib/clutterPreview";

type Props = {
  system: StarSystem;
  selected: Celestial;
  mode: "surface" | "system" | "clutter";
  days: number;
  grid: boolean;
  realScale?: boolean;
  onSelect: (id: string) => void;
  resetKey: number;
  placingSite?: boolean;
  onSitePoint?: (latitude: number, longitude: number) => void;
  onCancelSitePlacement?: () => void;
  clutterPreview?: "library" | "asset" | "scatter";
  selectedClutterId?: string | null;
  clutterPatch?: { sizeM: number; latitude: number; longitude: number };
};
function textureFor(body: Planet) {
  const width = 384,
    height = 192,
    pixels = new Uint8Array(width * height * 4),
    dir: [number, number, number] = [0, 0, 0],
    heights = new Float32Array(width * height),
    normalPixels = new Uint8Array(width * height * 4),
    roughPixels = new Uint8Array(width * height * 4),
    oceanPixels =
      body.kind === "rocky" && body.ocean.enabled ? new Uint8Array(width * height * 4) : null;
  const sampleSurface = compileSurfaceSampler(body);
  for (let y = 0; y < height; y++) {
    const phi = ((y + 0.5) / height) * Math.PI;
    for (let x = 0; x < width; x++) {
      const theta = ((x + 0.5) / width) * Math.PI * 2;
      dir[0] = -Math.sin(phi) * Math.cos(theta);
      dir[1] = Math.cos(phi);
      dir[2] = Math.sin(phi) * Math.sin(theta);
      const s = sampleSurface(dir);
      const i = (y * width + x) * 4;
      pixels[i] = Math.round(s.color[0] * 255);
      pixels[i + 1] = Math.round(s.color[1] * 255);
      pixels[i + 2] = Math.round(s.color[2] * 255);
      pixels[i + 3] = 255;
      heights[y * width + x] = (s.height - body.surface.seaLevel) * body.surface.elevation;
      const roughness =
        body.kind === "rocky"
          ? (body.surface.biomes[s.biome]?.ground.roughness ?? body.surface.roughness)
          : body.surface.roughness;
      roughPixels.set([255, Math.round(roughness * 255), 0, 255], i);
      if (oceanPixels) {
        const groundKm = (s.height - body.surface.seaLevel) * body.surface.elevation;
        const depthM = Math.max(0, (body.ocean.levelKm - groundKm) * 1000);
        // A generated depth map lets shallow water reveal the same displaced seabed.
        const alpha = 1 - Math.exp(-depthM / Math.max(0.01, body.ocean.transparencyDepthM));
        oceanPixels[i] = oceanPixels[i + 1] = oceanPixels[i + 2] = Math.round(alpha * 255);
        oceanPixels[i + 3] = 255;
      }
    }
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const left = heights[y * width + ((x + width - 1) % width)],
        right = heights[y * width + ((x + 1) % width)];
      const up = heights[Math.max(0, y - 1) * width + x],
        down = heights[Math.min(height - 1, y + 1) * width + x];
      const latitude = Math.PI * (0.5 - (y + 0.5) / height);
      const nx =
        body.kind === "rocky"
          ? -(right - left) /
            ((body.radiusKm * Math.max(0.01, Math.cos(latitude)) * Math.PI * 4) / width)
          : 0;
      const ny =
        body.kind === "rocky" ? -(up - down) / ((body.radiusKm * Math.PI * 2) / height) : 0;
      const length = Math.hypot(nx, ny, 1);
      normalPixels.set(
        [
          Math.round(((nx / length) * 0.5 + 0.5) * 255),
          Math.round(((ny / length) * 0.5 + 0.5) * 255),
          Math.round(((1 / length) * 0.5 + 0.5) * 255),
          255,
        ],
        (y * width + x) * 4,
      );
    }
  const t = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.flipY = true;
  t.needsUpdate = true;
  const oceanAlpha = oceanPixels
    ? new THREE.DataTexture(oceanPixels, width, height, THREE.RGBAFormat)
    : null;
  if (oceanAlpha) {
    oceanAlpha.magFilter = oceanAlpha.minFilter = THREE.LinearFilter;
    oceanAlpha.wrapS = THREE.RepeatWrapping;
    oceanAlpha.flipY = true;
    oceanAlpha.needsUpdate = true;
  }
  const normal = new THREE.DataTexture(normalPixels, width, height, THREE.RGBAFormat);
  const roughness = new THREE.DataTexture(roughPixels, width, height, THREE.RGBAFormat);
  for (const texture of [normal, roughness]) {
    texture.flipY = true;
    texture.wrapS = THREE.RepeatWrapping;
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }
  return { surface: t, oceanAlpha, normal, roughness };
}
function ringTexture(body: Planet) {
  const width = 2048,
    data = new Uint8Array(width * 4);
  const a = new THREE.Color(body.rings.color),
    b = new THREE.Color(body.rings.secondaryColor);
  for (let x = 0; x < width; x++) {
    const t = x / (width - 1),
      v =
        0.5 +
        0.3 * Math.sin(t * body.rings.bands * 2 + body.rings.seed) +
        0.2 * Math.sin(t * body.rings.bands * 4.7);
    const c = a.clone().lerp(b, v);
    data[x * 4] = c.r * 255;
    data[x * 4 + 1] = c.g * 255;
    data[x * 4 + 2] = c.b * 255;
    data[x * 4 + 3] = (0.15 + 0.85 * v) * body.rings.opacity * 255;
  }
  const tx = new THREE.DataTexture(data, width, 1);
  tx.needsUpdate = true;
  tx.magFilter = THREE.LinearFilter;
  tx.minFilter = THREE.LinearMipmapLinearFilter;
  tx.generateMipmaps = true;
  tx.anisotropy = 8;
  return tx;
}
function planetMesh(body: Planet, radius: number, detailed: boolean, physical = false) {
  const sampleSurface = compileSurfaceSampler(body);
  const geom = new THREE.SphereGeometry(radius, detailed ? 128 : 48, detailed ? 64 : 24);
  if (
    (detailed || body.ocean.enabled || physical) &&
    body.kind === "rocky" &&
    body.surface.elevation > 0
  ) {
    const p = geom.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const n = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
      const h = sampleSurface([n.x, n.y, n.z]).height;
      const r =
        radius *
        Math.max(0.001, 1 + ((h - body.surface.seaLevel) * body.surface.elevation) / body.radiusKm);
      p.setXYZ(i, n.x * r, n.y * r, n.z * r);
    }
    geom.computeVertexNormals();
  }
  const tex = textureFor(body);
  const material = new THREE.MeshStandardMaterial({
    map: tex.surface,
    normalMap: tex.normal,
    roughnessMap: tex.roughness,
    roughness: 1,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.rotation.z = (body.rotation.tilt * Math.PI) / 180;
  mesh.userData.bodyId = body.id;
  mesh.userData.rockyTerrain = body.kind === "rocky";
  if (body.kind === "rocky" && body.ocean.enabled && tex.oceanAlpha) {
    const oceanRadius = radius * (1 + body.ocean.levelKm / body.radiusKm);
    if (oceanRadius > 0 && Number.isFinite(oceanRadius)) {
      const water = new THREE.Mesh(
        new THREE.SphereGeometry(oceanRadius, detailed ? 128 : 48, detailed ? 64 : 24),
        createOceanPreviewMaterial(body.ocean, tex.oceanAlpha),
      );
      water.name = "Ocean";
      water.userData.bodyId = body.id;
      mesh.add(water);
    } else tex.oceanAlpha.dispose();
  }
  addAtmospherePreview(mesh, body, radius, detailed);
  if (detailed && body.kind === "rocky") {
    for (const site of body.landmarks.filter((site) => site.enabled)) {
      const direction = new THREE.Vector3().fromArray(
        nativeToAuthorDirection(nativeLocationDirection(site.latitude, site.longitude)),
      );
      const heightKm =
        (sampleSurface([direction.x, direction.y, direction.z]).height - body.surface.seaLevel) *
        body.surface.elevation;
      const marker = new THREE.Mesh(
        site.launchPad
          ? new THREE.ConeGeometry(radius * 0.008, radius * 0.025, 4)
          : new THREE.SphereGeometry(radius * 0.006, 10, 6),
        new THREE.MeshBasicMaterial({ color: site.color, depthTest: true }),
      );
      marker.position
        .copy(direction)
        .multiplyScalar(
          radius * (1 + (heightKm + site.groundOffsetM / 1000) / body.radiusKm) + radius * 0.012,
        );
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      marker.name = `${site.launchPad ? "Launch pad" : site.category}: ${site.name}`;
      marker.userData.bodyId = body.id;
      mesh.add(marker);
    }
  }
  if (body.rings.enabled) {
    const g = new THREE.RingGeometry(
      radius * body.rings.innerRadius,
      radius * body.rings.outerRadius,
      192,
      32,
    );
    const p = g.attributes.position,
      uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const len = Math.hypot(p.getX(i), p.getY(i));
      uv.setXY(
        i,
        (len / radius - body.rings.innerRadius) / (body.rings.outerRadius - body.rings.innerRadius),
        0.5,
      );
    }
    const ring = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        map: ringTexture(body),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    mesh.add(ring);
  }
  return mesh;
}

function clutterExtent(body: Planet): number {
  const types = body.clutter.filter((type) => type.enabled);
  const largest = Math.max(
    0.5,
    ...types.flatMap((type) =>
      type.geometry.dimensionsM.map(
        (v, i) => (v * (type.distribution.minScale[i] + type.distribution.maxScale[i])) / 2,
      ),
    ),
  );
  return largest * Math.max(1.3, Math.ceil(Math.sqrt(types.length))) * 1.4;
}

function clutterTexture(data: Uint8Array, size: number, color = false) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false; // Row zero is UV v=0 in both native PNGs and browser atlases.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function clutterMesh(type: ClutterType, lod = 0) {
  const generated = type.importedAsset
    ? getImportedGeometry(type, lod)
    : generateClutterGeometry(type, lod);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(generated.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(generated.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(generated.uvs, 2));
  geometry.setAttribute("uv1", new THREE.BufferAttribute(generated.uvs.slice(), 2));
  geometry.setAttribute("tangent", new THREE.BufferAttribute(generated.tangents, 4));
  geometry.setIndex(new THREE.BufferAttribute(generated.indices, 1));
  const makeMaterial = (
    pixels: { diffuse: Uint8Array; normal: Uint8Array; orm: Uint8Array; opacity: Uint8Array },
    size: number,
    opacity: boolean,
    opacitySize: number,
    doubleSided: boolean,
  ) => {
    const orm = clutterTexture(pixels.orm, size);
    return new THREE.MeshStandardMaterial({
      map: clutterTexture(pixels.diffuse, size, true),
      normalMap: clutterTexture(pixels.normal, size),
      roughnessMap: orm,
      metalnessMap: orm,
      aoMap: orm,
      roughness: 1,
      metalness: 1,
      alphaMap: opacity ? clutterTexture(pixels.opacity, opacitySize) : null,
      alphaTest: opacity ? CLUTTER_ALPHA_CUTOFF : 0,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
  };
  let material: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
  if (type.importedAsset) {
    const groups = (generated as ReturnType<typeof getImportedGeometry>).groups;
    for (const group of groups) geometry.addGroup(group.start, group.count, group.material);
    material = type.importedAsset.materials.map((source, index) => {
      const size = importedMaterialSize(type, index);
      return makeMaterial(
        getImportedMaterialPixels(type, index),
        size,
        source.cutout || type.material.opacity,
        size,
        source.doubleSided || type.material.doubleSided,
      );
    });
  } else {
    const size = type.stockAssetId ? STOCK_TEXTURE_SIZE : 128,
      cutout = stockUsesCutout(type.stockAssetId);
    material = makeMaterial(
      generateClutterPixels(type, size, 128),
      size,
      type.material.opacity || cutout,
      cutout ? size : 128,
      type.material.doubleSided || cutout || stockIsGroundcover(type.stockAssetId),
    );
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = type.name;
  mesh.scale.fromArray(
    type.distribution.minScale.map((v, i) => (v + type.distribution.maxScale[i]) / 2) as [
      number,
      number,
      number,
    ],
  );
  return mesh;
}

/** A material/geometry garden for every enabled type, with metre-sized bounds. */
function clutterGarden(body: Planet): THREE.Group {
  const group = new THREE.Group(),
    types = body.clutter.filter((type) => type.enabled);
  const columns = Math.ceil(Math.sqrt(types.length)),
    rows = Math.ceil(types.length / Math.max(1, columns));
  const spacing = (clutterExtent(body) / Math.max(1, columns)) * 1.3;
  types.forEach((type, index) => {
    const mesh = clutterMesh(type),
      column = index % columns,
      row = Math.floor(index / columns);
    mesh.position.set(
      (column - (columns - 1) / 2) * spacing,
      -0.6,
      (row - (rows - 1) / 2) * spacing,
    );
    mesh.userData.bodyId = body.id;
    group.add(mesh);
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.font = "24px system-ui";
    context.fillStyle = "#c7d0dc";
    context.textAlign = "center";
    context.fillText(type.name, 192, 38);
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        depthWrite: false,
      }),
    );
    label.position.copy(mesh.position).add(new THREE.Vector3(0, -spacing * 0.14, 0));
    label.scale.set(spacing * 0.8, (spacing * 0.8) / 6, 1);
    group.add(label);
  });
  return group;
}

function framedClutter(object: THREE.Group, summary: string) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return { object, summary, extent: 1, bounds: null };
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const extent = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
  return { object, summary, extent, bounds: box.translate(center.negate()) };
}

function clutterPreviewObject(
  body: Planet,
  kind: "library" | "asset" | "scatter",
  selectedId: string | null,
  patch: { sizeM: number; latitude: number; longitude: number },
) {
  if (kind === "library") {
    return framedClutter(
      clutterGarden(body),
      `Entire library · ${body.clutter.filter((type) => type.enabled).length} enabled assets · mean distribution scale`,
    );
  }
  const type = body.clutter.find((type) => type.id === selectedId) ?? body.clutter[0];
  const object = new THREE.Group();
  object.userData.clutterPreviewKind = kind;
  if (!type)
    return {
      object,
      extent: 1,
      bounds: null,
      summary: "No clutter asset selected. Add a clutter type to preview it.",
    };
  object.userData.clutterTypeId = type.id;
  if (kind === "asset") {
    const asset = clutterMesh(type);
    asset.scale.setScalar(1);
    object.add(asset);
    const dimensions = type.geometry.dimensionsM.map((v) => Number(v.toPrecision(4))).join(" × ");
    return framedClutter(
      object,
      `${type.name} · Selected asset · ${dimensions} m${type.enabled ? "" : " · disabled for scatter"}`,
    );
  }
  const instanceLimit = type.importedAsset
    ? Math.max(1, Math.min(256, Math.floor(600_000 / type.importedAsset.triangleCount)))
    : stockPreviewInstanceLimit(type.stockAssetId);
  const sampled = sampleClutterPatch(body, type, { ...patch, maxInstances: instanceLimit });
  const ground = new THREE.BufferGeometry();
  ground.setAttribute("position", new THREE.BufferAttribute(sampled.ground.positions, 3));
  ground.setIndex(new THREE.BufferAttribute(sampled.ground.indices, 1));
  ground.setAttribute("color", new THREE.BufferAttribute(sampled.ground.colors, 3));
  ground.computeVertexNormals();
  const terrain = new THREE.Mesh(
    ground,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: body.surface.roughness,
      side: THREE.DoubleSide,
    }),
  );
  terrain.name = "Clutter terrain patch";
  terrain.userData.patchSizeM = sampled.sizeM;
  object.add(terrain);
  const averageSize = Math.max(
    ...type.geometry.dimensionsM.map(
      (size, axis) =>
        (size * (type.distribution.minScale[axis] + type.distribution.maxScale[axis])) / 2,
    ),
  );
  const lod = stockScatterLod(
    type.stockAssetId,
    (averageSize / sampled.sizeM) * 900,
    sampled.instances.length,
  );
  const asset = clutterMesh(type, lod);
  const instances = new THREE.InstancedMesh(
    asset.geometry,
    asset.material,
    Math.max(1, sampled.instances.length),
  );
  instances.count = sampled.instances.length;
  instances.name = `${type.name} scatter`;
  instances.userData.clutterLod = lod;
  const position = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion(),
    yaw = new THREE.Quaternion(),
    up = new THREE.Vector3(0, 1, 0),
    matrix = new THREE.Matrix4();
  sampled.instances.forEach((instance, index) => {
    position.fromArray(instance.position);
    normal.fromArray(instance.normal);
    scale.fromArray(instance.scale);
    rotation.setFromUnitVectors(up, normal.normalize());
    yaw.setFromAxisAngle(up, (instance.rotationDeg * Math.PI) / 180);
    rotation.multiply(yaw);
    matrix.compose(position, rotation, scale);
    instances.setMatrixAt(index, matrix);
  });
  instances.instanceMatrix.needsUpdate = true;
  instances.computeBoundingSphere();
  object.add(instances);
  const expectedCount =
    sampled.eligibleEstimate > 0 && sampled.eligibleEstimate < 1
      ? Number(sampled.eligibleEstimate.toPrecision(2)).toString()
      : Math.round(sampled.eligibleEstimate).toLocaleString();
  const summary = `${type.name} · ${sampled.sizeM} × ${sampled.sizeM} m patch · ${sampled.instances.length} drawn · ~${expectedCount} estimated eligible${sampled.capped ? ` · preview capped at ${instanceLimit}` : ""}${sampled.samplingCapped ? ` · ${sampled.samplesEvaluated} candidate samples` : ""} · approximate distribution`;
  return framedClutter(object, summary);
}

export function Viewport({
  system,
  selected,
  mode,
  days,
  grid,
  realScale = false,
  onSelect,
  resetKey,
  placingSite = false,
  onSitePoint,
  onCancelSitePlacement,
  clutterPreview = "library",
  selectedClutterId = null,
  clutterPatch = { sizeM: 500, latitude: 0, longitude: 0 },
}: Props) {
  const mount = useRef<HTMLDivElement>(null),
    sceneRef = useRef<{
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      controls: OrbitControls;
      keyLight: THREE.DirectionalLight;
      fillLight: THREE.DirectionalLight;
      ambientLight: THREE.AmbientLight;
      objects: THREE.Object3D[];
      frame: number;
      resize: ResizeObserver;
      physicalLayout: PhysicalSystemLayout | null;
      clutterViewExtent: number | null;
      clutterFrameKey: string | null;
      clutterViewBounds: THREE.Box3 | null;
    } | null>(null),
    daysRef = useRef(days);
  daysRef.current = days;
  const viewRef = useRef({ mode, selected, system });
  viewRef.current = { mode, selected, system };
  const canPlaceSite =
    placingSite && mode === "surface" && isPlanet(selected) && selected.kind === "rocky";
  const placementRef = useRef({
    active: canPlaceSite,
    bodyId: selected.id,
    onSitePoint,
    onCancelSitePlacement,
  });
  placementRef.current = {
    active: canPlaceSite,
    bodyId: selected.id,
    onSitePoint,
    onCancelSitePlacement,
  };
  // Selection changes only focus/highlighting in System view, not its generated assets.
  const previewBody = mode === "system" ? null : selected;
  const [error, setError] = useState("");
  const [clutterSummary, setClutterSummary] = useState("");
  const clutterSignature =
    mode === "clutter"
      ? `${clutterPreview}:${selectedClutterId}:${clutterPatch.sizeM}:${clutterPatch.latitude}:${clutterPatch.longitude}`
      : null;
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        logarithmicDepthBuffer: true,
      });
    } catch (e) {
      setError(
        "WebGL is unavailable. The editor and export still work; enable graphics acceleration for the 3D preview.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 2000);
    camera.position.set(0, 1.2, 8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.5;
    controls.maxDistance = 200;
    const ambient = new THREE.AmbientLight("#b1c4de", 0.4);
    scene.add(ambient);
    const key = new THREE.DirectionalLight("#ffefdc", 3.2);
    key.position.set(-5, 3, 5);
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    scene.add(key.target);
    const fill = new THREE.DirectionalLight("#577dae", 0.4);
    fill.position.set(4, 0, -3);
    scene.add(fill);
    const points = new Float32Array(2400);
    for (let i = 0; i < 800; i++) {
      const n = i * 12.9898;
      const y = Math.sin(n) * 130,
        theta = i * 2.39996,
        r = Math.sqrt(180 * 180 - y * y);
      points[i * 3] = Math.cos(theta) * r;
      points[i * 3 + 1] = y;
      points[i * 3 + 2] = Math.sin(theta) * r;
    }
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(points, 3)),
      new THREE.PointsMaterial({
        color: "#9aafc8",
        size: 0.2,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.65,
      }),
    );
    scene.add(stars);
    const resize = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      fitCamera(
        camera,
        controls,
        viewRef.current.mode,
        viewRef.current.selected,
        sceneRef.current?.physicalLayout,
        sceneRef.current?.clutterViewExtent,
        sceneRef.current?.clutterViewBounds,
      );
    });
    resize.observe(host);
    const state = {
      renderer,
      scene,
      camera,
      controls,
      keyLight: key,
      fillLight: fill,
      ambientLight: ambient,
      objects: [] as THREE.Object3D[],
      frame: 0,
      resize,
      physicalLayout: null as PhysicalSystemLayout | null,
      clutterViewExtent: null as number | null,
      clutterFrameKey: null as string | null,
      clutterViewBounds: null as THREE.Box3 | null,
    };
    sceneRef.current = state;
    function animate() {
      state.frame = requestAnimationFrame(animate);
      for (const obj of state.objects) {
        if (obj.userData.celestial && obj.userData.overview) {
          const b = obj.userData.celestial as Celestial;
          const position = bodyPosition(
            b,
            obj.userData.bodies,
            daysRef.current,
            !obj.userData.physicalLayout,
          );
          obj.position.fromArray(
            obj.userData.physicalLayout
              ? physicalScenePosition(position, obj.userData.physicalLayout)
              : position,
          );
        }
        if (obj.userData.orbitParent) {
          const position = bodyPosition(
            obj.userData.orbitParent,
            obj.userData.bodies,
            daysRef.current,
            !obj.userData.physicalLayout,
          );
          obj.position.fromArray(
            obj.userData.physicalLayout
              ? physicalScenePosition(position, obj.userData.physicalLayout)
              : position,
          );
        }
        if (obj.userData.surface) obj.rotation.y = daysRef.current * 0.05;
        updateAtmospherePreview(obj, daysRef.current * 86400);
        updateOceanPreview(obj, daysRef.current * 86400);
      }
      if (!placementRef.current.active) controls.update();
      const view = viewRef.current;
      stars.visible = view.mode !== "clutter";
      if (view.mode === "system") {
        centerOnBody(
          camera,
          controls,
          view.selected,
          view.system.bodies,
          daysRef.current,
          state.physicalLayout,
        );
      }
      if (state.physicalLayout) {
        // Keep the backdrop at infinity when traversing a scene with a floating origin.
        stars.position.copy(camera.position);
        const far = Math.max(
          1000,
          camera.position.distanceTo(controls.target) + state.physicalLayout.extent * 4,
        );
        if (far !== camera.far) {
          camera.far = far;
          camera.updateProjectionMatrix();
        }
      } else stars.position.set(0, 0, 0);
      renderer.render(scene, camera);
    }
    animate();
    return () => {
      cancelAnimationFrame(state.frame);
      resize.disconnect();
      controls.dispose();
      scene.traverse(dispose);
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);
  useEffect(() => {
    const controls = sceneRef.current?.controls;
    if (!controls) return;
    controls.enabled = !canPlaceSite;
    return () => {
      controls.enabled = true;
    };
  }, [canPlaceSite]);
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const place = (event: MouseEvent) => {
      const placement = placementRef.current;
      if (!placement.active || event.button !== 0) return;
      const terrain = s.objects.filter(
        (object) => object.userData.rockyTerrain && object.userData.bodyId === placement.bodyId,
      );
      if (!terrain.length) return;
      const rect = s.renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      );
      s.camera.updateMatrixWorld();
      terrain.forEach((object) => object.updateWorldMatrix(true, false));
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, s.camera);
      // Children include water, rings, clouds, atmosphere and site markers.
      // Only the actual displaced terrain mesh is a placement target.
      const hit = ray.intersectObjects(terrain, false)[0];
      if (!hit) return;
      const coordinates = terrainHitToNativeSite(hit.object, hit.point);
      if (coordinates) placement.onSitePoint?.(coordinates.latitude, coordinates.longitude);
    };
    const cancel = (event: KeyboardEvent) => {
      if (!placementRef.current.active || event.key !== "Escape" || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      placementRef.current.onCancelSitePlacement?.();
    };
    s.renderer.domElement.addEventListener("click", place);
    window.addEventListener("keydown", cancel, true);
    return () => {
      s.renderer.domElement.removeEventListener("click", place);
      window.removeEventListener("keydown", cancel, true);
    };
  }, []);
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    let timeout = window.setTimeout(() => {
      const selected = previewBody ?? viewRef.current.selected;
      for (const o of s.objects) {
        s.scene.remove(o);
        o.traverse(dispose);
      }
      s.objects = [];
      s.physicalLayout =
        mode === "system" && realScale ? physicalSystemLayout(system.bodies) : null;
      const add = (o: THREE.Object3D) => {
        s.scene.add(o);
        s.objects.push(o);
      };
      let refitClutter = false;
      const studio = mode === "clutter" && clutterPreview !== "scatter";
      s.renderer.shadowMap.enabled = studio;
      s.keyLight.castShadow = studio;
      s.scene.background = mode === "clutter" ? new THREE.Color("#20262c") : null;
      s.ambientLight.color.set(studio ? "#e6edf0" : "#b1c4de");
      s.ambientLight.intensity = studio ? 1.6 : 0.4;
      s.keyLight.color.set(studio ? "#fff4e6" : "#ffefdc");
      s.keyLight.intensity = studio ? 3 : 3.2;
      s.fillLight.color.set(studio ? "#c9ddeb" : "#577dae");
      s.fillLight.intensity = studio ? 1.3 : 0.4;
      s.renderer.toneMappingExposure = studio ? 1.15 : 1.35;
      s.keyLight.position.set(-5, 3, 5);
      s.keyLight.target.position.set(0, 0, 0);
      if (mode === "clutter" && isPlanet(selected)) {
        const preview = clutterPreviewObject(
          selected,
          clutterPreview,
          selectedClutterId,
          clutterPatch,
        );
        refitClutter =
          s.clutterViewExtent !== preview.extent || s.clutterFrameKey !== clutterSignature;
        s.clutterViewExtent = preview.extent;
        s.clutterFrameKey = clutterSignature;
        s.clutterViewBounds = preview.bounds;
        setClutterSummary(preview.summary);
        add(preview.object);
        if (studio && preview.bounds) {
          // Ground and lighting do not contribute to fitting the asset's actual bounds.
          const radius = Math.max(0.2, preview.extent);
          const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(radius * 12, radius * 12),
            new THREE.MeshStandardMaterial({ color: "#42494d", roughness: 0.96 }),
          );
          floor.name = "Clutter studio floor";
          floor.rotation.x = -Math.PI / 2;
          floor.position.y = preview.bounds.min.y - radius * 0.002;
          floor.receiveShadow = true;
          add(floor);
          preview.object.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.castShadow = true;
              object.receiveShadow = true;
            }
          });
          s.keyLight.position.set(-radius * 2, radius * 3, radius * 2);
          s.keyLight.shadow.camera.left = s.keyLight.shadow.camera.bottom = -radius * 1.5;
          s.keyLight.shadow.camera.right = s.keyLight.shadow.camera.top = radius * 1.5;
          s.keyLight.shadow.camera.near = radius * 0.1;
          s.keyLight.shadow.camera.far = radius * 9;
          s.keyLight.shadow.camera.updateProjectionMatrix();
          s.keyLight.shadow.normalBias = radius * 0.0006;
          s.keyLight.shadow.bias = -0.0001;
          // These are static authoring specimens; moving the camera needs no shadow redraw.
          s.renderer.shadowMap.needsUpdate = true;
        }
      } else if (mode === "surface") {
        if (isPlanet(selected)) {
          const obj = planetMesh(selected, 2, true);
          obj.userData.surface = true;
          add(obj);
        } else if (selected.kind === "star") {
          const obj = new THREE.Mesh(
            new THREE.SphereGeometry(2, 96, 64),
            new THREE.MeshBasicMaterial({ color: selected.color }),
          );
          add(obj);
          const glow = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: glowTexture(selected.color),
              transparent: true,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          );
          glow.scale.setScalar(7);
          add(glow);
        } else {
          const g = new THREE.Group();
          for (const b of system.bodies.filter(
            (b) => b.parentId === selected.id && b.kind === "star",
          )) {
            const obj = new THREE.Mesh(
              new THREE.SphereGeometry(0.7, 48, 24),
              new THREE.MeshBasicMaterial({ color: b.kind === "star" ? b.color : "#fff" }),
            );
            obj.position.fromArray(bodyPosition(b, system.bodies, 0)).multiplyScalar(0.15);
            g.add(obj);
          }
          add(g);
        }
      } else {
        const layout = s.physicalLayout;
        for (const body of system.bodies) {
          let obj: THREE.Object3D;
          if (body.kind === "barycenter") continue;
          if (body.kind === "star") {
            obj = new THREE.Mesh(
              new THREE.SphereGeometry(
                layout ? physicalBodyRadiusAu(body) * layout.scale : 1.15,
                48,
                24,
              ),
              new THREE.MeshBasicMaterial({ color: body.color }),
            );
          } else
            obj = planetMesh(
              body,
              layout
                ? physicalBodyRadiusAu(body) * layout.scale
                : Math.max(0.22, Math.min(0.85, Math.log10(body.radiusKm) / 6)),
              false,
              !!layout,
            );
          obj.userData = {
            bodyId: body.id,
            celestial: body,
            bodies: system.bodies,
            overview: true,
            physicalLayout: layout,
          };
          const position = bodyPosition(body, system.bodies, daysRef.current, !layout);
          obj.position.fromArray(layout ? physicalScenePosition(position, layout) : position);
          add(obj);
          if (body.parentId) {
            const parent = system.bodies.find((b) => b.id === body.parentId);
            const pts: THREE.Vector3[] = [];
            for (let i = 0; i <= 180; i++)
              pts.push(
                new THREE.Vector3().fromArray(
                  orbitPoint(
                    body.orbit,
                    (i / 180) * Math.PI * 2,
                    bodyOrbitScale(body, system.bodies, !layout) * (layout?.scale ?? 1),
                  ),
                ),
              );
            const line = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(pts),
              new THREE.LineBasicMaterial({
                color: body.id === selected.id ? "#e4b785" : "#354152",
                transparent: true,
                opacity: 0.65,
              }),
            );
            line.userData.orbitBodyId = body.id;
            if (parent) {
              Object.assign(line.userData, {
                orbitParent: parent,
                bodies: system.bodies,
                physicalLayout: layout,
              });
              const position = bodyPosition(parent, system.bodies, daysRef.current, !layout);
              line.position.fromArray(layout ? physicalScenePosition(position, layout) : position);
            }
            add(line);
          }
        }
      }
      if (grid) {
        const helper = new THREE.GridHelper(
          mode === "system" ? 90 : mode === "clutter" ? (s.clutterViewExtent ?? 6) * 2 : 12,
          mode === "system" ? 30 : 12,
          "#394352",
          "#242e3b",
        );
        helper.position.y =
          mode === "surface"
            ? -2.5
            : studio && s.clutterViewBounds
              ? s.clutterViewBounds.min.y
              : -0.02;
        add(helper);
      }
      if (refitClutter)
        fitCamera(
          s.camera,
          s.controls,
          mode,
          selected,
          null,
          s.clutterViewExtent,
          s.clutterViewBounds,
        );
      if (s.physicalLayout) {
        centerOnBody(
          s.camera,
          s.controls,
          selected,
          system.bodies,
          daysRef.current,
          s.physicalLayout,
        );
        fitCamera(s.camera, s.controls, mode, selected, s.physicalLayout);
      }
    }, 100);
    return () => clearTimeout(timeout);
  }, [system, previewBody, mode, grid, realScale, clutterSignature]);
  useEffect(() => {
    if (mode !== "system") return;
    for (const obj of sceneRef.current?.objects ?? []) {
      if (obj instanceof THREE.Line && obj.userData.orbitBodyId) {
        (obj.material as THREE.LineBasicMaterial).color.set(
          obj.userData.orbitBodyId === selected.id ? "#e4b785" : "#354152",
        );
      }
    }
  }, [mode, selected.id]);
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    // Keep System view locked to its selected body while orbit/zoom stay available.
    s.controls.enablePan = mode !== "system";
    s.controls.target.set(0, 0, 0);
    s.camera.position.set(0, mode === "surface" ? 1 : 35, mode === "surface" ? 8 : 55);
    const layout = mode === "system" && realScale ? physicalSystemLayout(system.bodies) : null;
    if (mode === "system")
      centerOnBody(s.camera, s.controls, selected, system.bodies, daysRef.current, layout);
    fitCamera(
      s.camera,
      s.controls,
      mode,
      selected,
      layout,
      s.clutterViewExtent,
      s.clutterViewBounds,
    );
    s.controls.update();
  }, [
    mode,
    resetKey,
    realScale,
    selected.id,
    system.id,
    isPlanet(selected) && selected.rings.enabled,
    isPlanet(selected) && selected.rings.outerRadius,
    isPlanet(selected) && selected.ocean.enabled,
    isPlanet(selected) && selected.ocean.levelKm,
    mode === "clutter" && isPlanet(selected) && clutterExtent(selected),
  ]);
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const handler = (e: MouseEvent) => {
      if (mode !== "system") return;
      const rect = s.renderer.domElement.getBoundingClientRect(),
        pointer = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, s.camera);
      const hit = ray.intersectObjects(s.objects, true).find((h) => h.object.userData.bodyId);
      if (hit) onSelect(hit.object.userData.bodyId);
    };
    s.renderer.domElement.addEventListener("dblclick", handler);
    return () => s.renderer.domElement.removeEventListener("dblclick", handler);
  }, [mode, onSelect]);
  return (
    <div
      className="viewport"
      ref={mount}
      aria-label={`${selected.name} 3D preview`}
      style={{ cursor: canPlaceSite ? "crosshair" : undefined }}
    >
      {canPlaceSite && (
        <div
          role="status"
          className="site-placement-status"
          style={{
            position: "absolute",
            top: 18,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 3,
            pointerEvents: "none",
            color: "#eddec8",
            background: "#111924e6",
            border: "1px solid #6b5842",
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          Click the planet to place this site · Esc to cancel
        </div>
      )}
      {mode === "clutter" && clutterSummary && (
        <div
          role="status"
          data-testid="clutter-preview-summary"
          style={{
            position: "absolute",
            bottom: 40,
            left: 24,
            right: 24,
            zIndex: 3,
            pointerEvents: "none",
            padding: "10px 14px",
            border: "1px solid #435369",
            borderRadius: 6,
            color: "#c7d0dc",
            background: "#111924e6",
            fontSize: 12,
          }}
        >
          {clutterSummary}
        </div>
      )}
      {error && <div className="webgl-error">{error}</div>}
    </div>
  );
}
function centerOnBody(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  body: Celestial,
  bodies: Celestial[],
  days: number,
  layout: PhysicalSystemLayout | null,
) {
  const position = bodyPosition(body, bodies, days, !layout);
  const target = new THREE.Vector3().fromArray(
    layout ? physicalScenePosition(position, layout) : position,
  );
  // Translate both ends of the viewing direction so playback/scrubbing preserves zoom and angle.
  camera.position.add(target.clone().sub(controls.target));
  controls.target.copy(target);
}
function dispose(obj: THREE.Object3D) {
  if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
    obj.geometry?.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of materials) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      disposePreviewMaterial(m);
      m.dispose();
    }
  }
  if (obj instanceof THREE.Sprite) {
    obj.material.map?.dispose();
    obj.material.dispose();
  }
}
function glowTexture(color: string) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!,
    g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  g.addColorStop(0, color + "cc");
  g.addColorStop(0.4, color + "30");
  g.addColorStop(1, color + "00");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function fitCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  mode: string,
  body: Celestial,
  layout?: PhysicalSystemLayout | null,
  clutterViewExtent?: number | null,
  clutterViewBounds?: THREE.Box3 | null,
) {
  const extent =
    mode === "system"
      ? (layout?.extent ?? 29)
      : mode === "clutter" && isPlanet(body)
        ? (clutterViewExtent ?? clutterExtent(body))
        : isPlanet(body)
          ? 2 *
            Math.max(
              1.05,
              body.rings.enabled ? body.rings.outerRadius : 0,
              body.kind === "rocky" && body.ocean.enabled
                ? 1 + body.ocean.levelKm / body.radiusKm
                : 0,
              body.kind === "rocky"
                ? 1 + ((1 - body.surface.seaLevel) * body.surface.elevation) / body.radiusKm
                : 0,
            )
          : 2.1;
  camera.near = layout
    ? Math.max(1e-12, Math.min(0.02, layout.minBodyRadius * 0.01))
    : mode === "clutter"
      ? Math.max(0.0001, Math.min(0.02, extent * 0.001))
      : 0.02;
  camera.far = layout
    ? Math.max(1000, layout.extent * 12)
    : mode === "clutter"
      ? Math.max(2000, extent * 12)
      : 2000;
  camera.updateProjectionMatrix();
  controls.minDistance = layout
    ? Math.max(1e-12, layout.minBodyRadius * 0.25)
    : mode === "clutter"
      ? Math.max(0.001, extent * 0.05)
      : 1.5;
  controls.maxDistance = layout
    ? Math.max(200, layout.extent * 25)
    : mode === "clutter"
      ? Math.max(200, extent * 25)
      : 200;
  const v = (camera.fov * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
  let distance = (extent / Math.sin(Math.min(v, h) / 2)) * 1.13;
  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() === 0) direction.set(0, 0.6, 1);
  direction.normalize();
  if (mode === "clutter" && clutterViewBounds && !clutterViewBounds.isEmpty()) {
    // Frame actual projected corners. A diagonal enclosing sphere leaves large
    // empty margins around flat libraries and metre-sized terrain patches.
    camera.lookAt(controls.target);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    distance = 0;
    for (const x of [clutterViewBounds.min.x, clutterViewBounds.max.x])
      for (const y of [clutterViewBounds.min.y, clutterViewBounds.max.y])
        for (const z of [clutterViewBounds.min.z, clutterViewBounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(controls.target);
          distance = Math.max(
            distance,
            corner.dot(direction) +
              Math.max(
                Math.abs(corner.dot(right)) / Math.tan(h / 2),
                Math.abs(corner.dot(up)) / Math.tan(v / 2),
              ),
          );
        }
    distance = Math.max(0.05, distance * 1.3);
  }
  camera.position.copy(direction.normalize().multiplyScalar(distance).add(controls.target));
  controls.update();
}
