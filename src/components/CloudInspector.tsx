import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cloudLayer, cloudType, evaluateCloudCurve } from "../lib/atmosphere";
import type {
  CloudLayerSettings,
  CloudSettings,
  CloudTypeSettings,
  SplinePointSettings,
} from "../lib/types";
import { ColorField, Field, Section, Select, Slider, Toggle } from "./Controls";

type Props = {
  value: CloudSettings;
  onChange: (value: CloudSettings) => void;
  kind?: "rocky" | "gas";
};

function CurveEditor({
  label,
  points,
  onChange,
}: {
  label: string;
  points: SplinePointSettings[];
  onChange: (points: SplinePointSettings[]) => void;
}) {
  const path = Array.from({ length: 65 }, (_, i) => {
    const x = i / 64,
      y = Math.max(0, Math.min(1, evaluateCloudCurve(points, x)));
    return `${i ? "L" : "M"}${(x * 260).toFixed(2)},${(60 - y * 58).toFixed(2)}`;
  }).join(" ");
  const change = (i: number, key: keyof SplinePointSettings, value: number) => {
    const next = structuredClone(points);
    next[i][key] = value;
    onChange(next);
  };
  return (
    <details>
      <summary>{label}</summary>
      <svg
        viewBox="0 0 260 62"
        role="img"
        aria-label={`${label} profile`}
        style={{ width: "100%", height: 72 }}
      >
        <path d="M0 60H260M0 0V60" fill="none" stroke="#435369" />
        <path d={path} fill="none" stroke="#e4b785" strokeWidth="2" />
      </svg>
      {points.map((p, i) => (
        <div key={i} style={{ borderTop: "1px solid #283445", paddingTop: 6 }}>
          <Field
            label={`${label} point ${i + 1} height`}
            value={p.key}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => change(i, "key", v)}
          />
          <Field
            label={`${label} point ${i + 1} value`}
            value={p.value}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => change(i, "value", v)}
          />
          <Field
            label={`${label} point ${i + 1} incoming slope`}
            value={p.inTangent}
            step={0.1}
            onChange={(v) => change(i, "inTangent", v)}
          />
          <Field
            label={`${label} point ${i + 1} outgoing slope`}
            value={p.outTangent}
            step={0.1}
            onChange={(v) => change(i, "outTangent", v)}
          />
          <button
            className="subtle full"
            disabled={points.length <= 2}
            aria-label={`Remove ${label} point ${i + 1}`}
            onClick={() => onChange(points.filter((_, at) => at !== i))}
          >
            <Trash2 size={13} /> Remove point
          </button>
        </div>
      ))}
      <button
        className="subtle full"
        disabled={points.length >= 16}
        onClick={() => {
          const sorted = [...points].sort((a, b) => a.key - b.key);
          let largest = -1,
            key = 0.5;
          for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i].key - sorted[i - 1].key;
            if (gap > largest) {
              largest = gap;
              key = (sorted[i].key + sorted[i - 1].key) / 2;
            }
          }
          onChange(
            [
              ...points,
              { key, value: evaluateCloudCurve(points, key), inTangent: 0, outTangent: 0 },
            ].sort((a, b) => a.key - b.key),
          );
        }}
      >
        <Plus size={13} /> Add curve point
      </button>
    </details>
  );
}

export function CloudInspector({ value, onChange, kind = "rocky" }: Props) {
  const [selectedId, setSelectedId] = useState(value.layers[0]?.id ?? "");
  const [selectedType, setSelectedType] = useState(0);
  const index = Math.max(
    0,
    value.layers.findIndex((l) => l.id === selectedId),
  );
  const layer = value.layers[index];
  const typeIndex = layer ? Math.min(selectedType, layer.types.length - 1) : 0;
  const type = layer?.types[typeIndex];
  const change = (fn: (value: CloudSettings) => void) => {
    const next = structuredClone(value);
    fn(next);
    onChange(next);
  };
  const changeLayer = (fn: (layer: CloudLayerSettings) => void) =>
    change((c) => fn(c.layers[index]));
  const changeType = (fn: (type: CloudTypeSettings) => void) =>
    changeLayer((l) => fn(l.types[typeIndex]));
  return (
    <>
      <Section
        title="Cloud layers"
        description="Author separate weather decks, cloud profiles, and flowing jets. The same seeded weather field generates the preview and cloud textures."
      >
        <Toggle
          label="Clouds enabled"
          value={value.enabled}
          onChange={(v) => change((c) => (c.enabled = v))}
          description="Requires an enabled atmosphere."
        />
        <Select
          label="Weather deck"
          value={layer?.id ?? ""}
          options={value.layers.map((l) => ({ value: l.id, label: l.name }))}
          onChange={(v) => {
            setSelectedId(v);
            setSelectedType(0);
          }}
        />
        <div className="seed-row">
          <button
            className="subtle full"
            disabled={value.layers.length >= 8}
            onClick={() => {
              let n = value.layers.length + 1;
              while (value.layers.some((l) => l.id === `deck_${n}`)) n++;
              const added = cloudLayer(kind, (layer?.seed ?? 1) + n * 137, `deck_${n}`);
              added.name = `Weather deck ${n}`;
              change((c) => c.layers.push(added));
              setSelectedId(added.id);
              setSelectedType(0);
            }}
          >
            <Plus size={14} /> Add weather deck
          </button>
          <button
            aria-label="Remove weather deck"
            disabled={!layer || value.layers.length <= 1}
            onClick={() => {
              change((c) => c.layers.splice(index, 1));
              setSelectedType(0);
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
        {layer && (
          <>
            <label className="field">
              <span>Deck name</span>
              <input
                aria-label="Deck name"
                value={layer.name}
                onChange={(e) => changeLayer((l) => (l.name = e.target.value))}
              />
            </label>
            <Toggle
              label="Deck enabled"
              value={layer.enabled}
              onChange={(v) => changeLayer((l) => (l.enabled = v))}
            />
            <Field
              label="Cloud seed"
              value={layer.seed}
              min={0}
              onChange={(v) => changeLayer((l) => (l.seed = v))}
            />
            <Select
              label="Cloud pattern"
              value={layer.pattern}
              options={[
                { value: "billowed", label: "Billowed" },
                { value: "wispy", label: "Wispy cirrus" },
                { value: "banded", label: "Banded jets" },
              ]}
              onChange={(v) => changeLayer((l) => (l.pattern = v as CloudLayerSettings["pattern"]))}
            />
            <Slider
              label="Cloud coverage"
              value={layer.coverage}
              onChange={(v) => changeLayer((l) => (l.coverage = v))}
            />
            <Slider
              label="Cloud feature scale"
              value={layer.scale}
              min={0.25}
              max={32}
              step={0.25}
              onChange={(v) => changeLayer((l) => (l.scale = v))}
            />
            <Slider
              label="Cloud contrast"
              value={layer.contrast}
              min={0.1}
              max={4}
              step={0.05}
              onChange={(v) => changeLayer((l) => (l.contrast = v))}
            />
            <Slider
              label="Cloud opacity"
              value={layer.opacity}
              onChange={(v) => changeLayer((l) => (l.opacity = v))}
            />
            <ColorField
              label="Cloud tint"
              value={layer.color}
              onChange={(v) => changeLayer((l) => (l.color = v))}
            />
            <Slider
              label="Cloud Lambertian lighting"
              value={layer.lambertian}
              onChange={(v) => changeLayer((l) => (l.lambertian = v))}
            />
            <Toggle
              label="Use alpha only"
              value={layer.useAlphaOnly}
              onChange={(v) => changeLayer((l) => (l.useAlphaOnly = v))}
              description="Show the cloud tint instead of the generated color field."
            />
            <Toggle
              label="Match ground color"
              value={layer.matchGroundColor}
              onChange={(v) => changeLayer((l) => (l.matchGroundColor = v))}
            />
            <Field
              label="Cloud detail tile size"
              value={layer.detailSizeKm}
              min={0.001}
              step={1}
              unit="km"
              onChange={(v) => changeLayer((l) => (l.detailSizeKm = v))}
            />
            <Field
              label="Noise scroll speed"
              value={layer.noiseScrollSpeed}
              step={0.1}
              unit="m/s"
              onChange={(v) => changeLayer((l) => (l.noiseScrollSpeed = v))}
            />
          </>
        )}
      </Section>
      {layer && (
        <Section
          title="Cloud motion"
          description="Flow maps move zonal jets and local eddies. The rotation vector describes linear motion around each body axis."
        >
          <Toggle
            label="Cloud flow enabled"
            value={layer.flow.enabled}
            onChange={(v) => changeLayer((l) => (l.flow.enabled = v))}
          />
          <Slider
            label="Jet and eddy strength"
            value={layer.flow.strength}
            onChange={(v) => changeLayer((l) => (l.flow.strength = v))}
          />
          <Field
            label="Flow displacement"
            value={layer.flow.displacementKm}
            min={0}
            step={1}
            unit="km"
            onChange={(v) => changeLayer((l) => (l.flow.displacementKm = v))}
          />
          <Field
            label="Flow loop duration"
            value={layer.flow.loopHours}
            min={0.001}
            step={0.1}
            unit="h"
            onChange={(v) => changeLayer((l) => (l.flow.loopHours = v))}
          />
          {layer.rotationSpeed.map((v, i) => (
            <Field
              key={i}
              label={`Cloud rotation ${"XYZ"[i]}`}
              value={v}
              step={1}
              unit="m/s"
              onChange={(v) => changeLayer((l) => (l.rotationSpeed[i] = v))}
            />
          ))}
        </Section>
      )}
      {layer && type && (
        <Section
          title="Cloud column profiles"
          description="The weather map blends through every profile. Height and density curves define the vertical shape of each cloud column."
        >
          <Select
            label="Cloud type"
            value={String(typeIndex)}
            options={layer.types.map((t, i) => ({ value: String(i), label: t.name }))}
            onChange={(v) => setSelectedType(Number(v))}
          />
          <div className="seed-row">
            <button
              className="subtle full"
              disabled={layer.types.length >= 8}
              onClick={() => {
                const added = cloudType(kind, true);
                added.name = `Cloud type ${layer.types.length + 1}`;
                changeLayer((l) => l.types.push(added));
                setSelectedType(layer.types.length);
              }}
            >
              <Plus size={14} /> Add cloud type
            </button>
            <button
              aria-label="Remove cloud type"
              disabled={layer.types.length <= 1}
              onClick={() => {
                changeLayer((l) => l.types.splice(typeIndex, 1));
                setSelectedType(0);
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <label className="field">
            <span>Cloud type name</span>
            <input
              aria-label="Cloud type name"
              value={type.name}
              onChange={(e) => changeType((t) => (t.name = e.target.value))}
            />
          </label>
          <Field
            label="Cloud base altitude"
            value={type.startAltitudeKm}
            step={0.1}
            unit="km"
            onChange={(v) => changeType((t) => (t.startAltitudeKm = v))}
          />
          <Field
            label="Cloud column height"
            value={type.heightKm}
            min={0.001}
            step={0.1}
            unit="km"
            onChange={(v) => changeType((t) => (t.heightKm = v))}
          />
          <Field
            label="Cloud optical density"
            value={type.density}
            min={0}
            step={0.0001}
            unit="m⁻¹"
            onChange={(v) => changeType((t) => (t.density = v))}
          />
          <Field
            label="Cloud noise scale"
            value={type.noiseScaleKm}
            min={0.001}
            step={0.1}
            unit="km"
            onChange={(v) => changeType((t) => (t.noiseScaleKm = v))}
          />
          <Slider
            label="Cloud edge sharpness"
            value={type.edgeSharpness}
            onChange={(v) => changeType((t) => (t.edgeSharpness = v))}
          />
          <Field
            label="Multiple scattering brightness"
            value={type.multipleScatteringBrightness}
            min={0}
            step={0.1}
            onChange={(v) => changeType((t) => (t.multipleScatteringBrightness = v))}
          />
          <Toggle
            label="Interpolate cloud shapes"
            value={type.interpolateShapes}
            onChange={(v) => changeType((t) => (t.interpolateShapes = v))}
          />
          <CurveEditor
            label="Cloud shape"
            points={type.shapeCurve}
            onChange={(v) => changeType((t) => (t.shapeCurve = v))}
          />
          <CurveEditor
            label="Cloud density"
            points={type.densityCurve}
            onChange={(v) => changeType((t) => (t.densityCurve = v))}
          />
        </Section>
      )}
      <Section title="Cloud rendering distances">
        <Field
          label="Orbit transition start"
          value={value.orbitTransitionStartKm}
          min={0}
          unit="km"
          onChange={(v) => change((c) => (c.orbitTransitionStartKm = v))}
        />
        <Field
          label="Orbit transition end"
          value={value.orbitTransitionEndKm}
          min={0}
          unit="km"
          onChange={(v) => change((c) => (c.orbitTransitionEndKm = v))}
        />
        <Field
          label="Cloud shadow maximum altitude"
          value={value.maxShadowsAltitudeKm}
          min={0}
          unit="km"
          onChange={(v) => change((c) => (c.maxShadowsAltitudeKm = v))}
        />
        <Field
          label="Volumetric flicker reduction"
          value={value.flickerReductionKm}
          min={0}
          unit="km"
          onChange={(v) => change((c) => (c.flickerReductionKm = v))}
        />
        {layer && (
          <details>
            <summary>Raymarching quality</summary>
            <Field
              label="Raymarch step scale"
              value={layer.raymarching.stepScale}
              min={0.00001}
              step={0.0001}
              onChange={(v) => changeLayer((l) => (l.raymarching.stepScale = v))}
            />
            <Field
              label="Raymarch minimum step"
              value={layer.raymarching.stepSizeKm}
              min={0.0001}
              step={0.1}
              unit="km"
              onChange={(v) => changeLayer((l) => (l.raymarching.stepSizeKm = v))}
            />
            <Field
              label="Raymarch maximum step"
              value={layer.raymarching.maxStepSizeKm}
              min={0.0001}
              step={0.1}
              unit="km"
              onChange={(v) => changeLayer((l) => (l.raymarching.maxStepSizeKm = v))}
            />
            <Field
              label="Cloud light march distance"
              value={layer.raymarching.lightDistanceKm}
              min={0.0001}
              step={0.1}
              unit="km"
              onChange={(v) => changeLayer((l) => (l.raymarching.lightDistanceKm = v))}
            />
            <Field
              label="Cloud light samples"
              value={layer.raymarching.lightSamples}
              min={1}
              max={64}
              step={1}
              onChange={(v) => changeLayer((l) => (l.raymarching.lightSamples = v))}
            />
          </details>
        )}
      </Section>
    </>
  );
}
