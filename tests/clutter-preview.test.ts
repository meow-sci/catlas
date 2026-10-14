import { describe, expect, it } from "vitest";
import { defaultClutterPatchLocation, sampleClutterPatch } from "../src/lib/clutterPreview";
import { defaultLandmark } from "../src/lib/landmarks";
import { makePlanet } from "../src/lib/project";
import { defaultBiome, defaultClutter } from "../src/lib/surface";

function study() {
  const body = makePlanet("Study", "Study", "Sun"),
    type = defaultClutter("StudyType");
  body.surface.elevation = 0;
  body.surface.colors = [
    { at: 0, color: "#808080" },
    { at: 1, color: "#808080" },
  ];
  body.surface.occurrences = [];
  body.surface.biomes = [defaultBiome("Base", 1, "#808080")];
  body.landmarks = [];
  type.distribution.density = 1;
  type.distribution.objectSeparationM = 10;
  type.distribution.generationRangeM = 1000;
  type.distribution.slopeMaskStrength = 0;
  type.distribution.textureTiling = 16;
  type.distribution.altitudeDensity = [
    { altitudeM: -100, density: 1 },
    { altitudeM: 100, density: 1 },
  ];
  return { body, type };
}
const options = { sizeM: 200, latitude: 0, longitude: 0 };

describe("physical clutter placement study", () => {
  it("starts close grass studies beside a launch site rather than inside its clearance", () => {
    const { body, type } = study();
    const site = defaultLandmark("Launch");
    site.launchPad = true;
    site.category = "landmark";
    site.latitude = 0;
    site.longitude = 0;
    body.landmarks = [site];
    type.distribution.objectSeparationM = 0.25;
    const center = defaultClutterPatchLocation(body);
    expect(
      sampleClutterPatch(body, type, { sizeM: 20, latitude: 0, longitude: 0 }).instances,
    ).toHaveLength(0);
    expect(
      sampleClutterPatch(body, type, { sizeM: 20, ...center, maxInstances: 4096 }).instances.length,
    ).toBeGreaterThan(256);
    site.latitude = 90;
    site.longitude = 179.999;
    const polar = defaultClutterPatchLocation(body);
    expect(Number.isFinite(polar.latitude) && Number.isFinite(polar.longitude)).toBe(true);
    expect(Math.abs(polar.longitude)).toBeLessThanOrEqual(180);
    expect(polar.latitude).toBeLessThan(90);
  });

  it("returns deterministic metre geometry, correctly wound terrain and linear vertex colors", () => {
    const { body, type } = study(),
      one = sampleClutterPatch(body, type, options),
      two = sampleClutterPatch(body, type, options);
    expect(one).toEqual(two);
    expect(one.ground.positions.length).toBe(33 * 33 * 3);
    expect(one.ground.indices.length).toBe(32 * 32 * 6);
    expect(one.ground.colors.length).toBe(one.ground.positions.length);
    const xs = Array.from(one.ground.positions).filter((_, index) => index % 3 === 0),
      zs = Array.from(one.ground.positions).filter((_, index) => index % 3 === 2);
    expect(Math.min(...xs)).toBe(-100);
    expect(Math.max(...xs)).toBe(100);
    expect(Math.min(...zs)).toBe(-100);
    expect(Math.max(...zs)).toBe(100);
    expect(one.ground.positions[(16 * 33 + 16) * 3 + 1]).toBe(0);
    expect(one.ground.colors[0]).toBeCloseTo(((128 / 255 + 0.055) / 1.055) ** 2.4, 6);
    expect(one.altitudeRangeM).toEqual([0, 0]);
    expect(one.instances.length).toBeGreaterThan(0);
    for (const instance of one.instances) {
      expect(Math.abs(instance.position[0])).toBeLessThanOrEqual(100);
      expect(Math.abs(instance.position[2])).toBeLessThanOrEqual(100);
      expect(Math.hypot(...instance.normal)).toBeCloseTo(1, 5);
      expect(instance.position.every(Number.isFinite)).toBe(true);
    }
    const [a, b, c] = Array.from(one.ground.indices.subarray(0, 3)).map((index) =>
      Array.from(one.ground.positions.subarray(index * 3, index * 3 + 3)),
    );
    expect((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])).toBeGreaterThan(0);
  });

  it("reports uncapped density estimates separately from draw and sampling limits", () => {
    const { body, type } = study();
    type.distribution.objectSeparationM = 1;
    const wide = { ...options, sizeM: 500 },
      full = sampleClutterPatch(body, type, wide),
      limited = sampleClutterPatch(body, type, { ...wide, maxInstances: 16 });
    expect(full.candidateEstimate).toBe(250000);
    expect(full.samplesEvaluated).toBe(4096);
    expect(full.samplingCapped).toBe(true);
    expect(full.eligibleEstimate).toBeGreaterThan(10000);
    expect(full.instances).toHaveLength(256);
    expect(full.capped).toBe(true);
    expect(limited.instances).toHaveLength(16);
    expect(limited.eligibleEstimate).toBe(full.eligibleEstimate);
    expect(limited.candidateEstimate).toBe(full.candidateEstimate);
    const dense = sampleClutterPatch(body, type, { ...wide, maxInstances: 1000 });
    expect(dense.instances).toHaveLength(1000);
    expect(dense.eligibleEstimate).toBe(full.eligibleEstimate);
    expect(
      sampleClutterPatch(body, type, { ...wide, maxInstances: 10000 }).instances.length,
    ).toBeLessThanOrEqual(4096);
  });

  it("preserves subunit placement expectations when separation exceeds the entire patch", () => {
    const { body, type } = study(),
      wide = { ...options, sizeM: 500 };
    type.distribution.objectSeparationM = 1000;
    const sparse = sampleClutterPatch(body, type, wide);
    type.distribution.objectSeparationM = 1e7;
    const distant = sampleClutterPatch(body, type, wide);
    expect(sparse.candidateEstimate).toBe(0.25);
    expect(distant.candidateEstimate).toBeCloseTo(2.5e-9, 16);
    expect(sparse.eligibleEstimate).toBeGreaterThan(0);
    expect(sparse.eligibleEstimate).toBeLessThan(1);
    expect(distant.eligibleEstimate).toBeGreaterThan(0);
    expect(distant.eligibleEstimate).toBeLessThan(sparse.eligibleEstimate / 1e7);
    expect(distant.instances).toHaveLength(0);
    expect(distant.capped).toBe(false);
  });

  it("responds to density, distribution seed, separation and the native generation range", () => {
    const { body, type } = study(),
      full = sampleClutterPatch(body, type, options);
    const dilute = structuredClone(type);
    dilute.distribution.density = 0.1;
    expect(sampleClutterPatch(body, dilute, options).eligibleEstimate).toBeLessThan(
      full.eligibleEstimate * 0.2,
    );
    const apart = structuredClone(type);
    apart.distribution.objectSeparationM *= 2;
    expect(sampleClutterPatch(body, apart, options).candidateEstimate).toBe(
      full.candidateEstimate / 4,
    );
    const seeded = structuredClone(type);
    seeded.distribution.seed++;
    expect(sampleClutterPatch(body, seeded, options).instances).not.toEqual(full.instances);
    const nearby = structuredClone(type);
    nearby.distribution.generationRangeM = 30;
    const near = sampleClutterPatch(body, nearby, options);
    expect(near.eligibleEstimate).toBeLessThan(full.eligibleEstimate / 5);
    expect(
      near.instances.every(
        (instance) => Math.hypot(instance.position[0], instance.position[2]) <= 30,
      ),
    ).toBe(true);
  });

  it("uses native latitude, biome memberships and ocean exclusions", () => {
    const { body, type } = study();
    body.surface.biomes.push({
      ...defaultBiome("North", 3, "#ffffff"),
      name: "Northern forest",
      minLatitude: 60,
    });
    type.distribution.biomeIds = ["North"];
    const equator = sampleClutterPatch(body, type, options),
      north = sampleClutterPatch(body, type, { ...options, latitude: 90, longitude: 75 });
    expect(equator.eligibleEstimate).toBe(0);
    expect(equator.instances).toHaveLength(0);
    expect(north.eligibleEstimate).toBeGreaterThan(0);
    expect(north.biomeNames).toContain("Northern forest");
    body.ocean.enabled = true;
    body.ocean.levelKm = 0.1;
    const flooded = sampleClutterPatch(body, type, { ...options, latitude: 90 });
    expect(flooded.eligibleEstimate).toBe(0);
    expect(flooded.instances).toHaveLength(0);
  });

  it("honors native shared-random slope/altitude gates and 16 quantized scale vectors", () => {
    const { body, type } = study();
    type.distribution.minScale = [1, 2, 3];
    type.distribution.maxScale = [2, 4, 6];
    type.distribution.minRotationDeg = 10;
    type.distribution.maxRotationDeg = 25;
    type.distribution.orientation = "Up";
    const full = sampleClutterPatch(body, type, options);
    for (const instance of full.instances) {
      const fraction = instance.scale[0] - 1;
      expect(fraction * 15).toBeCloseTo(Math.round(fraction * 15), 8);
      expect(instance.scale[1]).toBeCloseTo(2 + fraction * 2);
      expect(instance.scale[2]).toBeCloseTo(3 + fraction * 3);
      expect(instance.rotationDeg).toBeGreaterThanOrEqual(10);
      expect(instance.rotationDeg).toBeLessThanOrEqual(25);
    }
    type.distribution.slopeMaskContrast = 0;
    type.distribution.slopeMaskBias = 0.4;
    type.distribution.altitudeDensity = [
      { altitudeM: -10, density: 0.2 },
      { altitudeM: 10, density: 0.2 },
    ];
    const incompatible = sampleClutterPatch(body, type, options);
    // Shared random must be >=0.6 for slope, yet <0.2 for altitude. Product gates would incorrectly allow placements.
    expect(incompatible.eligibleEstimate).toBe(0);
    expect(incompatible.instances).toHaveLength(0);
  });

  it("clears native launch footprints and returns zero placements for disabled types", () => {
    const { body, type } = study();
    body.landmarks = [defaultLandmark("Pad")];
    const occupied = sampleClutterPatch(body, type, { ...options, sizeM: 100 });
    expect(occupied.eligibleEstimate).toBe(0);
    expect(occupied.instances).toHaveLength(0);
    body.landmarks = [];
    type.enabled = false;
    const disabled = sampleClutterPatch(body, type, options);
    expect(disabled.eligibleEstimate).toBe(0);
    expect(disabled.instances).toHaveLength(0);
    expect(disabled.ground.positions).toHaveLength(33 * 33 * 3);
  });
});
