import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import {
  environmentAssetsXml,
  environmentAudio,
  environmentSoundXml,
  generateEnvironmentAssets,
  generateEnvironmentWav,
} from "../src/lib/environment";
import { createProject, makePlanet } from "../src/lib/project";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

describe("original native environment audio", () => {
  it("generates deterministic PCM16 mono loops with a continuous seam and bounded duration", () => {
    const settings = { ...environmentAudio(), enabled: true, loopSeconds: 4 },
      one = generateEnvironmentWav(settings),
      two = generateEnvironmentWav(settings),
      view = new DataView(one.buffer);
    expect(one).toEqual(two);
    expect(new TextDecoder().decode(one.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(one.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4 * 22050 * 2);
    expect(view.getInt16(44, true)).toBe(view.getInt16(one.length - 2, true));
    let maxAmplitude = 0,
      sum = 0;
    for (let at = 44; at < one.length; at += 2) {
      const sample = view.getInt16(at, true);
      maxAmplitude = Math.max(maxAmplitude, Math.abs(sample));
      sum += sample;
    }
    expect(maxAmplitude).toBeGreaterThan(1000);
    expect(maxAmplitude).toBeLessThan(32767);
    expect(Math.abs(sum / (4 * 22050))).toBeLessThan(5);
    expect(generateEnvironmentWav({ ...settings, seed: settings.seed + 1 })).not.toEqual(one);
    expect(() => generateEnvironmentWav({ ...settings, loopSeconds: 31 })).toThrow(/30/);
    expect(() => generateEnvironmentWav({ ...settings, loopSeconds: 3 })).toThrow(/4/);
  });

  it("keeps master volume in native/browser gain and authors independent wind, rumble and tones", () => {
    const settings = { ...environmentAudio(), loopSeconds: 4 },
      full = generateEnvironmentWav(settings);
    expect(generateEnvironmentWav({ ...settings, volume: 0 })).toEqual(full);
    expect(generateEnvironmentWav({ ...settings, wind: 0 })).not.toEqual(full);
    expect(generateEnvironmentWav({ ...settings, rumble: 0 })).not.toEqual(full);
    expect(generateEnvironmentWav({ ...settings, tones: 0 })).not.toEqual(full);
    const silent = generateEnvironmentWav({ ...settings, wind: 0, rumble: 0, tones: 0 });
    expect(silent.subarray(44).every((byte) => byte === 0)).toBe(true);
  });

  it("closes native Sound/SpatialSoundData/EnvironmentSound references with an original WAV and engine Sfx group", async () => {
    const project = createProject(),
      body = makePlanet("AudioWorld", "Audio World", "Sun");
    body.environmentAudio.enabled = true;
    body.environmentAudio.loopSeconds = 4;
    const assets = await generateEnvironmentAssets(body),
      catalog = parser.parse(
        `<Assets>${environmentAssetsXml(project, body).join("\n")}</Assets>`,
      ).Assets,
      reference = parser.parse(
        `<Body>${environmentSoundXml(project, body, "").join("\n")}</Body>`,
      ).Body;
    expect(assets).toHaveLength(1);
    expect(assets[0].path).toBe("Sounds/AudioWorld_Environment.wav");
    expect(catalog.Sound.SoundFile.Path).toBe(assets[0].path);
    expect(catalog.Sound.Id).toBe(reference.EnvironmentSound.Id);
    expect(catalog.Sound.SpatialSoundData.Id).toBe(catalog.SpatialSoundData.Id);
    expect(catalog.Sound.ChannelId).toBe("Sfx"); // GameAudio registers this; no Core file lookup.
    expect(catalog.Sound.SoundFile.TwoD).toBe("true");
    expect(catalog.Sound.SoundFile).toHaveProperty("Loop");
    expect(Number(catalog.Sound.SoundFile.Volume)).toBe(body.environmentAudio.volume);
    expect(environmentAssetsXml(project, body).join("\n")).not.toMatch(
      /BiomeSounds|DefaultSpatialSoundData|\.bank|Core\//,
    );
  });

  it("defaults to silence and exports no audio for disabled or gas bodies", async () => {
    const project = createProject(),
      body = makePlanet("test", "Test", "Sun");
    expect(body.environmentAudio.enabled).toBe(false);
    expect(await generateEnvironmentAssets(body)).toEqual([]);
    expect(environmentAssetsXml(project, body)).toEqual([]);
    expect(environmentSoundXml(project, body, "")).toEqual([]);
    body.kind = "gas";
    body.environmentAudio.enabled = true;
    expect(await generateEnvironmentAssets(body)).toEqual([]);
    expect(environmentSoundXml(project, body, "")).toEqual([]);
  });
});
