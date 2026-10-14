import { EnvironmentInspector } from "./EnvironmentInspector";
import { nativeAtmosphereHeightKm, physicalScaleHeightKm } from "../lib/atmosphere";
import { SurfaceLibraryInspector } from "./SurfaceLibraryInspector";
import { CloudInspector } from "./CloudInspector";
import { Plus, RotateCw, Trash2 } from "lucide-react";
import { ColorField, Field, Section, Select, Slider, Toggle } from "./Controls";
import type { Celestial, Planet, StarSystem, Vec3 } from "../lib/types";
import { isPlanet } from "../lib/types";
import { descendants } from "../lib/project";
export type InspectorTab =
  | "physical"
  | "surface"
  | "atmosphere"
  | "ocean"
  | "rings"
  | "biomes"
  | "clutter"
  | "sites";
type Props = {
  body: Celestial;
  system: StarSystem;
  tab: InspectorTab;
  update: (fn: (b: Celestial) => void) => string | undefined;
  onHome: () => void;
  onIdChange: (id: string) => void;
  placingSiteId?: string | null;
  onPlaceSite?: (id: string | null) => void;
  onSelectClutter?: (id: string | null) => void;
  clutterPreview?: "asset" | "scatter" | "library";
  onClutterPreview?: (mode: "asset" | "scatter" | "library") => void;
  clutterPatch?: { sizeM: number; latitude: number; longitude: number };
  onClutterPatch?: (patch: { sizeM: number; latitude: number; longitude: number }) => void;
  onShowClutter?: () => void;
};
export function Inspector({
  body: b,
  system,
  tab,
  update,
  onHome,
  onIdChange,
  placingSiteId,
  onPlaceSite,
  onSelectClutter,
  clutterPreview,
  onClutterPreview,
  clutterPatch,
  onClutterPatch,
  onShowClutter,
}: Props) {
  const change = (fn: (p: Planet) => void) =>
    update((b) => {
      if (isPlanet(b)) fn(b);
    });
  const orbitField = (key: keyof Celestial["orbit"], value: number | boolean | string) =>
    update((b) => {
      Object.assign(b.orbit, { [key]: value });
    });
  if ((tab === "biomes" || tab === "clutter" || tab === "sites") && b.kind === "rocky")
    return (
      <SurfaceLibraryInspector
        key={`${b.id}_${tab}`}
        body={b}
        tab={tab}
        change={change}
        placingSiteId={placingSiteId}
        onPlaceSite={onPlaceSite}
        onSelectClutter={onSelectClutter}
        clutterPreview={clutterPreview}
        onClutterPreview={onClutterPreview}
        clutterPatch={clutterPatch}
        onClutterPatch={onClutterPatch}
        onShowClutter={onShowClutter}
      />
    );
  if (tab === "surface" && isPlanet(b))
    return (
      <>
        <Section
          title="Procedural surface"
          description="Seamless 3D noise. The same seeded field powers the preview and exported cubemaps."
        >
          <div className="seed-row">
            <Field
              label="Surface seed"
              value={b.surface.seed}
              onChange={(v) => change((p) => (p.surface.seed = v))}
              min={0}
            />
            <button
              title="Randomize surface seed"
              aria-label="Randomize surface seed"
              onClick={() => change((p) => (p.surface.seed = Math.floor(Math.random() * 1000000)))}
            >
              <RotateCw size={15} />
            </button>
          </div>
          <Slider
            label="Feature scale"
            value={b.surface.scale}
            min={0.2}
            max={16}
            step={0.1}
            onChange={(v) => change((p) => (p.surface.scale = v))}
          />
          <Slider
            label="Octaves"
            value={b.surface.octaves}
            min={1}
            max={8}
            step={1}
            onChange={(v) => change((p) => (p.surface.octaves = v))}
          />
          <Slider
            label="Persistence"
            value={b.surface.persistence}
            min={0.1}
            max={0.9}
            onChange={(v) => change((p) => (p.surface.persistence = v))}
          />
          <Slider
            label="Lacunarity"
            value={b.surface.lacunarity}
            min={1.1}
            max={4}
            step={0.05}
            onChange={(v) => change((p) => (p.surface.lacunarity = v))}
          />
          <Slider
            label="Domain warp"
            value={b.surface.warp}
            min={0}
            max={3}
            onChange={(v) => change((p) => (p.surface.warp = v))}
          />
          {b.kind === "rocky" ? (
            <>
              <Field
                label="Relief"
                value={b.surface.elevation}
                min={0}
                max={200}
                step={0.1}
                unit="km"
                onChange={(v) => change((p) => (p.surface.elevation = v))}
              />
              <Slider
                label="Lowland level"
                value={b.surface.seaLevel}
                onChange={(v) => change((p) => (p.surface.seaLevel = v))}
              />
              <Slider
                label="Crater coverage"
                value={b.surface.craterDensity}
                onChange={(v) => change((p) => (p.surface.craterDensity = v))}
              />
              <Slider
                label="Crater size"
                value={b.surface.craterSize}
                min={0.01}
                max={0.3}
                onChange={(v) => change((p) => (p.surface.craterSize = v))}
              />
            </>
          ) : (
            <>
              <Slider
                label="Band frequency"
                value={b.surface.bandFrequency}
                min={2}
                max={50}
                step={1}
                onChange={(v) => change((p) => (p.surface.bandFrequency = v))}
              />
              <Slider
                label="Storm strength"
                value={b.surface.stormStrength}
                min={0}
                max={2}
                onChange={(v) => change((p) => (p.surface.stormStrength = v))}
              />
            </>
          )}
          <Slider
            label="Surface roughness"
            value={b.surface.roughness}
            min={0.1}
            max={1}
            onChange={(v) => change((p) => (p.surface.roughness = v))}
          />
        </Section>
        <Section
          title="Elevation palette"
          description="Map lowlands to highlights with editable color stops."
        >
          <div
            className="gradient-preview"
            style={{
              background: `linear-gradient(90deg,${b.surface.colors.map((s) => `${s.color} ${s.at * 100}%`).join(",")})`,
            }}
          />
          {b.surface.colors.map((stop, i) => (
            <div className="color-stop" key={i}>
              <input
                type="color"
                aria-label={`Palette color ${i + 1}`}
                value={stop.color}
                onChange={(e) => change((p) => (p.surface.colors[i].color = e.target.value))}
              />
              <Field
                label={`Stop ${i + 1}`}
                value={stop.at}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => change((p) => (p.surface.colors[i].at = v))}
              />
              <button
                aria-label={`Remove color stop ${i + 1}`}
                disabled={b.surface.colors.length <= 2}
                onClick={() => change((p) => p.surface.colors.splice(i, 1))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            className="subtle full"
            onClick={() => change((p) => p.surface.colors.push({ at: 0.5, color: "#9b987b" }))}
          >
            <Plus size={14} /> Add color stop
          </button>
        </Section>
        <Section
          title="Material occurrences"
          description="Place color deposits with noise, height, and latitude masks. Baked into the exported surface."
        >
          {b.surface.occurrences.map((o, i) => (
            <div className="occurrence" key={o.id}>
              <div className="occurrence-title">
                <input
                  aria-label={`Occurrence ${i + 1} name`}
                  value={o.name}
                  onChange={(e) => change((p) => (p.surface.occurrences[i].name = e.target.value))}
                />
                <button
                  aria-label={`Remove ${o.name}`}
                  onClick={() => change((p) => p.surface.occurrences.splice(i, 1))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <ColorField
                label={`${o.name} color`}
                value={o.color}
                onChange={(v) => change((p) => (p.surface.occurrences[i].color = v))}
              />
              <Slider
                label={`${o.name} coverage`}
                value={o.coverage}
                onChange={(v) => change((p) => (p.surface.occurrences[i].coverage = v))}
              />
              <Slider
                label={`${o.name} scale`}
                value={o.scale}
                min={0.5}
                max={20}
                step={0.1}
                onChange={(v) => change((p) => (p.surface.occurrences[i].scale = v))}
              />
              <div className="two-col">
                <Field
                  label="Min height"
                  value={o.minHeight}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => change((p) => (p.surface.occurrences[i].minHeight = v))}
                />
                <Field
                  label="Max height"
                  value={o.maxHeight}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => change((p) => (p.surface.occurrences[i].maxHeight = v))}
                />
                <Field
                  label="Min latitude"
                  value={o.minLatitude}
                  min={-90}
                  max={90}
                  unit="°"
                  onChange={(v) => change((p) => (p.surface.occurrences[i].minLatitude = v))}
                />
                <Field
                  label="Max latitude"
                  value={o.maxLatitude}
                  min={-90}
                  max={90}
                  unit="°"
                  onChange={(v) => change((p) => (p.surface.occurrences[i].maxLatitude = v))}
                />
              </div>
            </div>
          ))}
          <button
            className="subtle full"
            onClick={() =>
              change((p) =>
                p.surface.occurrences.push({
                  id: "Occurrence_" + crypto.randomUUID().replaceAll("-", ""),
                  name: "Mineral deposit",
                  color: "#ce9276",
                  coverage: 0.35,
                  scale: 5,
                  minHeight: 0,
                  maxHeight: 1,
                  minLatitude: -90,
                  maxLatitude: 90,
                }),
              )
            }
          >
            <Plus size={14} /> Add occurrence
          </button>
        </Section>
      </>
    );
  if (tab === "ocean" && b.kind === "rocky")
    return (
      <>
        <Section
          title="Ocean"
          description="A native water surface over procedural terrain, with its own color, level, and waves."
        >
          <Toggle
            label="Enable ocean"
            value={b.ocean.enabled}
            onChange={(v) => change((p) => (p.ocean.enabled = v))}
          />
          <p className="small-note">
            The exported collection needs at least one enabled ocean for the current KSA build to
            start. An ocean can exist on a rocky world with or without an atmosphere.
          </p>
          {b.ocean.enabled && (
            <>
              <Field
                label="Ocean level"
                value={b.ocean.levelKm}
                unit="km"
                step={0.1}
                min={-b.radiusKm + 0.001}
                onChange={(v) => change((p) => (p.ocean.levelKm = v))}
              />
              <p className="small-note">
                Height relative to mean radius. Zero places water at the terrain’s height datum; use
                Surface relief and Lowland level to shape the coastline.
              </p>
              <ColorField
                label="Ocean color"
                value={b.ocean.color}
                onChange={(v) => change((p) => (p.ocean.color = v))}
              />
              <Field
                label="Transparency depth"
                value={b.ocean.transparencyDepthM}
                unit="m"
                min={0.01}
                step={1}
                onChange={(v) => change((p) => (p.ocean.transparencyDepthM = v))}
              />
              <p className="small-note">
                The preview approximates water color and depth. Native wave motion and optics may
                differ. Density uses KSA’s default 1,028.13 kg/m³ because this game build does not
                load custom ocean density correctly.
              </p>
            </>
          )}
        </Section>
        {b.ocean.enabled && (
          <>
            <Section
              title="Wind waves"
              description="Native wind-driven waves and foam. Without a wind map, maximum speed and fetch apply uniformly; minimums are retained in XML for future wind-map authoring."
            >
              {(
                [
                  ["minWindSpeed", "Minimum wind speed", "m/s"],
                  ["maxWindSpeed", "Maximum wind speed", "m/s"],
                  ["minWindFetchKm", "Minimum wind fetch", "km"],
                  ["maxWindFetchKm", "Maximum wind fetch", "km"],
                  ["depthM", "Wave depth", "m"],
                ] as const
              ).map(([key, label, unit]) => (
                <Field
                  key={key}
                  label={label}
                  value={b.ocean.windWaves[key]}
                  unit={unit}
                  min={0.01}
                  step={0.1}
                  onChange={(v) => change((p) => (p.ocean.windWaves[key] = v))}
                />
              ))}
              <Slider
                label="Wave directionality"
                value={b.ocean.windWaves.directionality}
                onChange={(v) => change((p) => (p.ocean.windWaves.directionality = v))}
              />
              <Slider
                label="Foam amount"
                value={b.ocean.windWaves.foamAmount}
                onChange={(v) => change((p) => (p.ocean.windWaves.foamAmount = v))}
              />
            </Section>
            <Section
              title="Gerstner waves"
              description="Larger geometric waves. Set count to zero for wind waves only."
            >
              <Field
                label="Wave count"
                value={b.ocean.gerstnerWaves.count}
                min={0}
                max={64}
                onChange={(v) => change((p) => (p.ocean.gerstnerWaves.count = v))}
              />
              <Field
                label="Wave length"
                value={b.ocean.gerstnerWaves.lengthM}
                min={0.01}
                unit="m"
                step={1}
                onChange={(v) => change((p) => (p.ocean.gerstnerWaves.lengthM = v))}
              />
              <Slider
                label="Wave amplitude"
                value={b.ocean.gerstnerWaves.amplitude}
                step={0.001}
                onChange={(v) => change((p) => (p.ocean.gerstnerWaves.amplitude = v))}
              />
              <Field
                label="Wave speed"
                value={b.ocean.gerstnerWaves.speed}
                min={0}
                step={0.1}
                onChange={(v) => change((p) => (p.ocean.gerstnerWaves.speed = v))}
              />
              {(
                [
                  ["lengthPersistence", "Length persistence"],
                  ["amplitudePersistence", "Amplitude persistence"],
                  ["speedPersistence", "Speed persistence"],
                ] as const
              ).map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  value={b.ocean.gerstnerWaves[key]}
                  min={0.001}
                  step={0.005}
                  onChange={(v) => change((p) => (p.ocean.gerstnerWaves[key] = v))}
                />
              ))}
            </Section>
          </>
        )}
      </>
    );
  if (tab === "atmosphere" && isPlanet(b))
    return (
      <>
        <Section
          title="Atmosphere"
          description="Author physical density and visual scattering independently."
        >
          <Toggle
            label="Enable atmosphere"
            value={b.atmosphere.enabled}
            onChange={(v) =>
              change((p) => {
                p.atmosphere.enabled = v;
                if (!v) p.clouds.enabled = false;
              })
            }
          />
          {b.atmosphere.enabled && (
            <>
              <Slider
                label="Scattering strength"
                value={b.atmosphere.intensity}
                min={0.01}
                max={3}
                onChange={(v) => change((p) => (p.atmosphere.intensity = v))}
              />
              <div className="derived">
                <span>Visual boundary</span>
                <strong>{nativeAtmosphereHeightKm(b.atmosphere).toFixed(1)} km</strong>
              </div>
              <div className="derived">
                <span>Physical scale height</span>
                <strong>{physicalScaleHeightKm(b).toFixed(2)} km</strong>
              </div>
              <Field
                label="Sea-level pressure"
                value={b.atmosphere.pressureKpa}
                min={0}
                step={0.001}
                unit="kPa"
                onChange={(v) => change((p) => (p.atmosphere.pressureKpa = v))}
              />
              <Field
                label="Sea-level density"
                value={b.atmosphere.density}
                min={0}
                step={0.001}
                unit="kg/m³"
                onChange={(v) => change((p) => (p.atmosphere.density = v))}
              />
              <Field
                label="Temperature"
                value={b.atmosphere.temperatureK}
                min={1}
                step={0.1}
                unit="K"
                onChange={(v) => change((p) => (p.atmosphere.temperatureK = v))}
              />
              <Field
                label="Molar mass"
                value={b.atmosphere.molarMass}
                min={0.1}
                step={0.01}
                unit="g/mol"
                onChange={(v) => change((p) => (p.atmosphere.molarMass = v))}
              />
              <p className="small-note">
                Temperature and molar mass derive the physical scale height. The preview and native
                export use the same optical coefficients; the native boundary follows their density
                falloff.
              </p>
            </>
          )}
        </Section>
        {b.atmosphere.enabled && (
          <Section title="Light scattering">
            <Field
              label="Rayleigh scale height"
              value={b.atmosphere.rayleighHeightKm}
              min={0.01}
              step={0.1}
              unit="km"
              onChange={(v) => change((p) => (p.atmosphere.rayleighHeightKm = v))}
            />
            <VectorFields
              label="Rayleigh"
              value={b.atmosphere.rayleigh}
              onChange={(v) => change((p) => (p.atmosphere.rayleigh = v))}
              step={0.000001}
            />
            <Field
              label="Mie scale height"
              value={b.atmosphere.mieHeightKm}
              min={0.01}
              step={0.1}
              unit="km"
              onChange={(v) => change((p) => (p.atmosphere.mieHeightKm = v))}
            />
            <VectorFields
              label="Mie"
              value={b.atmosphere.mie}
              onChange={(v) => change((p) => (p.atmosphere.mie = v))}
              step={0.000001}
            />
            <Slider
              label="Mie anisotropy"
              value={b.atmosphere.mieAnisotropy}
              min={-0.99}
              max={0.99}
              onChange={(v) =>
                change((p) => {
                  p.atmosphere.mieAnisotropy = v;
                  p.atmosphere.mieAnisotropyRgb = [v, v, v];
                })
              }
            />
            <VectorFields
              label="Ozone absorption"
              value={b.atmosphere.absorption}
              onChange={(v) => change((p) => (p.atmosphere.absorption = v))}
              step={0.0000001}
            />
          </Section>
        )}
        {b.atmosphere.enabled && (
          <Section
            title="Atmospheric layers"
            description="Scattering coefficients are authored in km⁻¹. The native atmosphere boundary follows coefficients and scale heights."
          >
            <Field
              label="Atmosphere start height"
              value={b.atmosphere.startHeightKm}
              unit="km"
              step={0.1}
              onChange={(v) => change((p) => (p.atmosphere.startHeightKm = v))}
            />
            <Field
              label="Ozone altitude"
              value={b.atmosphere.ozoneAltitudeKm}
              unit="km"
              step={0.1}
              onChange={(v) => change((p) => (p.atmosphere.ozoneAltitudeKm = v))}
            />
            <Field
              label="Ozone extent"
              value={b.atmosphere.ozoneExtentKm}
              unit="km"
              min={0.001}
              step={0.1}
              onChange={(v) => change((p) => (p.atmosphere.ozoneExtentKm = v))}
            />
            <Field
              label="Mie absorption multiplier"
              value={b.atmosphere.mieAbsorptionMultiplier}
              min={0}
              step={0.01}
              onChange={(v) => change((p) => (p.atmosphere.mieAbsorptionMultiplier = v))}
            />
            <VectorFields
              label="Mie asymmetry RGB"
              value={b.atmosphere.mieAnisotropyRgb}
              step={0.01}
              onChange={(v) => change((p) => (p.atmosphere.mieAnisotropyRgb = v))}
            />
          </Section>
        )}
        {b.atmosphere.enabled && (
          <CloudInspector
            value={b.clouds}
            kind={b.kind}
            onChange={(value) => change((p) => (p.clouds = value))}
          />
        )}
        {b.kind === "rocky" && <EnvironmentInspector key={b.id} body={b} change={change} />}
      </>
    );
  if (tab === "rings" && isPlanet(b))
    return (
      <Section
        title="Planetary rings"
        description="Generated radial color and control textures, a volume, and original ring rocks."
      >
        <Toggle
          label="Enable rings"
          value={b.rings.enabled}
          onChange={(v) => change((p) => (p.rings.enabled = v))}
        />
        {b.rings.enabled && (
          <>
            <Field
              label="Inner radius"
              value={b.rings.innerRadius}
              min={1.01}
              step={0.05}
              unit="R"
              onChange={(v) => change((p) => (p.rings.innerRadius = v))}
            />
            <Field
              label="Outer radius"
              value={b.rings.outerRadius}
              min={1.02}
              step={0.05}
              unit="R"
              onChange={(v) => change((p) => (p.rings.outerRadius = v))}
            />
            <Field
              label="Ring thickness"
              value={b.rings.thickness}
              min={1}
              step={50}
              unit="m"
              onChange={(v) => change((p) => (p.rings.thickness = v))}
            />
            <Slider
              label="Ring opacity"
              value={b.rings.opacity}
              onChange={(v) => change((p) => (p.rings.opacity = v))}
            />
            <Slider
              label="Radial bands"
              value={b.rings.bands}
              min={5}
              max={250}
              step={1}
              onChange={(v) => change((p) => (p.rings.bands = v))}
            />
            <Field
              label="Ring seed"
              value={b.rings.seed}
              onChange={(v) => change((p) => (p.rings.seed = v))}
            />
            <ColorField
              label="Ring highlights"
              value={b.rings.color}
              onChange={(v) => change((p) => (p.rings.color = v))}
            />
            <ColorField
              label="Ring shadows"
              value={b.rings.secondaryColor}
              onChange={(v) => change((p) => (p.rings.secondaryColor = v))}
            />
          </>
        )}
      </Section>
    );
  return (
    <>
      <Section title="Identity">
        <label className="field">
          <span>Name</span>
          <input
            aria-label="Body name"
            value={b.name}
            onChange={(e) => update((p) => (p.name = e.target.value))}
          />
        </label>
        <label className="field">
          <span>Identifier</span>
          <input
            aria-label="Body identifier"
            value={b.id}
            onChange={(e) => onIdChange(e.target.value)}
            title="Native KSA body identifier; child links update with it."
          />
        </label>
        {b.kind !== "barycenter" && (
          <Select
            label="Parent"
            value={b.parentId ?? ""}
            options={[
              ...(b.kind === "star" ? [{ value: "", label: "System root" }] : []),
              ...system.bodies
                .filter((p) => !descendants(b.id, system.bodies).includes(p.id))
                .map((p) => ({ value: p.id, label: p.name })),
            ]}
            onChange={(v) => update((p) => (p.parentId = v || null))}
          />
        )}
        <div className="tag-row">
          <span className="tag">
            {b.kind === "rocky"
              ? "Rocky world"
              : b.kind === "gas"
                ? "Gas giant"
                : b.kind === "star"
                  ? "Stellar body"
                  : "Barycenter"}
          </span>
          {isPlanet(b) && b.homeBody && <span className="tag warm">Home world</span>}
        </div>
      </Section>
      {isPlanet(b) && (
        <Section title="Asset quality">
          <Select
            label="Body texture resolution"
            value={String(b.exportResolution)}
            options={[
              { value: "0", label: "Inherit collection" },
              ...[32, 64, 128, 256, 512].map((n) => ({ value: String(n), label: `${n} × ${n}` })),
            ]}
            onChange={(v) =>
              change((p) => (p.exportResolution = Number(v) as Planet["exportResolution"]))
            }
          />
        </Section>
      )}
      {b.kind !== "barycenter" && (
        <Section title={b.kind === "star" ? "Stellar properties" : "Physical properties"}>
          <Field
            label="Mean radius"
            value={b.radiusKm}
            min={0.1}
            step={0.1}
            unit="km"
            onChange={(v) =>
              update((p) => {
                if (p.kind !== "barycenter") p.radiusKm = v;
              })
            }
          />
          <Field
            label="Mass"
            value={b.kind === "star" ? b.massSuns : b.massEarths}
            min={0.000001}
            step={0.01}
            unit={b.kind === "star" ? "M☉" : "M⊕"}
            onChange={(v) =>
              update((p) => {
                if (p.kind === "star") p.massSuns = v;
                else if (isPlanet(p)) p.massEarths = v;
              })
            }
          />
          <Field
            label="Sphere of influence"
            value={b.sphereOfInfluenceAu}
            min={0}
            step={0.01}
            unit="AU"
            hint="Zero lets KSA derive the value."
            onChange={(v) =>
              update((p) => {
                if (p.kind !== "barycenter") p.sphereOfInfluenceAu = v;
              })
            }
          />
          {isPlanet(b) && (
            <>
              <div className="derived">
                <span>Surface gravity</span>
                <strong>
                  {((6.6743e-11 * b.massEarths * 5.9722e24) / (b.radiusKm * 1000) ** 2).toFixed(2)}{" "}
                  m/s²
                </strong>
              </div>
              <Toggle
                label="Home world"
                description="The starting body for this exported collection."
                value={b.homeBody}
                onChange={onHome}
              />
            </>
          )}
          {b.kind === "star" && (
            <>
              <ColorField
                label="Stellar color"
                value={b.color}
                onChange={(v) =>
                  update((p) => {
                    if (p.kind === "star") p.color = v;
                  })
                }
              />
              <VectorFields
                label="Sunlight"
                value={b.sunlight}
                onChange={(v) =>
                  update((p) => {
                    if (p.kind === "star") p.sunlight = v;
                  })
                }
                step={0.1}
              />
              <p className="small-note">Sunlight is KSA’s RGB radiance, and may exceed 1.</p>
            </>
          )}
        </Section>
      )}
      {b.parentId && (
        <Section
          title="Orbit"
          description="Distances use AU; angles use degrees. System preview compresses orbital spacing."
        >
          <Field
            label="Semi-major axis"
            value={b.orbit.semiMajorAxisAu}
            min={0.000001}
            step={0.001}
            unit="AU"
            onChange={(v) => orbitField("semiMajorAxisAu", v)}
          />
          <Field
            label="Eccentricity"
            value={b.orbit.eccentricity}
            min={0}
            max={0.99}
            step={0.001}
            onChange={(v) => orbitField("eccentricity", v)}
          />
          <Field
            label="Inclination"
            value={b.orbit.inclination}
            step={0.1}
            unit="°"
            onChange={(v) => orbitField("inclination", v)}
          />
          <Field
            label="Ascending node"
            value={b.orbit.ascendingNode}
            step={0.1}
            unit="°"
            onChange={(v) => orbitField("ascendingNode", v)}
          />
          <Field
            label="Argument of periapsis"
            value={b.orbit.argumentOfPeriapsis}
            step={0.1}
            unit="°"
            onChange={(v) => orbitField("argumentOfPeriapsis", v)}
          />
          <Field
            label="Time at periapsis"
            value={b.orbit.timeAtPeriapsisDays}
            unit="days"
            onChange={(v) => orbitField("timeAtPeriapsisDays", v)}
          />
          <Select
            label="Orbit frame"
            value={b.orbit.definitionFrame}
            options={["Ecliptic", "Equatorial"].map((value) => ({ value, label: value }))}
            onChange={(v) => orbitField("definitionFrame", v)}
          />
          <Toggle
            label="Two-body orbit"
            value={b.orbit.twoBody}
            onChange={(v) => orbitField("twoBody", v)}
          />
          {b.kind === "star" && (
            <Toggle
              label="Barycentric orbit"
              value={b.orbit.barycentric}
              onChange={(v) => orbitField("barycentric", v)}
            />
          )}
          <Field
            label="Central mass override"
            value={b.orbit.centralMassSuns}
            min={0}
            step={0.001}
            unit="M☉"
            onChange={(v) => orbitField("centralMassSuns", v)}
          />
        </Section>
      )}
      {isPlanet(b) && (
        <Section title="Rotation">
          <Field
            label="Sidereal period"
            value={b.rotation.periodHours}
            min={0.001}
            step={0.1}
            unit="h"
            onChange={(v) => change((p) => (p.rotation.periodHours = v))}
          />
          <Field
            label="Axial tilt"
            value={b.rotation.tilt}
            unit="°"
            step={0.1}
            onChange={(v) => change((p) => (p.rotation.tilt = v))}
          />
          <Field
            label="Axis azimuth"
            value={b.rotation.azimuth}
            unit="°"
            step={0.1}
            onChange={(v) => change((p) => (p.rotation.azimuth = v))}
          />
          <Field
            label="Initial longitude"
            value={b.rotation.initialLongitude}
            unit="°"
            step={0.1}
            onChange={(v) => change((p) => (p.rotation.initialLongitude = v))}
          />
          <Select
            label="Rotation frame"
            value={b.rotation.definitionFrame}
            options={["Perifocal", "Ecliptic", "Equatorial"].map((value) => ({
              value,
              label: value,
            }))}
            onChange={(v) =>
              change(
                (p) => (p.rotation.definitionFrame = v as Planet["rotation"]["definitionFrame"]),
              )
            }
          />
          <Toggle
            label="Tidally locked"
            value={b.rotation.tidallyLocked}
            onChange={(v) => change((p) => (p.rotation.tidallyLocked = v))}
          />
          <Toggle
            label="Retrograde rotation"
            value={b.rotation.retrograde}
            onChange={(v) => change((p) => (p.rotation.retrograde = v))}
          />
        </Section>
      )}
      {!b.parentId && (
        <Section
          title="Interstellar position"
          description="Root position is this local offset plus the system’s ecliptic coordinates in Collection settings."
        >
          {(b.kind === "star" || b.kind === "barycenter") &&
            b.position.map((v, i) => (
              <Field
                key={i}
                label={`Position offset ${["X", "Y", "Z"][i]}`}
                value={v}
                unit="ly"
                step={0.001}
                onChange={(n) =>
                  update((p) => {
                    if (p.kind === "star" || p.kind === "barycenter") p.position[i] = n;
                  })
                }
              />
            ))}
          <div className="derived">
            <span>Distance from origin</span>
            <strong>{Math.hypot(...system.position).toFixed(3)} ly</strong>
          </div>
        </Section>
      )}
    </>
  );
}
export function VectorFields({
  label,
  value,
  onChange,
  step = 0.01,
}: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
  step?: number;
}) {
  return (
    <div className="vector-fields">
      <span>{label}</span>
      <div>
        {value.map((v, i) => (
          <Field
            key={i}
            label={`${label} ${["R", "G", "B"][i]}`}
            value={v}
            step={step}
            onChange={(n) => {
              const next = [...value] as Vec3;
              next[i] = n;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}
