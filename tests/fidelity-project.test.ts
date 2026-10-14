import {
  sampleSurface,
  nativeLocationDirection,
  nativeToAuthorDirection,
} from "../src/lib/procedural";
import { describe, expect, it } from "vitest";
import { createProject, parseProject, validateProject, uniqueId } from "../src/lib/project";
import { isPlanet, type Planet } from "../src/lib/types";
import { defaultClutter } from "../src/lib/surface";
import { assertExportBudget, bodyResolution, estimateExportBytes } from "../src/lib/exportBudget";

const home = (project: ReturnType<typeof createProject>) =>
  project.systems[0].bodies.find((b): b is Planet => isPlanet(b) && b.homeBody)!;

describe("fidelity source compatibility and safety", () => {
  it("identifies the named clutter and exact altitude point even when every distribution density is valid", () => {
    const p = createProject(),
      b = home(p);
    b.clutter = ["Giant redwood", "Scree talus", "Glass urchin"].map((name, i) => ({
      ...defaultClutter(`Clutter${i + 1}`),
      name,
    }));
    b.clutter.forEach((c, i) => {
      c.distribution.density = [0, 1, 0.54][i];
    });
    expect(validateProject(p).filter((issue) => issue.severity === "error")).toEqual([]);
    b.clutter[2].distribution.altitudeDensity[0].density = 10;
    expect(validateProject(p).filter((issue) => issue.severity === "error")).toEqual([
      {
        severity: "error",
        bodyId: "Earth",
        message:
          "Earth: clutter “Glass urchin” altitude density point 1 at -5000 m must be a finite number between 0 and 1 (current value: 10).",
      },
    ]);
    b.clutter[2].distribution.altitudeDensity[0].density = 1;
    expect(validateProject(p).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("distinguishes distribution density errors and retains a stable identity for unnamed clutter", () => {
    const p = createProject(),
      c = home(p).clutter[0];
    c.name = "";
    c.distribution.density = NaN;
    expect(validateProject(p)).toContainEqual(
      expect.objectContaining({
        message:
          "Earth: clutter “Rocks” distribution density must be a finite number between 0 and 1 (current value: NaN).",
      }),
    );
  });

  it("migrates the original singleton clutter without silently enabling clouds or sites", () => {
    const source = JSON.parse(JSON.stringify(createProject()));
    for (const system of source.systems)
      for (const b of system.bodies)
        if (b.kind === "rocky" || b.kind === "gas") {
          b.clutter = {
            enabled: b.kind === "rocky",
            density: 0.6,
            scale: 2,
            seed: 77,
            color: "#abc",
          };
          delete b.clouds;
          delete b.landmarks;
          delete b.exportResolution;
          delete b.surface.biomes;
          delete b.surface.biomeBlendStrength;
          delete b.surface.detailFadeStartM;
          delete b.surface.detailFadeEndM;
          for (const key of [
            "startHeightKm",
            "ozoneAltitudeKm",
            "ozoneExtentKm",
            "mieAbsorptionMultiplier",
            "mieAnisotropyRgb",
          ])
            delete b.atmosphere[key];
        }
    const p = parseProject(JSON.stringify(source)),
      b = home(p);
    expect(b.clutter).toHaveLength(1);
    expect(b.clutter[0]).toMatchObject({
      enabled: true,
      seed: 77,
      material: { color: "#abc" },
      distribution: { density: 0.6, minScale: [1, 1, 1], maxScale: [3, 3, 3] },
    });
    expect(b.surface.biomes.map((b) => b.id)).toEqual(["Surface"]);
    expect(b.clouds.enabled).toBe(false);
    expect(b.landmarks).toEqual([]);
    expect(b.ocean.enabled).toBe(true);
    expect(parseProject(JSON.stringify(p))).toEqual(p);
  });

  it("rejects names and IDs that collide in the native case-insensitive lookup", () => {
    const p = createProject(),
      b = home(p);
    b.landmarks.push({
      ...structuredClone(b.landmarks[0]),
      id: "Second",
      name: b.landmarks[0].name.toUpperCase(),
    });
    expect(validateProject(p)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("location names must be unique"),
      }),
    );
    b.landmarks[1].name = "Second pad";
    b.clutter.push({ ...structuredClone(b.clutter[0]), id: b.clutter[0].id.toUpperCase() });
    expect(validateProject(p)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("clutter IDs"),
      }),
    );
    expect(uniqueId("rocks", ["Rocks"])).toBe("rocks2");
    expect(uniqueId("23 Objects", [])).toBe("_23Objects");
    const gas = p.systems[0].bodies.find((body): body is Planet => body.kind === "gas")!;
    gas.clutter.push(defaultClutter("GasRock"));
    expect(validateProject(p)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("ground clutter requires a rocky body"),
      }),
    );
    const duplicateBody = structuredClone(b);
    duplicateBody.id = b.id.toLowerCase();
    p.systems[0].bodies.push(duplicateBody);
    expect(validateProject(p)).toContainEqual(
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("Duplicate body ID"),
      }),
    );
  });

  it("places the default home platform above its authored ocean", () => {
    const b = home(createProject()),
      site = b.landmarks[0];
    const h = sampleSurface(
      b,
      nativeToAuthorDirection(nativeLocationDirection(site.latitude, site.longitude)),
    ).height;
    expect((h - b.surface.seaLevel) * b.surface.elevation).toBeGreaterThan(b.ocean.levelKm + 0.05);
  });

  it("rejects malformed explicit fields and dangling or duplicate authored identities", () => {
    const changes: ((b: any) => void)[] = [
      (b) => (b.clouds = null),
      (b) => (b.clouds.orbitTransitionEndKm = b.clouds.orbitTransitionStartKm),
      (b) => (b.environmentAudio = null),
      (b) => (b.environmentAudio.loopSeconds = 1000),
      (b) => (b.atmosphere.intensity = 0),
      (b) => {
        b.atmosphere.rayleigh = [0, 0, 0];
        b.atmosphere.mie = [0, 0, 0];
      },
      (b) =>
        (b.clouds.layers[0].types[0].shapeCurve = [
          { key: 0, value: 1, inTangent: 0, outTangent: 0 },
        ]),
      (b) => (b.surface.biomes = []),
      (b) => b.surface.biomes.push(structuredClone(b.surface.biomes[0])),
      (b) => (b.surface.biomes[0].ground.normalScale = NaN),
      (b) => (b.clutter[0].distribution.biomeIds = ["Missing"]),
      (b) => (b.clutter[0].distribution.minScale = [5, 5, 5]),
      (b) => (b.clutter[0].geometry.detail = 100),
      (b) => (b.clutter[0].stockAssetId = null),
      (b) => (b.clutter[0].stockAssetId = "missing_asset"),
      (b) =>
        (b.clutter = {
          enabled: true,
          density: 0.5,
          scale: 1,
          seed: 1,
          color: "#abc",
          geometry: null,
        }),
      (b) => (b.landmarks[0].category = "unknown"),
      (b) => (b.landmarks[0].name = ""),
      (b) => (b.exportResolution = 2048),
      (b) => (b.atmosphere.mieAnisotropyRgb = [1, 1, 1]),
    ];
    for (const change of changes) {
      const p = createProject();
      change(home(p));
      expect(validateProject(p).some((i) => i.severity === "error")).toBe(true);
      expect(() => parseProject(JSON.stringify(p))).toThrow("Invalid Orbit Foundry project");
    }
  });

  it("requires actual atmospheric support for enabled clouds and warns on native launcher edge cases", () => {
    const p = createProject(),
      b = home(p);
    b.atmosphere.enabled = false;
    expect(
      validateProject(p)
        .map((i) => i.message)
        .join(),
    ).toContain("enabled clouds require an atmosphere");
    b.clouds.enabled = false;
    b.landmarks[0].category = "city";
    b.landmarks[0].launchPad = false;
    expect(validateProject(p)).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("native launch menu"),
      }),
    );
  });

  it("keeps authored clutter independent and budgets selected-body export quality", () => {
    const p = createProject(),
      b = home(p);
    b.clutter.push(defaultClutter("Crystals", 91, "#12abcd"));
    b.clutter[1].geometry.shape = "crystal";
    b.clutter[1].material.metalness = 0.4;
    expect(b.clutter[0].geometry.shape).toBe("boulder");
    expect(b.clutter[0].material.metalness).toBe(0);
    const baseline = estimateExportBytes(p);
    b.exportResolution = 512;
    expect(bodyResolution(p, b)).toBe(512);
    expect(estimateExportBytes(p)).toBeGreaterThan(baseline);
    p.exportResolution = 512;
    expect(() => assertExportBudget(p)).toThrow(/browser.*export budget/);
    p.exportResolution = 32;
    expect(() => assertExportBudget(p)).not.toThrow();
  });
});
