import type { Celestial, OrbitSettings, Vec3 } from "./types";
import { AU_KM, isPlanet, SOLAR_EARTH_MASS } from "./types";

/** IAU light-year, in the same AU units as authored orbital distances. */
export const LIGHT_YEAR_AU = 9.4607304725808e12 / AU_KM;
export function massSuns(body: Celestial) {
  return body.kind === "star"
    ? body.massSuns
    : isPlanet(body)
      ? body.massEarths / SOLAR_EARTH_MASS
      : 0;
}
export function orbitPoint(o: OrbitSettings, anomaly: number, scale = 1): Vec3 {
  const e = Math.max(0, Math.min(1 - Number.EPSILON, o.eccentricity)),
    a = Math.max(0, o.semiMajorAxisAu) * scale;
  let x = a * (Math.cos(anomaly) - e),
    z = a * Math.sqrt(1 - e * e) * Math.sin(anomaly);
  const rad = Math.PI / 180,
    arg = o.argumentOfPeriapsis * rad,
    inc = o.inclination * rad,
    node = o.ascendingNode * rad;
  const xx = x * Math.cos(arg) - z * Math.sin(arg),
    zz = x * Math.sin(arg) + z * Math.cos(arg);
  x = xx * Math.cos(node) - zz * Math.cos(inc) * Math.sin(node);
  z = xx * Math.sin(node) + zz * Math.cos(inc) * Math.cos(node);
  return [x, zz * Math.sin(inc), z];
}
export function eccentricAnomaly(mean: number, e: number) {
  // Reduce elapsed revolutions before solving: large dates and almost parabolic
  // ellipses otherwise make Newton iteration diverge or lose precision.
  mean = (((mean % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  e = Math.max(0, Math.min(1 - Number.EPSILON, e));
  let low = -Math.PI,
    high = Math.PI,
    E = e < 0.8 ? mean : Math.sign(mean) * Math.PI;
  for (let i = 0; i < 48; i++) {
    const residual = E - e * Math.sin(E) - mean;
    if (Math.abs(residual) < 1e-13) break;
    if (residual > 0) high = E;
    else low = E;
    const next = E - residual / (1 - e * Math.cos(E));
    E = next > low && next < high ? next : (low + high) / 2;
  }
  return E;
}

function parentMassSuns(parent: Celestial, bodies: Celestial[]): number {
  return parent.kind === "barycenter"
    ? bodies
        .filter((b) => b.parentId === parent.id && b.kind === "star" && b.orbit.barycentric)
        .reduce((sum, b) => sum + massSuns(b), 0)
    : massSuns(parent);
}

/** Shared by the moving body and its orbit line, including binary barycentric radii. */
export function bodyOrbitScale(body: Celestial, bodies: Celestial[], schematic = true): number {
  const parent = bodies.find((b) => b.id === body.parentId);
  const a = body.orbit.semiMajorAxisAu;
  if (!(a > 0) || !parent) return 0;
  const parentMass = parentMassSuns(parent, bodies);
  const baryScale = body.orbit.barycentric
    ? (parentMass - massSuns(body)) / Math.max(parentMass, 1e-10)
    : 1;
  const visualA = schematic
    ? isPlanet(parent)
      ? 1.4 + Math.log10(1 + a * 10000)
      : 4 + Math.log10(1 + a * 10) * 8
    : a;
  return (visualA / a) * baryScale;
}
export function bodyPosition(
  body: Celestial,
  bodies: Celestial[],
  days: number,
  schematic = true,
  seen = new Set<string>(),
): Vec3 {
  if (seen.has(body.id)) return [0, 0, 0];
  if (!body.parentId) {
    if (body.kind !== "star" && body.kind !== "barycenter") return [0, 0, 0];
    const r = Math.hypot(...body.position);
    const scale = schematic && r > 0 ? (10 * Math.log1p(r * 63241)) / r : LIGHT_YEAR_AU;
    return body.position.map((v) => v * scale) as Vec3;
  }
  seen.add(body.id);
  const parent = bodies.find((b) => b.id === body.parentId);
  if (!parent) return [0, 0, 0];
  if (!(body.orbit.semiMajorAxisAu > 0)) return bodyPosition(parent, bodies, days, schematic, seen);
  const parentMass =
      body.orbit.centralMassSuns > 0 ? body.orbit.centralMassSuns : parentMassSuns(parent, bodies),
    own = massSuns(body);
  const period =
    365.256 *
    Math.sqrt(
      body.orbit.semiMajorAxisAu ** 3 / Math.max(parentMass + (body.orbit.twoBody ? own : 0), 1e-8),
    );
  const E = eccentricAnomaly(
    ((days - body.orbit.timeAtPeriapsisDays) / period) * Math.PI * 2,
    body.orbit.eccentricity,
  );
  const offset = orbitPoint(body.orbit, E, bodyOrbitScale(body, bodies, schematic));
  const origin = bodyPosition(parent, bodies, days, schematic, seen);
  return offset.map((v, i) => v + origin[i]) as Vec3;
}

export function physicalBodyRadiusAu(body: Celestial): number {
  return body.kind === "barycenter" ? 0 : Math.max(0, body.radiusKm) / AU_KM;
}

export type PhysicalSystemLayout = {
  origin: Vec3;
  /** One common AU-to-scene conversion for all distances and sizes. */
  scale: number;
  extent: number;
  minBodyRadius: number;
};

/** Conservative bounds include entire parent/child orbits at every simulation date. */
export function physicalSystemLayout(bodies: Celestial[]): PhysicalSystemLayout {
  const lower: Vec3 = [Infinity, Infinity, Infinity],
    upper: Vec3 = [-Infinity, -Infinity, -Infinity];
  let minRadius = Infinity;
  for (const body of bodies) {
    let root = body,
      reach = 0;
    const seen = new Set<string>();
    while (root.parentId && !seen.has(root.id)) {
      seen.add(root.id);
      reach +=
        Math.max(0, root.orbit.semiMajorAxisAu) *
        (1 + Math.max(0, Math.min(1, root.orbit.eccentricity))) *
        Math.abs(bodyOrbitScale(root, bodies, false));
      const parent = bodies.find((candidate) => candidate.id === root.parentId);
      if (!parent) break;
      root = parent;
    }
    const position = bodyPosition(root, bodies, 0, false);
    const meanRadius = physicalBodyRadiusAu(body);
    if (meanRadius > 0) minRadius = Math.min(minRadius, meanRadius);
    let bodyExtent = meanRadius;
    if (isPlanet(body) && body.radiusKm > 0) {
      const terrain =
        body.kind === "rocky" ? (1 - body.surface.seaLevel) * body.surface.elevation : 0;
      bodyExtent = Math.max(
        meanRadius,
        (body.radiusKm + terrain) / AU_KM,
        body.kind === "rocky" && body.ocean.enabled
          ? (body.radiusKm + body.ocean.levelKm) / AU_KM
          : 0,
        body.atmosphere.enabled ? (body.radiusKm + body.atmosphere.heightKm) / AU_KM : 0,
        body.rings.enabled ? meanRadius * body.rings.outerRadius : 0,
      );
    }
    reach += bodyExtent;
    for (let i = 0; i < 3; i++) {
      lower[i] = Math.min(lower[i], position[i] - reach);
      upper[i] = Math.max(upper[i], position[i] + reach);
    }
  }
  const origin = lower.map((value, i) => value / 2 + upper[i] / 2) as Vec3;
  const radius = Math.hypot(...upper.map((value, i) => (value - lower[i]) / 2));
  if (!(radius > 0) || !Number.isFinite(radius))
    return { origin: [0, 0, 0], scale: 1, extent: 1, minBodyRadius: 0.001 };
  const scale = 40 / radius;
  return {
    origin,
    scale,
    extent: 40,
    minBodyRadius: Number.isFinite(minRadius) ? minRadius * scale : 0.001,
  };
}

export function physicalScenePosition(positionAu: Vec3, layout: PhysicalSystemLayout): Vec3 {
  return positionAu.map((value, i) => (value - layout.origin[i]) * layout.scale) as Vec3;
}
