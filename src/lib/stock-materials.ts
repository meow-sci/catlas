import type { StockAsset } from "./stock-assets";
import type { ClutterType } from "./types";

export const STOCK_ATLAS_COLUMNS = 4;
export const STOCK_ATLAS_ROWS = 2;
export const STOCK_ATLAS_INSET = 0.02;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const byte = (value: number) => Math.round(clamp(value) * 255);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const tau = Math.PI * 2;
const color = (hex: string) => {
  const value =
    hex.length === 4
      ? hex
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.slice(1);
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
};
const hash = (x: number, y: number, seed: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const noise = (x: number, y: number, seed: number) => {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    u = smooth(x - ix),
    v = smooth(y - iy);
  return mix(
    mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), u),
    mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), u),
    v,
  );
};
const ridge = (phase: number, sharpness: number) =>
  Math.exp(-Math.abs(Math.sin(phase)) * sharpness);
type Grain = {
  height: number;
  light: number;
  roughness: number;
  occlusion: number;
  warmth: number;
};

export function usesStockFoliageCutout(asset: Pick<StockAsset, "id" | "cutout">) {
  return asset.cutout || asset.id === "wind_pine" || asset.id === "umbrella_tree";
}

type SprigSegment = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  width: number;
  stem: boolean;
};

function foliageStyle(asset: StockAsset) {
  return asset.foliageStyle ?? (asset.id === "wind_pine" ? "needles" : "compound");
}

/** Serrated oval leaf, with an opaque petiole, for the birch canopy. */
function sampleBroadleaf(u: number, v: number, feather: number) {
  const t = clamp((v - 0.09) / 0.87),
    width = Math.sin(Math.PI * t) ** 0.85 * (0.4 - t * 0.08),
    edge = width + Math.sin(t * Math.PI * 34) * 0.009,
    leaf = v >= 0.09 && v <= 0.96 ? smooth(clamp((edge - Math.abs(u - 0.5)) / feather + 0.5)) : 0,
    stem = v < 0.23 ? smooth(clamp((0.013 - Math.abs(u - 0.5)) / feather + 0.5)) : 0;
  return { coverage: Math.max(leaf, stem), stemCoverage: stem * (1 - leaf) };
}

/** Original botanical silhouettes: many needles/leaflets per curved foliage card. */
function sprigSegments(id: string, slot: number, seed: number): SprigSegment[] {
  const segments: SprigSegment[] = [];
  const bend = (v: number) => 0.5 + Math.sin(v * 3 + slot * 0.7) * 0.035 * v;
  for (let i = 0; i < 16; i++) {
    const a = 0.035 + i * 0.06,
      b = a + 0.06;
    segments.push({
      ax: bend(a),
      ay: a,
      bx: bend(b),
      by: b,
      width: 0.012 * (1 - a * 0.7),
      stem: true,
    });
  }
  const pine = id === "wind_pine",
    count = pine ? 36 : 10;
  for (let i = 0; i < count; i++)
    for (const sign of [-1, 1]) {
      const t = (i + 1) / (count + 1),
        v = 0.075 + t * 0.78 + sign * 0.007,
        random = hash(i, slot * 2 + sign, seed),
        span = (pine ? 0.43 : 0.34) * Math.sin(Math.PI * (t * 0.84 + 0.09)) * (0.8 + random * 0.2),
        ax = bend(v),
        ay = v,
        bx = ax + sign * span,
        by = Math.min(0.985, v + (pine ? 0.13 : 0.1) + random * 0.055);
      if (pine) {
        const mx = ax + sign * span * 0.58,
          my = v + (by - v) * 0.42;
        segments.push({ ax, ay, bx: mx, by: my, width: 0.02, stem: false });
        segments.push({ ax: mx, ay: my, bx, by, width: 0.017, stem: false });
      } else {
        segments.push({ ax, ay, bx, by, width: 0.035 + random * 0.008, stem: false });
      }
    }
  return segments;
}

function sampleSprig(
  segments: SprigSegment[],
  u: number,
  v: number,
  feather: number,
  pine: boolean,
) {
  let coverage = 0,
    stemCoverage = 0;
  for (const s of segments) {
    // Bounding reject keeps a 512px atlas inexpensive even with many fine needles.
    if (
      u < Math.min(s.ax, s.bx) - s.width - feather ||
      u > Math.max(s.ax, s.bx) + s.width + feather ||
      v < Math.min(s.ay, s.by) - s.width - feather ||
      v > Math.max(s.ay, s.by) + s.width + feather
    )
      continue;
    const dx = s.bx - s.ax,
      dy = s.by - s.ay,
      t = clamp(((u - s.ax) * dx + (v - s.ay) * dy) / (dx * dx + dy * dy)),
      distance = Math.hypot(u - s.ax - t * dx, v - s.ay - t * dy),
      width = s.stem
        ? s.width
        : pine
          ? s.width * (1 - t * 0.75)
          : s.width * Math.sin(Math.PI * t) ** 0.65,
      alpha = smooth(clamp((width - distance) / feather + 0.5));
    coverage = Math.max(coverage, alpha);
    if (s.stem) stemCoverage = Math.max(stemCoverage, alpha);
  }
  return { coverage, stemCoverage };
}

/** Surface coordinates are continuous over branches/leaves/rock faces, not reset per triangle. */
function grain(id: string, slot: number, u: number, v: number, seed: number): Grain {
  const s = seed + slot * 313,
    broad = noise(u * 5, v * 6, s),
    medium = noise(u * 23, v * 29, s + 71),
    fine = noise(u * 91, v * 127, s + 129),
    grit = noise(u * 193, v * 239, s + 239),
    phase = hash(slot, 17, seed) * tau;
  if (id === "grass" || id === "alien_grass") {
    const fibres = Math.sin((u * 37 + broad * 0.18) * Math.PI),
      midrib = Math.exp(-Math.abs(u - 0.5) * 60),
      dryTip = smooth(clamp((v - 0.58) / 0.42));
    return {
      height: 0.48 + fibres * 0.024 + midrib * 0.05 + medium * 0.02,
      light: 0.72 + v * 0.19 + broad * 0.14 + midrib * 0.07 + fine * 0.05,
      roughness: 0.73 + fine * 0.19,
      occlusion: 0.83 + v * 0.17,
      warmth: dryTip * (id === "grass" ? 0.032 : -0.013),
    };
  }
  if (id === "birch_bark" && slot === 0) {
    const seams = ridge((v * 39 + broad * 0.17) * Math.PI, 23) * smooth(clamp((medium - 0.34) * 4)),
      peeling = ridge((v * 7 + u * 0.4 + broad * 0.1) * Math.PI, 34);
    return {
      height: 0.48 + medium * 0.05 - seams * 0.12 + peeling * 0.07,
      light: 0.88 + broad * 0.15 - seams * 0.66 - peeling * 0.13,
      roughness: 0.78 + fine * 0.2,
      occlusion: 1 - seams * 0.1,
      warmth: 0.008,
    };
  }
  if (id === "shell") {
    const bands = Math.sin((v * 19 + u * 0.7 + broad * 0.15) * tau),
      seams = ridge((v * 19 + u * 0.7 + broad * 0.15) * Math.PI, 25),
      speckles = Math.max(0, medium - 0.6) * 2.5;
    return {
      height: 0.48 + bands * 0.04 - seams * 0.07 + fine * 0.035,
      light: 0.8 + broad * 0.22 + bands * 0.08 - speckles * 0.23,
      roughness: 0.52 + fine * 0.26,
      occlusion: 1 - seams * 0.05,
      warmth: bands * 0.018,
    };
  }
  if (id === "fungus") {
    const fibres = ridge((u * 31 + broad * 0.6 + Math.sin(v * 8) * 0.08) * Math.PI, 12),
      freckles = Math.max(0, medium - 0.64) * 2;
    return {
      height: 0.48 + medium * 0.05 - fibres * (slot === 0 ? 0.09 : 0.025),
      light: 0.8 + broad * 0.25 + v * 0.05 - fibres * 0.1 - freckles * 0.2,
      roughness: 0.7 + fine * 0.22,
      occlusion: 1 - fibres * 0.055,
      warmth: (1 - v) * 0.018,
    };
  }
  if (id === "succulent") {
    const ridges = Math.cos((u - 0.5) * Math.PI * 6),
      bloom = noise(u * 45, v * 63, s + 175);
    return {
      height: 0.49 + ridges * 0.035 + medium * 0.018,
      light: 0.83 + broad * 0.14 + bloom * 0.07 + v * 0.05,
      roughness: 0.55 + bloom * 0.29,
      occlusion: 0.97 + ridges * 0.02,
      warmth: v * 0.024,
    };
  }
  if (id === "layered_sandstone") {
    const strata = Math.sin((v * 25 + broad * 0.65 + u * 0.5) * tau),
      seams = ridge((v * 12 + broad * 0.3 + u * 0.3) * tau, 19),
      pores = Math.max(0, 0.3 - fine) * 1.7;
    return {
      height: 0.45 + strata * 0.09 + medium * 0.17 + grit * 0.08 - seams * 0.17 - pores,
      light: 0.72 + broad * 0.33 + strata * 0.1 + grit * 0.16 - seams * 0.15 - pores * 0.5,
      roughness: 0.95 + fine * 0.12,
      occlusion: 1 - seams * 0.12 - pores * 0.4,
      warmth: strata * 0.018,
    };
  }
  if (id === "basalt_spires") {
    const fractures = ridge((u * 7 + noise(u * 4, v * 13, s + 23) * 0.55) * tau + phase, 20),
      mineral = Math.pow(Math.max(0, medium - 0.56) * 2.2, 2),
      pits = Math.max(0, 0.32 - fine) * 1.6;
    return {
      height: 0.36 + medium * 0.28 + grit * 0.08 - fractures * 0.21 - pits,
      light: 0.65 + broad * 0.34 + fine * 0.2 + mineral * 0.35 - fractures * 0.23 - pits * 0.6,
      roughness: 0.89 + fine * 0.17,
      occlusion: 1 - fractures * 0.2 - pits * 0.3,
      warmth: mineral * 0.03,
    };
  }
  if (id === "glacial_shard") {
    const cracks = ridge((u * 5 + v * 2.5 + noise(u * 8, v * 8, s + 5) * 0.7) * Math.PI, 38),
      bubbles = Math.max(0, fine - 0.7) * 1.2,
      cloud = noise(u * 12 + broad, v * 18, s + 171);
    return {
      height: 0.5 + medium * 0.04 - cracks * 0.16 + bubbles * 0.04,
      light: 0.8 + cloud * 0.23 + cracks * 0.23 + bubbles * 0.3,
      roughness: 0.35 + cloud * 0.26 + cracks * 0.12,
      occlusion: 1 - cracks * 0.06,
      warmth: -cloud * 0.015,
    };
  }
  if (id === "coral_fan") {
    const pores = ridge((u * 19 + medium * 0.4) * tau, 8) * ridge((v * 41 + broad * 0.5) * tau, 8),
      ribs = Math.sin((u * 9 + broad * 0.3) * tau);
    return {
      height: 0.45 + ribs * 0.06 + medium * 0.1 - pores * 0.2,
      light: 0.77 + broad * 0.26 + fine * 0.1 - pores * 0.28,
      roughness: 0.82 + fine * 0.19,
      occlusion: 1 - pores * 0.3,
      warmth: broad * 0.012,
    };
  }
  if (slot === 0) {
    const bend = noise(u * 8, v * 7, s + 97),
      furrows = ridge((u * 16 + bend * 0.55 + Math.sin(v * 11 + phase) * 0.12) * Math.PI, 11),
      flakes = ridge((v * 25 + u * 5 + medium * 0.65) * Math.PI, 19),
      knot = Math.hypot((u - 0.38) * 2.2, (v - 0.62) * 1.3),
      ring = Math.exp(-knot * 12) * Math.sin(knot * 180);
    return {
      height: 0.48 + medium * 0.18 + fine * 0.08 - furrows * 0.28 - flakes * 0.08 + ring * 0.07,
      light: 0.75 + broad * 0.3 + fine * 0.14 - furrows * 0.34 - flakes * 0.07 + ring * 0.05,
      roughness: 0.95 + fine * 0.12,
      occlusion: 1 - furrows * 0.25 - flakes * 0.06,
      warmth: medium * 0.014,
    };
  }
  if (id === "alien_lantern" && [2, 3, 4, 7].includes(slot)) {
    const ribs = Math.cos(u * tau * 10),
      capillaries = ridge((v * 17 + u * 7 + broad * 0.5) * tau, 20);
    return {
      height: 0.45 + ribs * 0.13 + medium * 0.05 - capillaries * 0.025,
      light: 0.78 + broad * 0.2 + Math.sin(v * Math.PI) * 0.08 + ribs * 0.06,
      roughness: 0.57 + fine * 0.16,
      occlusion: 0.97 + ribs * 0.02,
      warmth: (1 - v) * 0.035,
    };
  }
  // Midrib and diagonal secondary veins follow each leaf's base-to-tip V coordinate.
  const midrib = Math.exp(-Math.abs(u - 0.5) * 130),
    veinPhase = v * (id === "wind_pine" ? 13 : 9) - Math.abs(u - 0.5) * 4,
    veins = ridge(veinPhase * Math.PI, 18) * (1 - midrib),
    needle = id === "wind_pine" ? Math.sin(u * tau * 13) * 0.025 : 0,
    edge = Math.pow(Math.abs(u - 0.5) * 2, 5);
  return {
    height: 0.47 + midrib * 0.15 + veins * 0.055 + medium * 0.035 + needle,
    light: 0.76 + broad * 0.15 + fine * 0.1 + v * 0.1 + midrib * 0.12 + veins * 0.04 - edge * 0.06,
    roughness: 0.69 + medium * 0.17 + edge * 0.08,
    occlusion: 0.97 + medium * 0.03,
    warmth: v * 0.014 + midrib * 0.012,
  };
}

/** Eight semantic 4×2 tiles with border dilation and original multi-scale PBR relief. */
export function generateStockMaterialPixels(
  asset: StockAsset,
  size: number,
  material: ClutterType["material"],
  seed: number,
) {
  if (!Number.isInteger(size) || size < 8 || size % 4 || asset.palette.length !== 8)
    throw new Error(
      "Stock atlas textures require eight colors and a size divisible by four, at least eight pixels",
    );
  const family = asset.materialFamily ?? asset.id,
    palette = asset.palette.map(color),
    primary = color(material.color),
    accent = color(material.secondaryColor),
    diffuse = new Uint8Array(size * size * 4),
    normal = new Uint8Array(diffuse.length),
    orm = new Uint8Array(diffuse.length),
    heights = new Float32Array(size * size),
    width = size / 4,
    height = size / 2;
  // Rock relief is small compared with the forms already sculpted into the mesh.
  const relief = family === "layered_sandstone" ? 0.008 : asset.category === "rock" ? 0.012 : 0.035;
  const cutout = usesStockFoliageCutout(asset),
    foliage = foliageStyle(asset),
    opacity = cutout ? new Uint8Array(diffuse.length) : undefined,
    thickness = asset.category === "groundcover" ? new Uint8Array(diffuse.length) : undefined,
    sprigs = cutout
      ? Array.from({ length: 8 }, (_, slot) =>
          sprigSegments(foliage === "needles" ? "wind_pine" : "umbrella_tree", slot, seed),
        )
      : [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const column = Math.floor(x / width),
        row = Math.floor(y / height),
        slot = row * 4 + column,
        u = clamp((((x % width) + 0.5) / width - STOCK_ATLAS_INSET) / (1 - STOCK_ATLAS_INSET * 2)),
        v = clamp(
          (((y % height) + 0.5) / height - STOCK_ATLAS_INSET) / (1 - STOCK_ATLAS_INSET * 2),
        ),
        g = grain(family, slot, u, v, seed),
        at = (y * size + x) * 4,
        tint = slot >= 5 ? accent : primary;
      const silhouette =
        cutout && slot >= 1 && slot <= 4
          ? foliage === "broadleaf"
            ? sampleBroadleaf(u, v, 1 / width)
            : sampleSprig(sprigs[slot], u, v, 1 / width, foliage === "needles")
          : { coverage: 1, stemCoverage: 0 };
      if (opacity) {
        const alpha = byte(silhouette.coverage);
        opacity.set([alpha, alpha, alpha, 255], at);
      }
      if (thickness) {
        const value = byte(0.32 + Math.exp(-Math.abs(u - 0.5) * 22) * 0.25 + (1 - v) * 0.2);
        thickness.set([value, value, value, 255], at);
      }
      heights[y * size + x] = g.height;
      for (let channel = 0; channel < 3; channel++) {
        const warmth = channel === 0 ? g.warmth : channel === 2 ? -g.warmth : 0;
        const base = mix(
          palette[slot][channel],
          palette[0][channel],
          silhouette.stemCoverage * 0.8,
        );
        diffuse[at + channel] = byte((base * g.light + warmth) * tint[channel]);
      }
      diffuse[at + 3] = 255;
      orm.set(
        [byte(g.occlusion), byte(material.roughness * g.roughness), byte(material.metalness), 255],
        at,
      );
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x / width) * width,
        y0 = Math.floor(y / height) * height,
        left = Math.max(x0, x - 1),
        right = Math.min(x0 + width - 1, x + 1),
        down = Math.max(y0, y - 1),
        up = Math.min(y0 + height - 1, y + 1),
        dx =
          (heights[y * size + right] - heights[y * size + left]) *
          width *
          relief *
          material.normalStrength,
        dy =
          (heights[up * size + x] - heights[down * size + x]) *
          height *
          relief *
          material.normalStrength,
        length = Math.hypot(dx, dy, 1),
        at = (y * size + x) * 4;
      normal.set(
        [
          byte(0.5 - (dx / length) * 0.5),
          byte(0.5 - (dy / length) * 0.5),
          byte(0.5 + 0.5 / length),
          255,
        ],
        at,
      );
    }
  return { diffuse, normal, orm, opacity, thickness };
}
