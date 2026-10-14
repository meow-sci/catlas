import { describe, expect, it } from "vitest";
import { buildSystemXml } from "../src/lib/export";
import {
  createProject,
  descendants,
  makePlanet,
  makeStar,
  ocean,
  orbit,
  parseProject,
  validateProject,
} from "../src/lib/project";
import { isPlanet, type Barycenter, type Planet, type Project } from "../src/lib/types";

function messages(project: unknown): string {
  return validateProject(project)
    .map((issue) => issue.message)
    .join("\n");
}

function importedWith(mutate: (value: Record<string, any>) => void): string {
  const value = JSON.parse(JSON.stringify(createProject())) as Record<string, any>;
  mutate(value);
  return JSON.stringify(value);
}

describe("project validation and import", () => {
  it("starts with an Earth ocean and keeps newly authored planets dry", () => {
    const project = createProject();
    const planets = project.systems.flatMap((system) => system.bodies).filter(isPlanet);
    expect(planets.filter((body) => body.ocean.enabled).map((body) => body.id)).toEqual(["Earth"]);
    const first = makePlanet("First", "First", "Sol");
    const second = makePlanet("Second", "Second", "Sol");
    expect(first.ocean).toEqual(ocean(false));
    first.ocean.windWaves.maxWindSpeed = 5;
    expect(second.ocean.windWaves.maxWindSpeed).toBe(15);
  });

  it("migrates legacy version 1 projects without enabling new content", () => {
    const legacy = JSON.parse(JSON.stringify(createProject()));
    for (const system of legacy.systems)
      for (const body of system.bodies)
        if (body.kind === "rocky" || body.kind === "gas") delete body.ocean;
    const imported = parseProject(JSON.stringify(legacy));
    const planets = imported.systems.flatMap((system) => system.bodies).filter(isPlanet);
    expect(planets.every((body) => body.ocean.enabled === false)).toBe(true);
    expect(imported.systems[0].bodies.find((body) => body.id === "Earth")).toMatchObject({
      surface: { seaLevel: 0.48 },
    });
    expect(validateProject(imported)).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: expect.stringMatching(/at least one enabled ocean.*crashes at startup/),
      }),
    ]);
    expect(parseProject(JSON.stringify(imported))).toEqual(imported);
    expect(buildSystemXml(imported)).not.toContain("<Ocean>");
  });

  it("checks the ocean requirement across all star-system tabs together", () => {
    const project = createProject();
    for (const system of project.systems)
      for (const body of system.bodies) if (isPlanet(body)) body.ocean.enabled = false;
    expect(validateProject(project).filter((issue) => issue.severity === "warning")).toHaveLength(
      1,
    );
    const distant = project.systems[1].bodies.find(isPlanet)!;
    distant.ocean.enabled = true;
    expect(validateProject(project)).toEqual([]);
    expect(parseProject(JSON.stringify(project))).toEqual(project);
  });

  it("rejects malformed and unsafe ocean values even when importing", () => {
    const mutations: ((body: Planet) => void)[] = [
      (body) => {
        body.ocean = null as unknown as Planet["ocean"];
      },
      (body) => {
        body.ocean.enabled = "true" as unknown as boolean;
      },
      (body) => {
        body.ocean.color = "blue";
      },
      (body) => {
        body.ocean.levelKm = -body.radiusKm;
      },
      (body) => {
        body.ocean.transparencyDepthM = 0;
      },
      (body) => {
        body.ocean.windWaves = null as unknown as Planet["ocean"]["windWaves"];
      },
      (body) => {
        body.ocean.windWaves.maxWindSpeed = 0;
      },
      (body) => {
        body.ocean.windWaves.minWindFetchKm = 801;
      },
      (body) => {
        body.ocean.windWaves.directionality = 2;
      },
      (body) => {
        body.ocean.gerstnerWaves.count = 65;
      },
      (body) => {
        body.ocean.gerstnerWaves.count = 1.5;
      },
      (body) => {
        body.ocean.gerstnerWaves.lengthM = 0;
      },
    ];
    for (const mutate of mutations) {
      const project = createProject();
      const earth = project.systems[0].bodies.find(
        (body): body is Planet => isPlanet(body) && body.id === "Earth",
      )!;
      mutate(earth);
      expect(
        validateProject(project).some(
          (issue) => issue.severity === "error" && issue.bodyId === "Earth",
        ),
      ).toBe(true);
      expect(() => parseProject(JSON.stringify(project))).toThrow(
        /^Invalid Orbit Foundry project:/,
      );
    }
    const project = createProject();
    const gas = project.systems[0].bodies.find((body): body is Planet => body.kind === "gas")!;
    gas.ocean.enabled = true;
    expect(messages(project)).toMatch(/oceans can only be enabled on rocky bodies/);
    expect(() => buildSystemXml(project)).toThrow(/oceans can only be enabled on rocky bodies/);
  });

  it("round-trips a complete starter project and uses local root-star offsets", () => {
    const project = createProject();
    expect(validateProject(project)).toEqual([]);
    expect(parseProject(JSON.stringify(project))).toEqual(project);
    expect(project.systems[1].position).not.toEqual([0, 0, 0]);
    expect(project.systems[2].position).not.toEqual([0, 0, 0]);
    expect(project.systems[1].bodies[0]).toMatchObject({ kind: "star", position: [0, 0, 0] });
    expect(project.systems[2].bodies[0]).toMatchObject({ kind: "star", position: [0, 0, 0] });
    const xml = buildSystemXml(project);
    expect(xml).toContain('<X Ly="-0.0568315" />');
    expect(xml).toContain('<Y Ly="-5.2581852" />');
    expect(xml).toContain('<Z Ly="2.8114872" />');
  });

  it("rejects invalid JSON and malformed nested fields with readable errors", () => {
    expect(() => parseProject("{")).toThrow("not valid JSON");
    for (const text of [
      "null",
      "{}",
      importedWith((value) => {
        value.systems = [null];
      }),
      importedWith((value) => {
        value.systems[0].bodies[0].orbit = null;
      }),
      importedWith((value) => {
        value.systems[0].bodies[3].surface.colors = [null];
      }),
      importedWith((value) => {
        value.systems[0].position = [0, 1];
      }),
      importedWith((value) => {
        value.systems[0].bodies[3].atmosphere.rayleigh = ["x", 0, 0];
      }),
      importedWith((value) => {
        value.systems[0].name = "Sol\u0000bad";
      }),
    ]) {
      expect(() => parseProject(text), text).toThrow(/^Invalid Orbit Foundry project:/);
    }
  });

  it("blocks unsafe IDs, nonfinite and impossible physical values before export", () => {
    const project = createProject();
    const star = project.systems[0].bodies[0];
    const earth = project.systems[0].bodies.find((body) => body.id === "Earth");
    if (!earth || earth.kind === "star" || earth.kind === "barycenter" || star.kind !== "star")
      throw new Error("Bad fixture");
    project.id = "../Escape";
    star.massSuns = -1;
    earth.radiusKm = -5;
    earth.surface.colors[0].color = "javascript:evil";
    earth.surface.colors[0].at = 2;
    earth.atmosphere.heightKm = Number.NaN;
    earth.orbit.eccentricity = 1.1;
    earth.rings.enabled = true;
    earth.rings.innerRadius = 0.4;
    const errors = messages(project);
    expect(errors).toMatch(/Mod ID/);
    expect(errors).toMatch(/mass must be positive/);
    expect(errors).toMatch(/radius must be positive/);
    expect(errors).toMatch(/#RGB or #RRGGBB/);
    expect(errors).toMatch(/color stop 1 position.*between 0 and 1/);
    expect(errors).toMatch(/atmosphere heightKm.*positive and finite/);
    expect(errors).toMatch(/eccentricity.*between 0 and 1/);
    expect(errors).toMatch(/rings must start above the surface/);
    expect(() => buildSystemXml(project)).toThrow(/Mod ID/);
  });

  it("checks duplicate IDs, same-system parents, cycles, roots, stars, and one rocky home", () => {
    const duplicate = createProject();
    duplicate.systems[1].id = "Sol";
    duplicate.systems[1].bodies[0].id = "Sol";
    expect(messages(duplicate)).toMatch(/Duplicate system ID: Sol/);
    expect(messages(duplicate)).toMatch(/Duplicate body ID: Sol/);

    const crossSystem = createProject();
    crossSystem.systems[1].bodies[1].parentId = "TauCeti";
    expect(messages(crossSystem)).toMatch(/must be in the same star system/);

    const cycle = createProject();
    const earth = cycle.systems[0].bodies.find((body) => body.id === "Earth");
    const luna = cycle.systems[0].bodies.find((body) => body.id === "Luna");
    if (!earth || !luna) throw new Error("Bad fixture");
    earth.parentId = "Luna";
    expect(messages(cycle)).toMatch(/circular parent hierarchy/);
    expect(descendants("Earth", cycle.systems[0].bodies)).toEqual(["Earth", "Luna"]);

    const noRoot = createProject();
    noRoot.systems[0].bodies[0].parentId = "Earth";
    expect(messages(noRoot)).toMatch(/add a root star or barycenter/);

    const noStar = createProject();
    noStar.systems[0].bodies = noStar.systems[0].bodies.filter((body) => body.kind !== "star");
    expect(messages(noStar)).toMatch(/needs a star/);

    const noHome = createProject();
    const home = noHome.systems[0].bodies.find((body) => body.id === "Earth");
    if (!home || home.kind === "star" || home.kind === "barycenter") throw new Error("Bad fixture");
    home.homeBody = false;
    expect(messages(noHome)).toMatch(/exactly one rocky home body/);
    const gas = noHome.systems[0].bodies.find((body) => body.id === "Saturn");
    if (!gas || gas.kind === "star" || gas.kind === "barycenter") throw new Error("Bad fixture");
    gas.homeBody = true;
    expect(messages(noHome)).toMatch(/home body must be rocky/);
    home.homeBody = true;
    expect(messages(noHome)).toMatch(/home body must be rocky/);
  });

  it("requires a root barycenter with an immediate positive-mass barycentric star", () => {
    const project = createProject();
    const sol = project.systems[0];
    const center: Barycenter = {
      id: "Center",
      name: "Center",
      kind: "barycenter",
      parentId: null,
      position: [0, 0, 0],
      orbit: orbit(),
    };
    const companion = makeStar("Companion", "Companion");
    companion.parentId = center.id;
    sol.bodies.push(center, companion);
    expect(messages(project)).toMatch(/barycenter needs an immediate barycentric child star/);
    companion.orbit.barycentric = true;
    expect(validateProject(project)).toEqual([]);
    center.parentId = "Sol";
    expect(messages(project)).toMatch(/barycenter must be a system root/);
    center.parentId = null;
    companion.massSuns = 0;
    expect(messages(project)).toMatch(/mass must be positive/);
    expect(messages(project)).toMatch(/barycenter needs an immediate barycentric child star/);
  });

  it("rejects structural omissions in imported nested body settings", () => {
    for (const [field, value] of [
      ["rotation", null],
      ["surface", null],
      ["atmosphere", null],
      ["ocean", null],
      ["rings", null],
      ["clutter", null],
    ] as const) {
      const text = importedWith((project) => {
        const earth = project.systems[0].bodies.find((body: { id: string }) => body.id === "Earth");
        earth[field] = value;
      });
      expect(() => parseProject(text), field).toThrow(/^Invalid Orbit Foundry project:/);
    }
  });
});
