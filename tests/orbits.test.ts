import { describe, expect, it } from "vitest";
import {
  bodyOrbitScale,
  bodyPosition,
  eccentricAnomaly,
  LIGHT_YEAR_AU,
  orbitPoint,
  physicalBodyRadiusAu,
  physicalScenePosition,
  physicalSystemLayout,
} from "../src/lib/orbits";
import { makePlanet, makeStar, orbit } from "../src/lib/project";
import { AU_KM, type Barycenter, type Celestial, type Vec3 } from "../src/lib/types";

const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((value, i) => value - b[i]));

describe("system preview scale", () => {
  it("preserves real orbital distances, body sizes and moon ratios under one scene scale", () => {
    const star = makeStar("Sun", "Sun");
    const earth = makePlanet("Earth", "Earth", star.id);
    const moon = makePlanet("Moon", "Moon", earth.id, "rocky", 0.00257);
    earth.orbit.eccentricity = moon.orbit.eccentricity = 0;
    moon.radiusKm = 1737.4;
    const bodies = [star, earth, moon];
    const layout = physicalSystemLayout(bodies);
    const positions = bodies.map((body) =>
      physicalScenePosition(bodyPosition(body, bodies, 0, false), layout),
    );
    const earthRadius = physicalBodyRadiusAu(earth) * layout.scale;
    expect(distance(positions[0], positions[1]) / earthRadius).toBeCloseTo(
      AU_KM / earth.radiusKm,
      9,
    );
    expect(distance(positions[1], positions[2]) / earthRadius).toBeCloseTo(
      (0.00257 * AU_KM) / earth.radiusKm,
      9,
    );
    expect(physicalBodyRadiusAu(star) / physicalBodyRadiusAu(earth)).toBeCloseTo(
      star.radiusKm / earth.radiusKm,
      12,
    );
    expect(physicalBodyRadiusAu(moon) / physicalBodyRadiusAu(earth)).toBeCloseTo(
      moon.radiusKm / earth.radiusKm,
      12,
    );
  });

  it("keeps the default compressed planet, moon and root-star spacing", () => {
    const star = makeStar("Sun", "Sun");
    const earth = makePlanet("Earth", "Earth", star.id);
    const moon = makePlanet("Moon", "Moon", earth.id, "rocky", 0.00257);
    const bodies = [star, earth, moon];
    const planetDistance = (4 + Math.log10(11) * 8) * 0.98;
    const moonDistance = (1.4 + Math.log10(1 + 0.00257 * 10000)) * 0.98;
    expect(bodyPosition(earth, bodies, 0)).toEqual([planetDistance, 0, 0]);
    expect(distance(bodyPosition(earth, bodies, 0), bodyPosition(moon, bodies, 0))).toBeCloseTo(
      moonDistance,
      12,
    );
    star.position = [2, 0, 0];
    expect(bodyPosition(star, bodies, 0)[0]).toBeCloseTo(10 * Math.log1p(2 * 63241), 12);
  });

  it("uses light-years and AU coherently for separate local root stars", () => {
    const first = makeStar("A", "A", [0.01, -0.02, 0.03]);
    const second = makeStar("B", "B", [0.11, -0.02, 0.03]);
    const earth = makePlanet("Earth", "Earth", first.id);
    earth.orbit.eccentricity = 0;
    const bodies = [first, second, earth];
    const layout = physicalSystemLayout(bodies);
    const scene = (body: Celestial) =>
      physicalScenePosition(bodyPosition(body, bodies, 0, false), layout);
    expect(
      distance(scene(first), scene(second)) / distance(scene(first), scene(earth)),
    ).toBeCloseTo(0.1 * LIGHT_YEAR_AU, 7);
    expect(layout.minBodyRadius).toBeGreaterThan(0);
    expect(layout.minBodyRadius).toBeLessThan(0.00001);
  });

  it("keeps binary body positions on the same correctly sized orbit lines", () => {
    const center: Barycenter = {
      id: "Center",
      name: "Center",
      kind: "barycenter",
      parentId: null,
      position: [0, 0, 0],
      orbit: orbit(),
    };
    const first = makeStar("A", "A");
    const second = makeStar("B", "B");
    first.massSuns = 2;
    for (const star of [first, second]) {
      star.parentId = center.id;
      star.orbit = { ...orbit(2, 0), barycentric: true };
    }
    second.orbit.argumentOfPeriapsis = 180;
    const bodies = [center, first, second];
    const a = bodyPosition(first, bodies, 0, false);
    const b = bodyPosition(second, bodies, 0, false);
    expect(a).toEqual(orbitPoint(first.orbit, 0, bodyOrbitScale(first, bodies, false)));
    expect(b).toEqual(orbitPoint(second.orbit, 0, bodyOrbitScale(second, bodies, false)));
    expect(distance(a, b)).toBeCloseTo(2, 12);
    expect(a[0] * first.massSuns + b[0] * second.massSuns).toBeCloseTo(0, 12);
  });

  it("changes scale without changing orbital phase when central mass is overridden", () => {
    const star = makeStar("A", "A");
    const planet = makePlanet("Planet", "Planet", star.id);
    planet.orbit.eccentricity = 0;
    planet.orbit.centralMassSuns = 4;
    const bodies = [star, planet];
    const days = 365.256 / Math.sqrt(4) / 4;
    const real = bodyPosition(planet, bodies, days, false);
    const schematic = bodyPosition(planet, bodies, days);
    expect(real[0]).toBeCloseTo(0, 12);
    expect(real[2]).toBeCloseTo(1, 12);
    const realLength = Math.hypot(...real),
      schematicLength = Math.hypot(...schematic);
    for (let i = 0; i < 3; i++)
      expect(real[i] / realLength).toBeCloseTo(schematic[i] / schematicLength, 12);
  });

  it("fits complete eccentric nested orbits and rings even with distant local roots", () => {
    const first = makeStar("A", "A", [-12, 4, 2]);
    const second = makeStar("B", "B", [15, -3, 1]);
    const planet = makePlanet("Planet", "Planet", first.id, "gas", 30);
    const moon = makePlanet("Moon", "Moon", planet.id, "rocky", 0.02);
    planet.orbit.eccentricity = 0.9;
    planet.rings.enabled = true;
    planet.rings.outerRadius = 4;
    moon.orbit.eccentricity = 0.7;
    const bodies = [first, second, planet, moon];
    const layout = physicalSystemLayout(bodies);
    for (const days of [-1e9, -1000, 0, 1000, 1e9]) {
      for (const body of bodies) {
        const position = physicalScenePosition(bodyPosition(body, bodies, days, false), layout);
        expect(position.every(Number.isFinite)).toBe(true);
        expect(
          Math.hypot(...position) + physicalBodyRadiusAu(body) * layout.scale,
        ).toBeLessThanOrEqual(layout.extent + 1e-9);
      }
    }
  });

  it("keeps zero-radius orbits and nearly parabolic elapsed positions finite", () => {
    const star = makeStar("A", "A");
    const planet = makePlanet("Planet", "Planet", star.id, "rocky", 0);
    expect(bodyPosition(planet, [star, planet], 100, false)).toEqual([0, 0, 0]);
    const mean = 0.000001;
    const E = eccentricAnomaly(mean, 0.999999);
    expect(E - 0.999999 * Math.sin(E)).toBeCloseTo(mean, 12);
    planet.orbit = orbit(1, 0.999999);
    expect(bodyPosition(planet, [star, planet], 1e12, false).every(Number.isFinite)).toBe(true);
  });
});
