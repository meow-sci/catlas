import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { generateEnvironmentAssets } from "../lib/environment";
import type { Planet } from "../lib/types";
import { Field, Section, Slider, Toggle } from "./Controls";

export function EnvironmentInspector({
  body,
  change,
}: {
  body: Planet;
  change: (fn: (p: Planet) => void) => void;
}) {
  const audio = useRef<{ element: HTMLAudioElement; url: string } | null>(null);
  const mounted = useRef(true);
  const [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const stop = () => {
    if (audio.current) {
      audio.current.element.pause();
      URL.revokeObjectURL(audio.current.url);
      audio.current = null;
    }
    setPlaying(false);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (audio.current) {
        audio.current.element.pause();
        URL.revokeObjectURL(audio.current.url);
        audio.current = null;
      }
    };
  }, []);
  const play = async () => {
    if (playing) {
      stop();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const preview = structuredClone(body);
      preview.environmentAudio.enabled = true;
      const assets = await generateEnvironmentAssets(preview);
      if (!mounted.current) return;
      const wav = assets.find((a) => a.path.endsWith(".wav"));
      if (!wav) throw new Error("No audio could be generated.");
      const url = URL.createObjectURL(new Blob([Uint8Array.from(wav.data)], { type: "audio/wav" }));
      const element = new Audio(url);
      element.loop = true;
      element.volume = body.environmentAudio.volume;
      audio.current = { element, url };
      await element.play();
      setPlaying(true);
    } catch (error) {
      stop();
      setError(error instanceof Error ? error.message : "Audio preview failed.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const a = body.environmentAudio;
  return (
    <Section
      title="Environment ambience"
      description="Generate an original looping wind, low rumble and tonal soundscape. Native playback fades with camera pressure and altitude; it requires this rocky world's biome maps."
    >
      <Toggle
        label="Environment audio"
        value={a.enabled}
        onChange={(v) => {
          stop();
          change((p) => (p.environmentAudio.enabled = v));
        }}
      />
      {a.enabled && (
        <>
          <Field
            label="Audio seed"
            value={a.seed}
            onChange={(v) => {
              stop();
              change((p) => (p.environmentAudio.seed = v));
            }}
          />
          {(
            [
              ["volume", "Ambience volume"],
              ["wind", "Wind texture"],
              ["rumble", "Low rumble"],
              ["tones", "Harmonic tones"],
            ] as const
          ).map(([key, label]) => (
            <Slider
              key={key}
              label={label}
              value={a[key]}
              onChange={(v) => {
                stop();
                change((p) => (p.environmentAudio[key] = v));
              }}
            />
          ))}
          <Field
            label="Loop duration"
            value={a.loopSeconds}
            unit="s"
            min={4}
            max={30}
            step={1}
            onChange={(v) => {
              stop();
              change((p) => (p.environmentAudio.loopSeconds = v));
            }}
          />
          <button className="subtle full" onClick={() => void play()} disabled={busy}>
            {playing ? <Square size={14} /> : <Play size={14} />}{" "}
            {busy ? "Generating audio…" : playing ? "Stop audio preview" : "Play audio preview"}
          </button>
          <p className="small-note">
            Playback starts only when requested. Airless worlds and camera pressure below 0.01
            atmospheres are silent in KSA.
          </p>
          {error && <p className="small-note">{error}</p>}
        </>
      )}
    </Section>
  );
}
