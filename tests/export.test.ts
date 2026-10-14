import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { buildModFiles, buildSystemXml, exportMod } from "../src/lib/export";
import { createProject, makeStar, orbit } from "../src/lib/project";
import { isPlanet, type Barycenter, type Planet, type Project } from "../src/lib/types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
const array = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

describe("native KSA export", () => {
  it("exports authored ocean values on an airless rocky body using native units", () => {
    const project = createProject();
    const luna = project.systems[0].bodies.find(
      (body): body is Planet => isPlanet(body) && body.id === "Luna",
    )!;
    luna.ocean.enabled = true;
    luna.ocean.levelKm = -0.25;
    luna.ocean.color = "#336699";
    luna.ocean.transparencyDepthM = 45;
    luna.ocean.windWaves = {
      minWindSpeed: 3,
      maxWindSpeed: 8,
      minWindFetchKm: 40,
      maxWindFetchKm: 100,
      directionality: 0.4,
      depthM: 350,
      foamAmount: 0.2,
    };
    luna.ocean.gerstnerWaves = {
      count: 3,
      lengthM: 400,
      amplitude: 0.1,
      speed: 2,
      lengthPersistence: 0.8,
      amplitudePersistence: 0.9,
      speedPersistence: 1.1,
    };
    const system = parser.parse(buildSystemXml(project)).System;
    const nativeLuna = array<Record<string, any>>(system.AtmosphericBody).find(
      (body) => body["@_Id"] === "OrbitFoundry_Luna",
    )!;
    expect(nativeLuna.Atmosphere).toBeUndefined();
    expect(nativeLuna.Height["@_Path"]).toBe("Textures/Luna_Height.ktx2");
    expect(nativeLuna.Ocean).toEqual({
      Level: { "@_Km": "-0.25" },
      MeshCollection: { "@_Id": "OrbitFoundry_PlanetMeshes" },
      WindWaves: {
        MinWindSpeed: { "@_Value": "3" },
        MaxWindSpeed: { "@_Value": "8" },
        MinWindFetch: { "@_Km": "40" },
        MaxWindFetch: { "@_Km": "100" },
        Directionality: { "@_Value": "0.4" },
        Depth: { "@_M": "350" },
        FoamAmount: { "@_Value": "0.2" },
      },
      GerstnerWaves: {
        Count: { "@_Value": "3" },
        Length: { "@_M": "400" },
        Amplitude: { "@_Value": "0.1" },
        Speed: { "@_Value": "2" },
        LengthPersistence: { "@_Value": "0.8" },
        AmplitudePersistence: { "@_Value": "0.9" },
        SpeedPersistence: { "@_Value": "1.1" },
      },
      Color: { "@_R": "0.2", "@_G": "0.4", "@_B": "0.6" },
      TransparencyDepth: { "@_M": "45" },
    });
    expect(nativeLuna.Ocean.Density).toBeUndefined();
    const nativeMercury = array<Record<string, any>>(system.PlanetaryBody).find(
      (body) => body["@_Id"] === "OrbitFoundry_Mercury",
    )!;
    expect(nativeMercury.Ocean).toBeUndefined();
  });

  it("places a binary pair and its planet in one system with consistent parents", () => {
    const project = createProject();
    const barycenter: Barycenter = {
      id: "PairCenter",
      name: "Pair Center",
      kind: "barycenter",
      parentId: null,
      position: [1, 2, 3],
      orbit: orbit(),
    };
    const a = makeStar("A", "A");
    a.parentId = barycenter.id;
    a.orbit = { ...orbit(0.2), barycentric: true };
    const b = makeStar("B", "B");
    b.parentId = barycenter.id;
    b.orbit = { ...orbit(0.2), barycentric: true, argumentOfPeriapsis: 180 };
    const home = project.systems[0].bodies.find((body) => body.id === "Earth");
    if (!home || home.kind === "star" || home.kind === "barycenter")
      throw new Error("Missing Earth fixture");
    home.parentId = a.id;
    project.systems = [
      {
        id: "Pair",
        name: "The Pair",
        description: "",
        position: [3, 4, 5],
        bodies: [barycenter, a, b, home],
      },
    ];

    const raw = buildSystemXml(project);
    const system = parser.parse(raw).System;
    expect(system["@_Id"]).toBe("OrbitFoundry");
    expect(array<Record<string, unknown>>(system.Barycenter)[0]["@_Id"]).toBe(
      "OrbitFoundry_PairCenter",
    );
    expect(raw).toContain('<X Ly="4" />');
    expect(raw).toContain('<Y Ly="6" />');
    expect(raw).toContain('<Z Ly="8" />');
    const stars = array<Record<string, string>>(system.StellarBody);
    expect(stars).toHaveLength(2);
    expect(stars.every((star) => star["@_Parent"] === "OrbitFoundry_PairCenter")).toBe(true);
    expect(raw.match(/<Barycentric Value="true" \/>/g)).toHaveLength(2);
    const planet = array<Record<string, string>>(system.AtmosphericBody)[0];
    expect(planet["@_Parent"]).toBe("OrbitFoundry_A");
    expect(planet["@_HomeBody"]).toBe("true");
  });

  it("packages one selectable system and closes all authored Path references", async () => {
    const project: Project = createProject();
    const sol = project.systems[0].bodies.find((body) => body.id === "Sol");
    const earth = project.systems[0].bodies.find((body) => body.id === "Earth");
    if (!sol || !earth) throw new Error("Missing fixture bodies");
    project.systems = [{ ...project.systems[0], bodies: [sol, earth] }];
    project.exportResolution = 32;
    const blob = await exportMod(project);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
    const prefix = "OrbitFoundry/";
    expect(paths).toContain(prefix + "mod.toml");
    expect(paths).toContain(prefix + "Systems/OrbitFoundry.xml");
    expect(paths).toContain(prefix + "Assets.xml");
    expect(paths).toContain(prefix + "PlanetMeshes.xml");
    expect(paths).toContain(prefix + "project.json");
    const manifest = await zip.file(prefix + "mod.toml")!.async("string");
    expect(manifest).toContain('systems = ["Systems/OrbitFoundry.xml"]');
    expect(manifest).toContain('planetMeshes = ["PlanetMeshes.xml"]');
    const systemXml = await zip.file(prefix + "Systems/OrbitFoundry.xml")!.async("string");
    const assetsXml = await zip.file(prefix + "Assets.xml")!.async("string");
    const system = parser.parse(systemXml).System;
    parser.parse(assetsXml);
    expect(system["@_Id"]).toBe("OrbitFoundry");
    expect(array(system.StellarBody)).toHaveLength(1);
    expect(array(system.AtmosphericBody)).toHaveLength(1);
    const nativeEarth = array<Record<string, any>>(system.AtmosphericBody)[0];
    const meshes = parser.parse(
      await zip.file(prefix + "PlanetMeshes.xml")!.async("string"),
    ).PlanetMeshCollection;
    expect(nativeEarth.Ocean.MeshCollection["@_Id"]).toBe(meshes["@_Id"]);
    expect(array(meshes.CubeMesh)).toHaveLength(2);
    expect(
      array<Record<string, any>>(meshes.CubeMesh).every(
        (mesh) => Number(mesh.Face["@_Resolution"]) > 0,
      ),
    ).toBe(true);
    expect(nativeEarth.Ocean.Level["@_Km"]).toBe("0");
    expect(nativeEarth.Ocean.GerstnerWaves.Count["@_Value"]).toBe("0");
    expect(nativeEarth.Ocean.Density).toBeUndefined();
    expect(nativeEarth.Height["@_Path"]).toBe("Textures/Earth_Height.ktx2");
    expect(systemXml).toContain('<BiomeMaterial Biome="Surface">');
    expect(systemXml).toContain("<GroundMaterial");
    expect(systemXml).toContain("<SlopeMaterial");
    expect(systemXml).toContain('<Minimum Km="-5.76" />');
    expect(systemXml).toContain('<Maximum Km="6.24" />');
    for (const [, path] of (systemXml + assetsXml).matchAll(/\bPath="([^"]+)"/g)) {
      expect(paths, `Missing authored asset ${path}`).toContain(prefix + path);
    }
    expect(paths.some((path) => path.endsWith("Earth_Diffuse.ktx2"))).toBe(true);
    expect(paths.some((path) => /Meshes\/Earth_Clutter_.*\.glb$/.test(path))).toBe(true);
    expect(systemXml).not.toContain('Id="Default"');
    expect(systemXml).not.toContain('Path="Textures/Planets/');
  });

  it("exports the starter interstellar collection including gas rings", async () => {
    const project = createProject();
    const luna = project.systems[0].bodies.find(
      (body): body is Planet => isPlanet(body) && body.id === "Luna",
    )!;
    luna.rings.enabled = true;
    project.exportResolution = 32;
    const files = await buildModFiles(project);
    const systemXml = String(files["Systems/OrbitFoundry.xml"]);
    expect(systemXml).toContain('Id="OrbitFoundry_Sol"');
    expect(systemXml).toContain('Id="OrbitFoundry_BarnardsStar"');
    expect(systemXml).toContain('Id="OrbitFoundry_TauCeti"');
    expect(systemXml).toContain('<Rings DefinitionFrame="Equatorial">');
    expect(files["Textures/Saturn_Rings.png"]).toBeInstanceOf(Uint8Array);
    expect(files["Textures/Saturn_RingsControl.png"]).toBeInstanceOf(Uint8Array);
    expect(files["Meshes/Saturn_Rock.glb"]).toBeInstanceOf(Uint8Array);
    expect(files["Textures/Luna_Rings.png"]).toBeInstanceOf(Uint8Array);
    expect(files["Textures/Luna_RingsControl.png"]).toBeInstanceOf(Uint8Array);
    expect(files["Meshes/Luna_Rock.glb"]).toBeInstanceOf(Uint8Array);
    const nativeSystem = parser.parse(systemXml).System;
    const nativeEarth = array<Record<string, any>>(nativeSystem.AtmosphericBody).find(
      (body) => body["@_Id"] === "OrbitFoundry_Earth",
    )!;
    const meshes = parser.parse(String(files["PlanetMeshes.xml"])).PlanetMeshCollection;
    expect(nativeEarth.Ocean.MeshCollection["@_Id"]).toBe(meshes["@_Id"]);
    expect(
      array<Record<string, any>>(meshes.CubeMesh).every(
        (mesh) => Number(mesh.Face["@_Resolution"]) > 0,
      ),
    ).toBe(true);
    const nativeLuna = array<Record<string, any>>(nativeSystem.PlanetaryBody).find(
      (body) => body["@_Id"] === "OrbitFoundry_Luna",
    )!;
    expect(nativeLuna.Rings.Texture["@_Path"]).toBe("Textures/Luna_Rings.png");
    expect(nativeLuna.Rings.ControlTexture["@_Path"]).toBe("Textures/Luna_RingsControl.png");
    expect(String(files["README.md"])).toContain("Water density retains the native default");
    for (const [, path] of (systemXml + String(files["Assets.xml"])).matchAll(
      /\bPath="([^"]+)"/g,
    )) {
      expect(files[path], `Missing asset ${path}`).toBeInstanceOf(Uint8Array);
    }
  });

  it("records the startup warning in a dry archive without blocking export", async () => {
    const project = createProject();
    const sol = project.systems[0].bodies.find((body) => body.id === "Sol")!;
    const earth = project.systems[0].bodies.find(
      (body): body is Planet => isPlanet(body) && body.id === "Earth",
    )!;
    earth.ocean.enabled = false;
    project.systems = [{ ...project.systems[0], bodies: [sol, earth] }];
    project.exportResolution = 32;
    const files = await buildModFiles(project);
    expect(String(files["Systems/OrbitFoundry.xml"])).not.toContain("<Ocean>");
    expect(String(files["README.md"])).toMatch(
      /## Warnings[\s\S]*at least one enabled ocean[\s\S]*crashes at startup/,
    );
  });
});
