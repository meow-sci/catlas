import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";
import { makePlanet } from "../src/lib/project";
import {
  cloudLayer,
  cloudType,
  clouds,
  compileCloudProfile,
  evaluateCloudCurve,
  nativeAtmosphereHeightKm,
  nativeCloudDirection,
  physicalScaleHeightKm,
  sampleCloud,
} from "../src/lib/atmosphere";
import {
  cloudAssetPaths,
  cloudPixels,
  cloudsXml,
  generateCloudAssets,
} from "../src/lib/atmosphereExport";
import {
  compileSurfaceSampler,
  nativeLocationDirection,
  nativeToAuthorDirection,
} from "../src/lib/procedural";

function pngPixels(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16),
    height = view.getUint32(20),
    length = view.getUint32(33);
  const raw = inflateSync(bytes.subarray(41, 41 + length)),
    pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)]).toBe(0);
    pixels.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, pixels };
}

describe("native atmosphere optics and weather", () => {
  it("keeps gas belts broad and continuous while band frequency controls their count", () => {
    const body = makePlanet("Belts", "Belts", "Sol", "gas");
    body.surface.colors = [
      { at: 0, color: "#111111" },
      { at: 1, color: "#eeeeee" },
    ];
    body.surface.stormStrength = 0;
    const beltPeaks = (frequency: number) => {
      body.surface.bandFrequency = frequency;
      const sample = compileSurfaceSampler(body);
      const values = Array.from({ length: 512 }, (_, i) => {
        const latitude = -1.3 + (i / 511) * 2.6;
        return sample([Math.cos(latitude), Math.sin(latitude), 0]).color[0];
      });
      return values.filter(
        (v, i) => i > 0 && i < values.length - 1 && v > values[i - 1] && v >= values[i + 1],
      ).length;
    };
    const broad = beltPeaks(6),
      narrow = beltPeaks(18);
    expect(broad).toBeGreaterThan(0);
    expect(broad).toBeLessThan(5);
    expect(narrow).toBeGreaterThan(broad + 3);
    const sample = compileSurfaceSampler(body);
    const west = sample([-1, 0.2, -1e-7]),
      east = sample([-1, 0.2, 1e-7]);
    west.color.forEach((v, i) => expect(v).toBeCloseTo(east.color[i], 5));
    expect(sample([0, 1, 0])).toEqual({ height: 0.5, color: sample([0, 2, 0]).color, biome: 0 });
  });

  it("varies original gas turbulence and vortices with seed and storm strength", () => {
    const body = makePlanet("Jupiter", "Jupiter", "Sol", "gas");
    const directions = Array.from({ length: 256 }, (_, i): [number, number, number] => {
      const y = 1 - ((i + 0.5) * 2) / 256,
        radius = Math.sqrt(1 - y * y),
        longitude = i * 2.39996323;
      return [Math.cos(longitude) * radius, y, Math.sin(longitude) * radius];
    });
    const colors = () => {
      const sample = compileSurfaceSampler(body);
      return directions.flatMap((direction) => sample(direction).color);
    };
    const baseline = colors();
    expect(colors()).toEqual(baseline);
    body.surface.seed++;
    const changedSeed = colors();
    expect(changedSeed).not.toEqual(baseline);
    body.surface.stormStrength = 0;
    const quiet = colors();
    body.surface.stormStrength = 1;
    const stormy = colors();
    const differences = stormy.map((v, i) => Math.abs(v - quiet[i]));
    expect(Math.max(...differences)).toBeGreaterThan(0.05);
    expect(differences.reduce((a, b) => a + b, 0) / differences.length).toBeGreaterThan(0.003);
    expect(stormy.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
  });

  it("uses KSA's km^-1 coefficients and derived boundary independently of the legacy authoring height", () => {
    const body = makePlanet("Air", "Air", "Sol");
    body.atmosphere.enabled = true;
    body.atmosphere.rayleigh = [0.005802, 0.013558, 0.0331];
    body.atmosphere.mie = [0.003996, 0.003996, 0.003996];
    body.atmosphere.startHeightKm = 2;
    body.atmosphere.heightKm = 500;
    expect(nativeAtmosphereHeightKm(body.atmosphere)).toBeCloseTo(
      2 - body.atmosphere.rayleighHeightKm * Math.log(1e-7 / 0.0331),
      10,
    );
    expect(nativeAtmosphereHeightKm(body.atmosphere)).toBeLessThan(110);
    body.radiusKm = 6371;
    body.massEarths = 1;
    expect(physicalScaleHeightKm(body)).toBeCloseTo(8.4265, 2);
  });

  it("places cloud maps on the same native north pole and longitude as exported terrain and locations", () => {
    for (const [latitude, longitude] of [
      [90, 0],
      [-90, 0],
      [0, 0],
      [0, 90],
      [45, -120],
    ]) {
      const direction = nativeCloudDirection(0.5 + longitude / 360, 0.5 - latitude / 180);
      const site = nativeToAuthorDirection(nativeLocationDirection(latitude, longitude));
      direction.forEach((v, axis) => expect(v).toBeCloseTo(site[axis], 12));
    }
    expect(nativeCloudDirection(0, 0.35)).toEqual(
      nativeCloudDirection(1, 0.35).map((v, i) => (i === 2 ? -v : v)),
    );
  });

  it("uses Hermite tangents and all cloud types to alter the native vertical profile", () => {
    expect(
      evaluateCloudCurve(
        [
          { key: 0, value: 0, inTangent: 0, outTangent: 2 },
          { key: 1, value: 1, inTangent: 0, outTangent: 0 },
        ],
        0.5,
      ),
    ).toBeCloseTo(0.75);
    const layer = cloudLayer("gas", 21);
    const middle = cloudType("gas");
    middle.name = "Middle convective bank";
    middle.startAltitudeKm = 180;
    middle.heightKm = 150;
    layer.types.splice(1, 0, middle);
    const profile = compileCloudProfile(layer);
    expect(profile.topAltitudeKm(1, 0.5)).toBeGreaterThan(300);
    expect(profile.topAltitudeKm(1, 0.5)).toBeGreaterThan(profile.topAltitudeKm(1, 0));
    const previous = profile.opticalDepths[1];
    middle.densityCurve.forEach((p) => (p.value = 0));
    expect(compileCloudProfile(layer).opticalDepths[1]).toBe(0);
    expect(previous).toBeGreaterThan(0);
    middle.shapeCurve.forEach((p) => (p.value = 0));
    expect(compileCloudProfile(layer).topAltitudeKm(0.8, 0.5)).toBeLessThan(200);
  });

  it("creates original independent coverage, selector, varied detail, relief and signed flow channels", () => {
    const body = makePlanet("Clouds", "Clouds", "Sol", "gas");
    const layer = cloudLayer("gas", 71),
      pixels = cloudPixels(body, layer, 64, 32);
    expect(pixels).toEqual(cloudPixels(body, layer, 64, 32));
    const channels = (data: Uint8Array, channel: number) =>
      Array.from(data).filter((_, i) => i % 4 === channel);
    expect(new Set(channels(pixels.mask, 0)).size).toBeGreaterThan(20);
    expect(new Set(channels(pixels.mask, 3)).size).toBeGreaterThan(20);
    expect(channels(pixels.mask, 0)).not.toEqual(channels(pixels.mask, 3));
    expect(new Set(channels(pixels.detail, 0)).size).toBeGreaterThan(5);
    expect(new Set(channels(pixels.detail, 1)).size).toBeGreaterThan(5);
    expect(new Set(channels(pixels.normal, 0)).size).toBeGreaterThan(5);
    expect(Math.min(...channels(pixels.flow, 0))).toBeLessThan(128);
    expect(Math.max(...channels(pixels.flow, 0))).toBeGreaterThan(128);
    expect(new Set(channels(pixels.flow, 2))).toEqual(new Set([128]));
    layer.seed++;
    expect(cloudPixels(body, layer, 64, 32).mask).not.toEqual(pixels.mask);
    layer.coverage = 0;
    expect(sampleCloud(body, layer, [0.4, 0.5, 0.7]).coverage).toBe(0);
    layer.coverage = 1;
    expect(sampleCloud(body, layer, [0.4, 0.5, 0.7]).coverage).toBe(1);
  });

  it("emits every native cloud field with self-contained maps and all authored profile points", async () => {
    const body = makePlanet("Weather", "Weather", "Sol", "gas");
    body.atmosphere.enabled = true;
    body.clouds = clouds("gas", 42);
    const layer = body.clouds.layers[0];
    layer.color = "#abc";
    layer.types.splice(1, 0, { ...cloudType("gas"), name: 'Storm & "haze"', density: 0.0007 });
    const source = cloudsXml(body, "Test_Weather").join("\n");
    const cloud = new XMLParser({ ignoreAttributes: false }).parse(source).Clouds;
    expect(cloud.OrbitTransitionStartAltitude["@_Km"]).toBe("5000");
    expect(cloud.Layer.VolumetricCloud.CloudType).toHaveLength(3);
    expect(cloud.Layer.VolumetricCloud.CloudType[1]["@_Name"]).toBe('Storm & "haze"');
    expect(Number(cloud.Layer.VolumetricCloud.CloudType[1].Density["@_Value"])).toBeCloseTo(
      0.0007 * layer.opacity,
    );
    expect(cloud.Layer.VolumetricCloud.CloudType[1].CloudShape.ShapeCurve.SplinePoint).toHaveLength(
      layer.types[1].shapeCurve.length,
    );
    expect(cloud.Layer.TwoDimensionalCloud.Color["@_R"]).toBe("0.666666666667");
    expect(cloud.Layer.VolumetricCloud.Detail.DetailSelector["@_Id"]).toBe(
      cloud.Layer.VolumetricCloud.Texture["@_Id"],
    );
    expect(cloud.Layer.TwoDimensionalCloud.Texture["@_Id"]).toBe(
      cloud.Layer.VolumetricCloud.VolumetricsColorMap["@_Id"],
    );
    expect(cloud.Layer.TwoDimensionalCloud.FlowMap.Texture["@_Id"]).toBe(
      cloud.Layer.VolumetricCloud.VolumetricsFlowMap.Texture["@_Id"],
    );
    const assets = await generateCloudAssets(body, 8),
      paths = cloudAssetPaths(body, layer);
    expect(assets.map((a) => a.path).sort()).toEqual(Object.values(paths).sort());
    const pathReferences = [...source.matchAll(/Path="([^"]+)"/g)].map((m) => m[1]);
    expect(pathReferences.every((path) => assets.some((a) => a.path === path))).toBe(true);
    const map = pngPixels(assets.find((a) => a.path === paths.mask)!.data);
    expect([map.width, map.height]).toEqual([32, 16]);
    expect(map.pixels).toEqual(cloudPixels(body, layer, 32, 16).mask);
    layer.flow.enabled = false;
    expect(cloudsXml(body, "Test_Weather").join("\n")).not.toContain("<FlowMap>");
    expect((await generateCloudAssets(body, 8)).map((a) => a.path)).not.toContain(paths.flow);
    body.atmosphere.enabled = false;
    expect(cloudsXml(body, "Test_Weather")).toEqual([]);
    expect(await generateCloudAssets(body, 8)).toEqual([]);
  });
});
