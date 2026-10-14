import type { GeneratedAsset } from "./assets";
import type { EnvironmentAudioSettings, Planet, Project } from "./types";

export function environmentAudio(): EnvironmentAudioSettings {
  return {
    enabled: false,
    seed: 71,
    volume: 0.35,
    wind: 0.7,
    rumble: 0.25,
    tones: 0.1,
    loopSeconds: 12,
  };
}

const safe = (value: string) => value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]/, "_$&");
const soundId = (project: Project, body: Planet) => `${safe(project.id)}_${body.id}_Environment`;
export const environmentAssetPath = (body: Planet) => `Sounds/${body.id}_Environment.wav`;

function randomGenerator(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function cyclicNoise(count: number, random: () => number) {
  const table = Float32Array.from({ length: count }, () => random() * 2 - 1);
  const mean = table.reduce((sum, value) => sum + value, 0) / count;
  for (let index = 0; index < table.length; index++) table[index] -= mean;
  return (phase: number) => {
    const index = (phase % 1) * count,
      start = Math.floor(index),
      t = index - start,
      blend = t * t * (3 - 2 * t);
    return table[start] * (1 - blend) + table[(start + 1) % count] * blend;
  };
}

/** Original PCM16 audio, with periodic fields and integer loop harmonics. */
export function generateEnvironmentWav(settings: EnvironmentAudioSettings): Uint8Array {
  if (
    !Number.isFinite(settings.loopSeconds) ||
    settings.loopSeconds < 4 ||
    settings.loopSeconds > 30
  )
    throw new Error("Environment loops must be between 4 and 30 seconds");
  for (const field of ["wind", "rumble", "tones"] as const)
    if (!Number.isFinite(settings[field]) || settings[field] < 0 || settings[field] > 1)
      throw new Error(`Environment ${field} must be between 0 and 1`);
  if (!Number.isFinite(settings.seed)) throw new Error("Environment seed must be finite");
  const sampleRate = 22050,
    sampleCount = Math.round(settings.loopSeconds * sampleRate),
    output = new Uint8Array(44 + sampleCount * 2),
    view = new DataView(output.buffer);
  const writeText = (offset: number, value: string) =>
    output.set(new TextEncoder().encode(value), offset);
  writeText(0, "RIFF");
  view.setUint32(4, output.length - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  const random = randomGenerator(settings.seed + 0x1a2b3c),
    windLow = cyclicNoise(Math.round(settings.loopSeconds * 180), random),
    windHigh = cyclicNoise(Math.round(settings.loopSeconds * 2100), random),
    rumble = cyclicNoise(Math.round(settings.loopSeconds * 7), random);
  const frequencies = [83, 157, 223].map((frequency) =>
      Math.round((frequency + random() * 7) * settings.loopSeconds),
    ),
    phases = [random(), random(), random()].map((phase) => phase * Math.PI * 2);
  const rumbleFrequency = Math.round((29 + random() * 6) * settings.loopSeconds),
    rumblePhase = random() * Math.PI * 2;
  for (let index = 0; index < sampleCount; index++) {
    const phase = index / (sampleCount - 1),
      theta = phase * Math.PI * 2;
    const wind = windLow(phase) * 0.4 + windHigh(phase) * 0.6;
    const low = rumble(phase) * 0.65 + Math.sin(theta * rumbleFrequency + rumblePhase) * 0.35;
    const tones =
      Math.sin(theta * frequencies[0] + phases[0]) * 0.6 +
      Math.sin(theta * frequencies[1] + phases[1]) * 0.25 +
      Math.sin(theta * frequencies[2] + phases[2]) * 0.15;
    const value = Math.max(
      -0.95,
      Math.min(
        0.95,
        (wind * settings.wind * 0.75 + low * settings.rumble * 0.6 + tones * settings.tones * 0.5) *
          0.5,
      ),
    );
    view.setInt16(44 + index * 2, Math.round(value * 32767), true);
  }
  // Remove floating point phase-rounding differences at the cyclic endpoint.
  view.setInt16(output.length - 2, view.getInt16(44, true), true);
  return output;
}

export async function generateEnvironmentAssets(body: Planet): Promise<GeneratedAsset[]> {
  if (body.kind !== "rocky" || !body.environmentAudio.enabled) return [];
  return [
    {
      path: environmentAssetPath(body),
      data: generateEnvironmentWav(body.environmentAudio),
      mimeType: "audio/wav",
    },
  ];
}

export function environmentSoundXml(project: Project, body: Planet, indent: string): string[] {
  if (body.kind !== "rocky" || !body.environmentAudio.enabled) return [];
  return [`${indent}<EnvironmentSound Id="${soundId(project, body)}" />`];
}

export function environmentAssetsXml(project: Project, body: Planet): string[] {
  if (body.kind !== "rocky" || !body.environmentAudio.enabled) return [];
  const id = soundId(project, body),
    volume = body.environmentAudio.volume;
  if (!Number.isFinite(volume) || volume < 0 || volume > 1)
    throw new Error("Environment volume must be between 0 and 1");
  return [
    `  <SpatialSoundData Id="${id}_Spatial"><VolumeRange Min="1" Max="10000" /></SpatialSoundData>`,
    `  <Sound Id="${id}" ChannelId="Sfx" Priority="125" SimSpeed="OnlyLower">`,
    `    <SoundFile Id="${id}_File" Path="${environmentAssetPath(body)}" TwoD="true" Volume="${Number(volume.toPrecision(12))}"><Loop /></SoundFile>`,
    `    <SpatialSoundData Id="${id}_Spatial" />`,
    `    <FadeIn Time="0.5" />`,
    `    <FadeOut Time="0.5" />`,
    `  </Sound>`,
  ];
}
