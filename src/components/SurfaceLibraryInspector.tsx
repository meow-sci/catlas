import { useEffect, useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { ColorField, Field, Section, Select, Slider, Toggle } from "./Controls";
import { defaultBiome, defaultClutter } from "../lib/surface";
import { defaultLandmark } from "../lib/landmarks";
import { stockUsesCutout, STOCK_ASSETS } from "../lib/stock-assets";
import { uniqueId } from "../lib/project";
import { importClutterGlb, IMPORTED_LIMITS } from "../lib/imported-clutter";
import type {
  ClutterType,
  LandmarkSettings,
  Planet,
  TerrainBiome,
  TerrainMaterialSettings,
  Vec3,
} from "../lib/types";

type Props = {
  body: Planet;
  change: (fn: (body: Planet) => void) => string | undefined;
  tab: "biomes" | "clutter" | "sites";
  placingSiteId?: string | null;
  onPlaceSite?: (id: string | null) => void;
  onSelectClutter?: (id: string | null) => void;
  clutterPreview?: "asset" | "scatter" | "library";
  onClutterPreview?: (mode: "asset" | "scatter" | "library") => void;
  clutterPatch?: { sizeM: number; latitude: number; longitude: number };
  onClutterPatch?: (patch: { sizeM: number; latitude: number; longitude: number }) => void;
  onShowClutter?: () => void;
};
const options = (values: string[]) =>
  values.map((value) => ({
    value,
    label: value.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
  }));
const uniqueName = (base: string, names: string[]) => {
  const used = new Set(names.map((name) => name.toLowerCase()));
  let name = base,
    number = 2;
  while (used.has(name.toLowerCase())) name = `${base} ${number++}`;
  return name;
};
function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function Vector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
}) {
  return (
    <div className="vector-fields">
      {value.map((v, i) => (
        <Field
          key={i}
          label={`${label} ${["X", "Y", "Z"][i]}`}
          value={v}
          min={0.001}
          step={0.1}
          onChange={(n) => {
            const next = [...value] as Vec3;
            next[i] = n;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}
function Material({
  title,
  value,
  onChange,
}: {
  title: string;
  value: TerrainMaterialSettings;
  onChange: (f: (m: TerrainMaterialSettings) => void) => void;
}) {
  return (
    <details className="feature-details" open>
      <summary>{title} material</summary>
      <Select
        label={`${title} pattern`}
        value={value.pattern}
        options={options(["regolith", "sand", "basalt", "ice", "soil"])}
        onChange={(v) => onChange((m) => (m.pattern = v as TerrainMaterialSettings["pattern"]))}
      />
      <ColorField
        label={`${title} color`}
        value={value.color}
        onChange={(v) => onChange((m) => (m.color = v))}
      />
      <ColorField
        label={`${title} grain color`}
        value={value.secondaryColor}
        onChange={(v) => onChange((m) => (m.secondaryColor = v))}
      />
      <Field
        label={`${title} seed`}
        value={value.seed}
        onChange={(v) => onChange((m) => (m.seed = v))}
      />
      {(
        [
          ["textureTiling", "Texture tiling", 0.001, 0.01],
          ["roughness", "Roughness", 0, 0.01],
          ["metalness", "Metalness", 0, 0.01],
          ["detailStrength", "Detail relief", 0, 0.1],
          ["diffuseScale", "Diffuse scale", 0, 0.1],
          ["normalScale", "Normal scale", 0, 0.1],
          ["displacementScale", "Displacement scale", 0, 0.1],
        ] as const
      ).map(([key, label, min, step]) => (
        <Field
          key={key}
          label={`${title} ${label.toLowerCase()}`}
          value={value[key]}
          min={min}
          step={step}
          onChange={(v) => onChange((m) => (m[key] = v))}
        />
      ))}
    </details>
  );
}

export function SurfaceLibraryInspector({
  body,
  change,
  tab,
  placingSiteId,
  onPlaceSite,
  onSelectClutter,
  clutterPreview = "asset",
  onClutterPreview,
  clutterPatch,
  onClutterPatch,
  onShowClutter,
}: Props) {
  const [selected, setSelected] = useState(0),
    [importStatus, setImportStatus] = useState(""),
    [importing, setImporting] = useState(false);
  const glbInput = useRef<HTMLInputElement>(null);
  const importGeneration = useRef(0);
  const collection =
    tab === "biomes" ? body.surface.biomes : tab === "clutter" ? body.clutter : body.landmarks;
  const index = Math.min(selected, Math.max(0, collection.length - 1));
  const current = collection[index];
  useEffect(
    () => () => {
      importGeneration.current++;
    },
    [current?.id],
  );
  const importTarget = useRef(current);
  importTarget.current = current;
  useEffect(() => {
    if (tab === "clutter") onSelectClutter?.(current?.id ?? null);
  }, [tab, current?.id, onSelectClutter]);
  const label = tab === "biomes" ? "Biome" : tab === "clutter" ? "Clutter type" : "Site";
  const add = () =>
    change((p) => {
      onPlaceSite?.(null);
      if (tab === "biomes") {
        const id = uniqueId(
          "Biome",
          p.surface.biomes.map((b) => b.id),
        );
        p.surface.biomes.push({
          ...defaultBiome(id, p.surface.seed + p.surface.biomes.length * 67),
          name: `Biome ${p.surface.biomes.length + 1}`,
        });
        setSelected(p.surface.biomes.length - 1);
      } else if (tab === "clutter") {
        const id = uniqueId(
          "Clutter",
          p.clutter.map((c) => c.id),
        );
        p.clutter.push({
          ...defaultClutter(id, p.surface.seed + p.clutter.length * 83),
          name: `Clutter type ${p.clutter.length + 1}`,
        });
        setSelected(p.clutter.length - 1);
      } else {
        const id = uniqueId(
          "LaunchPad",
          p.landmarks.map((s) => s.id),
        );
        p.landmarks.push(
          defaultLandmark(
            id,
            uniqueName(
              "Launch pad",
              p.landmarks.map((s) => s.name),
            ),
          ),
        );
        setSelected(p.landmarks.length - 1);
      }
    });
  const remove = () =>
    change((p) => {
      onPlaceSite?.(null);
      if (tab === "biomes") {
        const id = p.surface.biomes[index].id;
        p.surface.biomes.splice(index, 1);
        for (const c of p.clutter)
          c.distribution.biomeIds = c.distribution.biomeIds.filter((x) => x !== id);
      } else if (tab === "clutter") p.clutter.splice(index, 1);
      else p.landmarks.splice(index, 1);
      setSelected(Math.max(0, index - 1));
    });
  const duplicate = () => {
    let nextSelection = index;
    const error = change((p) => {
      onPlaceSite?.(null);
      const target =
        tab === "biomes" ? p.surface.biomes : tab === "clutter" ? p.clutter : p.landmarks;
      const original = target[index],
        source = tab === "clutter" ? (original as ClutterType).importedAsset : undefined;
      const copy = source
        ? { ...structuredClone({ ...original, importedAsset: undefined }), importedAsset: source }
        : structuredClone(original);
      copy.id = uniqueId(
        copy.id,
        target.map((x) => x.id),
      );
      copy.name = uniqueName(
        `${copy.name} copy`,
        target.map((s) => s.name),
      );
      (target as (TerrainBiome | ClutterType | LandmarkSettings)[]).push(copy);
      nextSelection = target.length - 1;
    });
    if (!error) setSelected(nextSelection);
  };
  return (
    <>
      <Section
        title={
          tab === "biomes"
            ? "Native terrain biomes"
            : tab === "clutter"
              ? "Clutter library"
              : "Landmarks & launch sites"
        }
        description={
          tab === "biomes"
            ? "Each biome exports its own native ID and independently generated ground and slope materials. Height, latitude and patch masks blend their coverage."
            : tab === "clutter"
              ? "Each type has its own original mesh, five native LODs, material maps, and placement distribution."
              : "Native named destinations. Physical launch pads include an original platform, surface height, and box collider."
        }
      >
        {collection.length > 0 && (
          <Select
            label={`Selected ${label.toLowerCase()}`}
            value={String(index)}
            options={collection.map((v, i) => ({ value: String(i), label: v.name || v.id }))}
            onChange={(v) => {
              importGeneration.current++;
              onPlaceSite?.(null);
              setSelected(Number(v));
            }}
          />
        )}
        <div className="library-actions">
          <button className="subtle" onClick={add}>
            <Plus size={14} />
            Add {label.toLowerCase()}
          </button>
          {current && (
            <>
              <button
                className="icon-button"
                title={`Duplicate ${label.toLowerCase()}`}
                aria-label={`Duplicate ${label.toLowerCase()}`}
                onClick={duplicate}
              >
                <Copy size={14} />
              </button>
              <button
                className="icon-button"
                title={`Delete ${label.toLowerCase()}`}
                aria-label={`Delete ${label.toLowerCase()}`}
                disabled={tab === "biomes" && collection.length <= 1}
                onClick={remove}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
        {current && (
          <p className="small-note">
            {collection.length} authored{" "}
            {tab === "biomes" ? "biomes" : tab === "clutter" ? "types" : "sites"} · asset ID{" "}
            {current.id}
          </p>
        )}
      </Section>
      {tab === "clutter" && current && (
        <Section
          title="Preview"
          description="Inspect one model or estimate its coverage on a terrain patch in metres."
        >
          <Select
            label="Clutter preview"
            value={clutterPreview}
            options={[
              { value: "asset", label: "Selected asset" },
              { value: "scatter", label: "Terrain patch" },
              { value: "library", label: "Entire library" },
            ]}
            onChange={(value) => onClutterPreview?.(value as "asset" | "scatter" | "library")}
          />
          <button className="subtle full" onClick={onShowClutter}>
            Show clutter preview
          </button>
          {clutterPreview === "scatter" && clutterPatch && (
            <>
              <Field
                label="Patch size"
                value={clutterPatch.sizeM}
                unit="m"
                min={5}
                max={5000}
                step={5}
                onChange={(sizeM) =>
                  onClutterPatch?.({ ...clutterPatch, sizeM: Math.max(5, Math.min(5000, sizeM)) })
                }
              />
              <Field
                label="Patch latitude"
                value={clutterPatch.latitude}
                unit="°"
                min={-89.999}
                max={89.999}
                step={1}
                onChange={(latitude) =>
                  onClutterPatch?.({
                    ...clutterPatch,
                    latitude: Math.max(-89.999, Math.min(89.999, latitude)),
                  })
                }
              />
              <Field
                label="Patch longitude"
                value={clutterPatch.longitude}
                unit="°"
                min={-180}
                max={180}
                step={1}
                onChange={(longitude) =>
                  onClutterPatch?.({
                    ...clutterPatch,
                    longitude: Math.max(-180, Math.min(180, longitude)),
                  })
                }
              />
              <p className="small-note">
                The estimate applies this type's distribution, biome, slope, altitude and ocean
                filters. Dense patches show a capped sample; native GPU placement may differ.
              </p>
            </>
          )}
        </Section>
      )}
      {tab === "biomes" &&
        current &&
        (() => {
          const b = current as TerrainBiome;
          const update = (f: (v: TerrainBiome) => void) =>
            change((p) => f(p.surface.biomes[index]));
          return (
            <>
              <Section title="Biome coverage">
                <TextField
                  label="Biome name"
                  value={b.name}
                  onChange={(v) => update((b) => (b.name = v))}
                />
                <ColorField
                  label="Biome map tint"
                  value={b.color}
                  onChange={(v) => update((b) => (b.color = v))}
                />
                <Field
                  label="Biome seed"
                  value={b.seed}
                  onChange={(v) => update((b) => (b.seed = v))}
                />
                <Slider
                  label="Biome coverage"
                  value={b.coverage}
                  onChange={(v) => update((b) => (b.coverage = v))}
                />
                <Field
                  label="Biome patch scale"
                  value={b.scale}
                  min={0.01}
                  step={0.1}
                  onChange={(v) => update((b) => (b.scale = v))}
                />
                {(
                  [
                    ["minHeight", "Minimum height", 0, 1],
                    ["maxHeight", "Maximum height", 0, 1],
                    ["minLatitude", "Minimum latitude", -90, 90],
                    ["maxLatitude", "Maximum latitude", -90, 90],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <Field
                    key={key}
                    label={label}
                    value={b[key]}
                    min={min}
                    max={max}
                    step={key.includes("Height") ? 0.01 : 1}
                    onChange={(v) => update((b) => (b[key] = v))}
                  />
                ))}
                <p className="small-note">
                  Height is normalized from the planet's lowest to highest terrain. The first biome
                  fills uncovered areas.
                </p>
              </Section>
              <Section title="Surface detail">
                <Material
                  title="Ground"
                  value={b.ground}
                  onChange={(f) => update((b) => f(b.ground))}
                />
                <Material
                  title="Slope"
                  value={b.slope}
                  onChange={(f) => update((b) => f(b.slope))}
                />
                {(
                  [
                    ["slopeBlendStrength", "Slope blend strength"],
                    ["slopeBlendContrast", "Slope blend contrast"],
                    ["slopeBlendBias", "Slope blend bias"],
                  ] as const
                ).map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    value={b[key]}
                    step={0.1}
                    onChange={(v) => update((b) => (b[key] = v))}
                  />
                ))}
              </Section>
              <Section
                title="Global biome blending"
                description="Detail fades in as the camera approaches: the start distance must be greater than the end distance."
              >
                <Field
                  label="Biome blend strength"
                  value={body.surface.biomeBlendStrength}
                  min={0.01}
                  step={0.1}
                  onChange={(v) => change((p) => (p.surface.biomeBlendStrength = v))}
                />
                <Field
                  label="Detail fade start"
                  value={body.surface.detailFadeStartM}
                  min={0}
                  unit="m"
                  onChange={(v) => change((p) => (p.surface.detailFadeStartM = v))}
                />
                <Field
                  label="Detail fade end"
                  value={body.surface.detailFadeEndM}
                  min={0}
                  unit="m"
                  onChange={(v) => change((p) => (p.surface.detailFadeEndM = v))}
                />
              </Section>
            </>
          );
        })()}
      {tab === "clutter" &&
        current &&
        (() => {
          const c = current as ClutterType;
          const stock = STOCK_ASSETS.find((asset) => asset.id === c.stockAssetId);
          const imported = c.importedAsset;
          const update = (f: (v: ClutterType) => void) => change((p) => f(p.clutter[index]));
          return (
            <>
              <Section title="Type & geometry">
                <TextField
                  label="Clutter name"
                  value={c.name}
                  onChange={(v) => update((c) => (c.name = v))}
                />
                <Toggle
                  label="Enable clutter type"
                  value={c.enabled}
                  onChange={(v) => update((c) => (c.enabled = v))}
                />
                <Select
                  label="Clutter model"
                  value={imported ? "imported" : (c.stockAssetId ?? "")}
                  options={[
                    { value: "", label: "Procedural geometry" },
                    ...(imported
                      ? [{ value: "imported", label: `Imported · ${imported.sourceName}` }]
                      : []),
                    ...STOCK_ASSETS.map((asset) => ({
                      value: asset.id,
                      label: `${asset.name} · ${asset.category} · ${asset.dimensionsM[1]} m tall`,
                    })),
                  ]}
                  onChange={(id) =>
                    update((c) => {
                      if (id === "imported") return;
                      importGeneration.current++;
                      delete c.importedAsset;
                      if (!id) {
                        delete c.stockAssetId;
                        c.material.roughness = 0.86;
                        c.material.metalness = 0;
                        return;
                      }
                      const asset = STOCK_ASSETS.find((asset) => asset.id === id);
                      if (!asset) return;
                      c.stockAssetId = id;
                      c.name = asset.name;
                      c.geometry.dimensionsM = [...asset.dimensionsM];
                      c.material.color = "#ffffff";
                      c.material.secondaryColor = "#ffffff";
                      c.material.roughness =
                        asset.category === "rock" ? 0.85 : asset.category === "tree" ? 0.9 : 0.65;
                      c.material.metalness = 0;
                      c.material.normalStrength = 0.65;
                      c.material.opacity = stockUsesCutout(id);
                      c.material.doubleSided = asset.category !== "rock";
                      c.material.useTerrainMask = false;
                      if (asset.category === "groundcover") {
                        c.distribution.objectSeparationM = Math.max(
                          0.2,
                          Math.min(0.9, Math.max(asset.dimensionsM[0], asset.dimensionsM[2]) * 0.6),
                        );
                        c.distribution.density = 1;
                        c.distribution.generationRangeM = 80;
                        c.distribution.minScale = [0.7, 0.7, 0.7];
                        c.distribution.maxScale = [1.25, 1.25, 1.25];
                        c.distribution.orientation = "SurfaceNormalSmooth";
                        c.distribution.patchContrast = 0.8;
                        if (clutterPatch) onClutterPatch?.({ ...clutterPatch, sizeM: 20 });
                      }
                    })
                  }
                />
                <button
                  className="subtle full"
                  disabled={importing}
                  onClick={() => glbInput.current?.click()}
                >
                  {importing ? "Importing model…" : "Import GLB model"}
                </button>
                <input
                  ref={glbInput}
                  type="file"
                  accept=".glb,model/gltf-binary"
                  aria-label="GLB file"
                  hidden
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    const targetId = c.id,
                      targetBody = body.id,
                      generation = ++importGeneration.current,
                      source = c.importedAsset,
                      stockSource = c.stockAssetId,
                      shape = c.geometry.shape;
                    setImporting(true);
                    setImportStatus("Reading model and embedded textures…");
                    try {
                      if (!file.name.toLowerCase().endsWith(".glb"))
                        throw new Error("Choose a self-contained .glb file.");
                      if (file.size > IMPORTED_LIMITS.fileBytes)
                        throw new Error("GLB exceeds 16 MB. Export a smaller static model.");
                      const asset = await importClutterGlb(await file.arrayBuffer(), file.name);
                      const latest = importTarget.current as ClutterType | undefined;
                      if (
                        generation !== importGeneration.current ||
                        latest?.id !== targetId ||
                        latest.importedAsset !== source ||
                        latest.stockAssetId !== stockSource ||
                        latest.geometry.shape !== shape
                      )
                        throw new Error(
                          "The selected type or model changed during import. Select the intended type and import again.",
                        );
                      const error = change((p) => {
                        if (p.id !== targetBody)
                          throw new Error(
                            "The selected body changed during import. Select the intended type and import again.",
                          );
                        const type = p.clutter.find((v) => v.id === targetId);
                        if (!type) throw new Error("The clutter type was removed during import.");
                        delete type.stockAssetId;
                        type.importedAsset = asset;
                        type.name = file.name
                          .replace(/\.glb$/i, "")
                          .replace(/[\u0000-\u001f\ud800-\udfff]/gu, "")
                          .slice(0, 160);
                        type.geometry.dimensionsM = [...asset.dimensionsM];
                        Object.assign(type.material, {
                          color: "#ffffff",
                          secondaryColor: "#ffffff",
                          roughness: 1,
                          metalness: 1,
                          normalStrength: 1,
                          opacity: false,
                          doubleSided: false,
                          useTerrainMask: false,
                        });
                      });
                      if (error) throw new Error(error);
                      setImportStatus(
                        `Imported ${file.name}: ${asset.triangleCount.toLocaleString()} triangles, ${asset.materials.length} materials. Model and textures are included in project saves.`,
                      );
                    } catch (error) {
                      setImportStatus(`Could not import model: ${(error as Error).message}`);
                    } finally {
                      setImporting(false);
                    }
                  }}
                />
                {importStatus && (
                  <p className="small-note" role="status" data-testid="glb-import-status">
                    {importStatus}
                  </p>
                )}
                {imported && (
                  <p className="small-note">
                    Static model at its authored metre scale, centered with its base on the ground.
                    All five native LODs keep the complete imported mesh. Original materials and
                    embedded textures are preserved as native channels.
                  </p>
                )}
                {stock && (
                  <p className="small-note">
                    {stock.description} Stock models apply their authored dimensions and palette;
                    tints and placement remain editable.
                  </p>
                )}
                {stock?.category === "groundcover" && (
                  <p className="small-note">
                    Grass uses ordinary clutter placement. Close spacing fills the ground; biome
                    membership selects where it grows.
                  </p>
                )}
                {!stock && !imported && (
                  <Select
                    label="Geometry family"
                    value={c.geometry.shape}
                    options={options(["boulder", "pebble", "crystal", "grass", "shrub", "spire"])}
                    onChange={(v) =>
                      update((c) => (c.geometry.shape = v as ClutterType["geometry"]["shape"]))
                    }
                  />
                )}
                {!imported && (
                  <Field
                    label={stock ? "Texture seed" : "Geometry seed"}
                    value={c.seed}
                    onChange={(v) => update((c) => (c.seed = v))}
                  />
                )}
                <Vector
                  label="Dimensions (m)"
                  value={c.geometry.dimensionsM}
                  onChange={(v) => update((c) => (c.geometry.dimensionsM = v))}
                />
                {!stock && !imported && (
                  <>
                    <Field
                      label="Mesh detail"
                      value={c.geometry.detail}
                      min={0}
                      max={4}
                      onChange={(v) => update((c) => (c.geometry.detail = v))}
                    />
                    <Slider
                      label="Irregularity"
                      value={c.geometry.irregularity}
                      onChange={(v) => update((c) => (c.geometry.irregularity = v))}
                    />
                  </>
                )}
              </Section>
              <Section title="Material">
                <ColorField
                  label={stock || imported ? "Palette tint" : "Clutter color"}
                  value={c.material.color}
                  onChange={(v) => update((c) => (c.material.color = v))}
                />
                {!imported && (
                  <ColorField
                    label={stock ? "Accent tint" : "Mineral color"}
                    value={c.material.secondaryColor}
                    onChange={(v) => update((c) => (c.material.secondaryColor = v))}
                  />
                )}
                {imported && (
                  <p className="small-note">
                    Roughness, metalness and normal strength multiply the imported material
                    channels. A value of 1 preserves their authored settings.
                  </p>
                )}
                {(
                  [
                    ["roughness", "Clutter roughness"],
                    ["metalness", "Clutter metalness"],
                    ["normalStrength", "Normal strength"],
                  ] as const
                ).map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    value={c.material[key]}
                    min={0}
                    step={0.05}
                    onChange={(v) => update((c) => (c.material[key] = v))}
                  />
                ))}
                {stockUsesCutout(c.stockAssetId) || stock?.category === "groundcover" ? (
                  <p className="small-note">
                    Fine foliage geometry and both sides of the leaves are included in this model.
                  </p>
                ) : (
                  <>
                    <Toggle
                      label="Alpha cutout"
                      value={c.material.opacity}
                      onChange={(v) => update((c) => (c.material.opacity = v))}
                    />
                    <Toggle
                      label="Double sided"
                      value={c.material.doubleSided}
                      onChange={(v) => update((c) => (c.material.doubleSided = v))}
                    />
                  </>
                )}
                <Toggle
                  label="Use terrain tint mask"
                  value={c.material.useTerrainMask}
                  onChange={(v) => update((c) => (c.material.useTerrainMask = v))}
                />
              </Section>
              <Section title="Distribution">
                <Slider
                  label="Clutter density"
                  value={c.distribution.density}
                  onChange={(v) => update((c) => (c.distribution.density = v))}
                />
                <Field
                  label="Distribution seed"
                  value={c.distribution.seed}
                  onChange={(v) => update((c) => (c.distribution.seed = v))}
                />
                {(
                  [
                    ["objectSeparationM", "Object separation", "m"],
                    ["generationRangeM", "Generation range", "m"],
                    ["patchScale", "Patch scale", ""],
                    ["patchContrast", "Patch contrast", ""],
                    ["textureTiling", "Distribution tiling", ""],
                  ] as const
                ).map(([key, label, unit]) => (
                  <Field
                    key={key}
                    label={label}
                    unit={unit}
                    value={c.distribution[key]}
                    min={0.0001}
                    step={0.1}
                    onChange={(v) => update((c) => (c.distribution[key] = v))}
                  />
                ))}
                <p className="small-note">Biome membership · none selected means all biomes.</p>
                <div className="biome-memberships">
                  {body.surface.biomes.map((b) => (
                    <label key={b.id}>
                      <input
                        type="checkbox"
                        aria-label={`Place in ${b.name}`}
                        checked={c.distribution.biomeIds.includes(b.id)}
                        onChange={(e) =>
                          update((c) => {
                            c.distribution.biomeIds = e.target.checked
                              ? [...c.distribution.biomeIds, b.id]
                              : c.distribution.biomeIds.filter((id) => id !== b.id);
                          })
                        }
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
                <Vector
                  label="Minimum scale"
                  value={c.distribution.minScale}
                  onChange={(v) => update((c) => (c.distribution.minScale = v))}
                />
                <Vector
                  label="Maximum scale"
                  value={c.distribution.maxScale}
                  onChange={(v) => update((c) => (c.distribution.maxScale = v))}
                />
                <Select
                  label="Orientation"
                  value={c.distribution.orientation}
                  options={options([
                    "Up",
                    "SurfaceNormal",
                    "SurfaceNormalAndGradient",
                    "SurfaceNormalSmooth",
                  ])}
                  onChange={(v) =>
                    update(
                      (c) =>
                        (c.distribution.orientation =
                          v as ClutterType["distribution"]["orientation"]),
                    )
                  }
                />
                {(
                  [
                    ["minRotationDeg", "Minimum rotation"],
                    ["maxRotationDeg", "Maximum rotation"],
                    ["slopeMaskStrength", "Slope mask strength"],
                    ["slopeMaskContrast", "Slope mask contrast"],
                    ["slopeMaskBias", "Slope mask bias"],
                  ] as const
                ).map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    value={c.distribution[key]}
                    step={0.1}
                    onChange={(v) => update((c) => (c.distribution[key] = v))}
                  />
                ))}
              </Section>
              <Section title="Altitude density">
                <p className="small-note">
                  Controls density at each altitude in meters above mean radius, separately from the
                  Clutter density slider. Each value must be between 0 (none) and 1 (full density).
                  Empty uses constant density.
                </p>
                {c.distribution.altitudeDensity.map((point, i) => (
                  <div className="curve-row" key={i}>
                    <Field
                      label={`Altitude ${i + 1}`}
                      value={point.altitudeM}
                      unit="m"
                      onChange={(v) =>
                        update((c) => (c.distribution.altitudeDensity[i].altitudeM = v))
                      }
                    />
                    <Field
                      label={`Altitude density ${i + 1}`}
                      value={point.density}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) =>
                        update((c) => (c.distribution.altitudeDensity[i].density = v))
                      }
                    />
                    <button
                      className="icon-button"
                      aria-label={`Remove altitude ${i + 1}`}
                      onClick={() => update((c) => c.distribution.altitudeDensity.splice(i, 1))}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button
                  className="subtle"
                  onClick={() =>
                    update((c) =>
                      c.distribution.altitudeDensity.push({
                        altitudeM:
                          (c.distribution.altitudeDensity.at(-1)?.altitudeM ?? -1000) + 1000,
                        density: 1,
                      }),
                    )
                  }
                >
                  <Plus size={13} />
                  Add altitude point
                </button>
              </Section>
            </>
          );
        })()}
      {tab === "sites" &&
        current &&
        (() => {
          const s = current as LandmarkSettings;
          const update = (f: (v: LandmarkSettings) => void) => change((p) => f(p.landmarks[index]));
          return (
            <>
              <Section title="Destination">
                <TextField
                  label="Site name"
                  value={s.name}
                  onChange={(v) => update((s) => (s.name = v))}
                />
                <Toggle
                  label="Enable site"
                  value={s.enabled}
                  onChange={(v) => update((s) => (s.enabled = v))}
                />
                <Select
                  label="Location category"
                  value={s.category}
                  options={options(["landmark", "city", "crater", "mountain"])}
                  onChange={(v) =>
                    update((s) => {
                      s.category = v as LandmarkSettings["category"];
                      if (v !== "landmark") s.launchPad = false;
                    })
                  }
                />
                <button
                  className="subtle full"
                  aria-pressed={placingSiteId === s.id}
                  onClick={() => onPlaceSite?.(placingSiteId === s.id ? null : s.id)}
                >
                  {placingSiteId === s.id ? "Cancel placement" : "Place on planet"}
                </button>
                <Field
                  label="Site latitude"
                  value={s.latitude}
                  min={-89.999}
                  max={89.999}
                  step={0.01}
                  unit="°"
                  onChange={(v) => update((s) => (s.latitude = v))}
                />
                <Field
                  label="Site longitude"
                  value={s.longitude}
                  min={-180}
                  max={180}
                  step={0.01}
                  unit="°"
                  onChange={(v) => update((s) => (s.longitude = v))}
                />
                {s.category === "landmark" && (
                  <Toggle
                    label="Physical launch pad"
                    value={s.launchPad}
                    onChange={(v) => update((s) => (s.launchPad = v))}
                  />
                )}
                <p className="small-note">
                  Landmarks appear in the native launch destination menu. City, crater, and mountain
                  entries are named map locations. Choose dry, level terrain for a launch pad.
                </p>
              </Section>
              {s.launchPad && (
                <Section title="Generated platform">
                  <Field
                    label="Platform height"
                    value={s.sizeM[0]}
                    unit="m"
                    min={1}
                    onChange={(v) => update((s) => (s.sizeM[0] = v))}
                  />
                  <Field
                    label="Platform width"
                    value={s.sizeM[1]}
                    unit="m"
                    min={1}
                    onChange={(v) => update((s) => (s.sizeM[1] = v))}
                  />
                  <Field
                    label="Platform length"
                    value={s.sizeM[2]}
                    unit="m"
                    min={1}
                    onChange={(v) => update((s) => (s.sizeM[2] = v))}
                  />
                  <Field
                    label="Ground offset"
                    value={s.groundOffsetM}
                    unit="m"
                    step={0.1}
                    onChange={(v) => update((s) => (s.groundOffsetM = v))}
                  />
                  <ColorField
                    label="Platform color"
                    value={s.color}
                    onChange={(v) => update((s) => (s.color = v))}
                  />
                </Section>
              )}
            </>
          );
        })()}
    </>
  );
}
