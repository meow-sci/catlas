import { estimateExportBytes, EXPORT_BUDGET_BYTES } from "./lib/exportBudget";
import { homeLandmark } from "./lib/project";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  AlertTriangle,
  ArrowDownToLine,
  BookOpen,
  Check,
  ChevronDown,
  Circle,
  Copy,
  Download,
  FileCode2,
  FolderOpen,
  Globe2,
  Grid2X2,
  Layers3,
  Maximize2,
  MoreHorizontal,
  Orbit,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { Celestial, Planet, Project, StarSystem, Vec3 } from "./lib/types";
import { isPlanet } from "./lib/types";
import {
  createProject,
  cloneProjectForEdit,
  importedProjectBudgetError,
  descendants,
  makePlanet,
  makeStar,
  orbit,
  parseProject,
  uniqueId,
  validateProject,
} from "./lib/project";
import { buildSystemXml, exportMod } from "./lib/export";
import { Viewport } from "./components/Viewport";
import { Inspector, type InspectorTab } from "./components/Inspector";
import { Field, Section, Toggle } from "./components/Controls";
import { AUTOSAVE_KEY, readAutosavedProject, writeAutosavedProject } from "./lib/autosave";
import { defaultClutterPatchLocation } from "./lib/clutterPreview";
import "./styles.css";
const STORE = AUTOSAVE_KEY;
function initial() {
  try {
    const s = localStorage.getItem(STORE);
    return s ? parseProject(s) : createProject();
  } catch {
    return createProject();
  }
}
function download(data: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(data);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export default function App() {
  const [project, setProject] = useState<Project>(initial),
    [systemId, setSystemId] = useState(() => initial().systems[0]?.id ?? "Sol"),
    [bodyId, setBodyId] = useState("Earth"),
    [tab, setTab] = useState<InspectorTab>("surface"),
    [mode, setMode] = useState<"surface" | "system" | "clutter">("surface"),
    [sitePlacement, setSitePlacement] = useState<{
      systemId: string;
      bodyId: string;
      siteId: string;
    } | null>(null),
    [clutterPreview, setClutterPreview] = useState<"asset" | "scatter" | "library">("asset"),
    [selectedClutterId, setSelectedClutterId] = useState<string | null>(null),
    [clutterPatch, setClutterPatch] = useState({ sizeM: 500, latitude: 0, longitude: 0 }),
    [grid, setGrid] = useState(false),
    [realScale, setRealScale] = useState(false),
    [maxDays, setMaxDays] = useState(3652.5),
    [days, setDays] = useState(0),
    [playing, setPlaying] = useState(false),
    [resetKey, setResetKey] = useState(0),
    [search, setSearch] = useState(""),
    [addOpen, setAddOpen] = useState(false),
    [modal, setModal] = useState<
      | "export"
      | "settings"
      | "xml"
      | "help"
      | "delete"
      | "deleteSystem"
      | "new"
      | "warnings"
      | "view"
      | null
    >(null),
    [notice, setNotice] = useState(""),
    [progress, setProgress] = useState<{ message: string; value: number } | null>(null),
    [saved, setSaved] = useState(false),
    [saveError, setSaveError] = useState(false),
    [storageReady, setStorageReady] = useState(false),
    [history, setHistory] = useState<{ past: Project[]; future: Project[] }>({
      past: [],
      future: [],
    });
  const input = useRef<HTMLInputElement>(null),
    projectRef = useRef(project),
    collectionGeneration = useRef(0);
  projectRef.current = project;
  const historyRef = useRef(history);
  historyRef.current = history;
  const system = project.systems.find((s) => s.id === systemId) ?? project.systems[0],
    body = system?.bodies.find((b) => b.id === bodyId) ?? system?.bodies[0],
    issues = useMemo(() => validateProject(project), [project]),
    bodyCount = project.systems.reduce((n, s) => n + s.bodies.length, 0);
  const commit = useCallback((fn: (p: Project) => void) => {
    const old = projectRef.current;
    const next = cloneProjectForEdit(old);
    fn(next);
    const budgetError = importedProjectBudgetError(next);
    if (budgetError) {
      setNotice(budgetError);
      return budgetError;
    }
    const h = historyRef.current;
    const nextHistory = { past: [...h.past.slice(-39), old], future: [] };
    projectRef.current = next;
    historyRef.current = nextHistory;
    setProject(next);
    setHistory(nextHistory);
  }, []);
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.past.length) return;
    const prev = h.past[h.past.length - 1];
    collectionGeneration.current++;
    const nextHistory = { past: h.past.slice(0, -1), future: [projectRef.current, ...h.future] };
    projectRef.current = prev;
    historyRef.current = nextHistory;
    setProject(prev);
    setHistory(nextHistory);
  }, []);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h.future.length) return;
    const next = h.future[0];
    collectionGeneration.current++;
    const nextHistory = { past: [...h.past, projectRef.current], future: h.future.slice(1) };
    projectRef.current = next;
    historyRef.current = nextHistory;
    setProject(next);
    setHistory(nextHistory);
  }, []);
  const saveProject = useCallback(() => {
    download(
      new Blob([JSON.stringify(projectRef.current, null, 2)], { type: "application/json" }),
      `${projectRef.current.id}.orbit.json`,
    );
    setNotice("Project saved. All settings, imported models and texture channels are included.");
  }, []);
  useEffect(() => {
    const startingProject = projectRef.current;
    let cancelled = false;
    readAutosavedProject()
      .then((text) => {
        if (cancelled) return;
        if (text && projectRef.current === startingProject) {
          try {
            const restored = parseProject(text);
            collectionGeneration.current++;
            projectRef.current = restored;
            setProject(restored);
            const restoredSystem =
              restored.systems.find((s) => s.id === systemId) ?? restored.systems[0];
            setSystemId(restoredSystem.id);
            setBodyId((previous) =>
              restoredSystem.bodies.some((b) => b.id === previous)
                ? previous
                : (restoredSystem.bodies.find(isPlanet)?.id ?? restoredSystem.bodies[0].id),
            );
          } catch {
            setNotice(
              "The browser's saved project could not be restored. Open your saved project file to recover it.",
            );
          }
        }
        setStorageReady(true);
      })
      .catch(() => {
        if (!cancelled) setStorageReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    setSaved(false);
    setSaveError(false);
    let cancelled = false;
    const t = setTimeout(() => {
      writeAutosavedProject(JSON.stringify(project))
        .then(() => {
          if (!cancelled) setSaved(true);
        })
        .catch((error) => {
          if (!cancelled) {
            setSaveError(true);
            setNotice((error as Error).message);
          }
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [project, storageReady]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const i = setInterval(() => {
      const now = performance.now();
      setDays((d) => Math.min(maxDays, d + ((now - last) / 1000) * 10));
      last = now;
    }, 60);
    return () => clearInterval(i);
  }, [playing, maxDays]);
  useEffect(() => {
    if (days >= maxDays) setPlaying(false);
  }, [days, maxDays]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveProject();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if (e.key === "Escape") {
        setModal(null);
        setAddOpen(false);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [saveProject, undo, redo]);
  const selectBody = (id: string) => {
    setBodyId(id);
    const b = system.bodies.find((b) => b.id === id);
    if (b && !isPlanet(b)) setTab("physical");
    else if (b?.kind === "gas" && ["ocean", "biomes", "clutter", "sites"].includes(tab))
      setTab("surface");
  };
  const currentGeneration = collectionGeneration.current;
  const updateBody = (fn: (b: Celestial) => void): string | undefined => {
    if (collectionGeneration.current !== currentGeneration)
      return "The collection changed during import. Select the intended type and import again.";
    return commit((p) => {
      const b = p.systems.find((s) => s.id === system.id)?.bodies.find((b) => b.id === body.id);
      if (b) fn(b);
    });
  };
  const allIds = () => project.systems.flatMap((s) => s.bodies.map((b) => b.id));
  function addBody(kind: "rocky" | "gas" | "atmospheric" | "moon" | "binary" | "system") {
    setAddOpen(false);
    if (kind === "system") {
      const id = uniqueId(
          "NewSystem",
          project.systems.map((s) => s.id),
        ),
        starId = uniqueId("NewStar", allIds());
      commit((p) =>
        p.systems.push({
          id,
          name: "Untitled system",
          description: "A new stellar neighborhood.",
          position: [5, 0, 0],
          bodies: [makeStar(starId, "New star")],
        }),
      );
      setSystemId(id);
      setBodyId(starId);
      setTab("physical");
      return;
    }
    if (kind === "binary") {
      const primary =
        system.bodies.find((b) => b.id === body.id && b.kind === "star") ??
        system.bodies.find((b) => b.kind === "star");
      if (!primary || primary.kind !== "star") return;
      const companionId = uniqueId(primary.id + "B", allIds());
      commit((p) => {
        const s = p.systems.find((s) => s.id === system.id)!,
          a = s.bodies.find((b) => b.id === primary.id)!;
        let baryId = a.parentId;
        if (!baryId || s.bodies.find((b) => b.id === baryId)?.kind !== "barycenter") {
          baryId = uniqueId(primary.id + "Barycenter", allIds());
          s.bodies.unshift({
            id: baryId,
            name: primary.name + " barycenter",
            kind: "barycenter",
            parentId: null,
            position: [0, 0, 0],
            orbit: orbit(),
          });
          a.parentId = baryId;
          a.orbit = { ...orbit(0.2, 0.1), barycentric: true, argumentOfPeriapsis: 180 };
        }
        const second = makeStar(companionId, primary.name + " B");
        second.parentId = baryId;
        second.massSuns = primary.massSuns * 0.7;
        second.radiusKm = primary.radiusKm * 0.75;
        second.color = "#ffc489";
        second.orbit = { ...orbit(0.2, 0.1), barycentric: true };
        s.bodies.push(second);
      });
      setBodyId(companionId);
      setTab("physical");
      setMode("system");
      return;
    }
    const parent =
      kind === "moon" && isPlanet(body) ? body : system.bodies.find((b) => b.kind === "star")!;
    const name =
      kind === "moon"
        ? "New moon"
        : kind === "gas"
          ? "New gas giant"
          : kind === "atmospheric"
            ? "New atmospheric world"
            : "New rocky world";
    const id = uniqueId(name, allIds());
    const b = makePlanet(
      id,
      name,
      parent.id,
      kind === "gas" ? "gas" : "rocky",
      kind === "moon" ? 0.003 : 1.8,
    );
    if (kind === "moon") {
      b.radiusKm = 1700;
      b.massEarths = 0.012;
      b.rotation.tidallyLocked = true;
    }
    if (kind === "atmospheric") b.atmosphere.enabled = true;
    commit((p) => p.systems.find((s) => s.id === system.id)!.bodies.push(b));
    setBodyId(id);
    setTab("surface");
    setMode("surface");
  }
  function duplicate() {
    const id = uniqueId(body.id + "Copy", allIds());
    const error = commit((p) => {
      const bodies = p.systems.find((s) => s.id === system.id)!.bodies,
        index = bodies.findIndex((b) => b.id === body.id),
        b = bodies[index];
      // Commit already cloned editable settings and shared the immutable imported sources.
      bodies[index] = body;
      b.id = id;
      b.name += " copy";
      if (isPlanet(b)) b.homeBody = false;
      bodies.push(b);
    });
    if (error) return;
    setBodyId(id);
  }
  function startCollection(blank: boolean) {
    const next = createProject();
    if (blank) {
      const star = makeStar("NewStar", "New star");
      const home = makePlanet("Homeworld", "Homeworld", star.id);
      home.homeBody = true;
      home.ocean.enabled = true;
      home.landmarks = [homeLandmark(home)];
      next.id = "MyUniverse";
      next.name = "Untitled collection";
      next.systems = [
        {
          id: "NewSystem",
          name: "New system",
          description: "An original system.",
          position: [0, 0, 0],
          bodies: [star, home],
        },
      ];
    }
    collectionGeneration.current++;
    commit((p) => Object.assign(p, next));
    setSystemId(next.systems[0].id);
    setBodyId(next.systems[0].bodies.find(isPlanet)!.id);
    setTab("surface");
    setMode("surface");
    setModal(null);
    setNotice("New collection created. Undo restores your previous work.");
  }
  async function importFile(file: File) {
    try {
      if (file.size > 128 * 1024 * 1024)
        throw new Error("Project file exceeds the 128 MB browser import limit.");
      const next = parseProject(await file.text());
      collectionGeneration.current++;
      commit((p) => Object.assign(p, next));
      setSystemId(next.systems[0].id);
      setBodyId(next.systems[0].bodies[0].id);
      setTab("physical");
      setNotice(`Opened ${next.name}.`);
    } catch (e) {
      setNotice(`Could not open project: ${(e as Error).message}`);
    }
  }
  async function doExport() {
    setProgress({ message: "Preparing export…", value: 0 });
    try {
      const blob = await exportMod(project, (message, value) => setProgress({ message, value }));
      download(blob, `${project.id}.zip`);
      setNotice(`Exported ${(blob.size / 1024 / 1024).toFixed(1)} MB of original system assets.`);
    } catch (e) {
      setNotice(`Export failed: ${(e as Error).message}`);
    } finally {
      setProgress(null);
    }
  }
  useEffect(() => {
    if (mode === "clutter" && body.kind !== "rocky") setMode("surface");
  }, [mode, body.kind]);
  useEffect(() => {
    const location = body.kind === "rocky" ? defaultClutterPatchLocation(body) : { latitude: 0, longitude: 0 };
    setClutterPatch((previous) => ({
      ...previous,
      ...location,
    }));
  }, [body.id]);
  const selectedClutter =
    body.kind === "rocky"
      ? (body.clutter.find((type) => type.id === selectedClutterId) ?? body.clutter[0])
      : null;
  const placingSite =
    sitePlacement !== null &&
    sitePlacement.systemId === system.id &&
    sitePlacement.bodyId === body.id &&
    mode === "surface" &&
    tab === "sites" &&
    body.kind === "rocky" &&
    body.landmarks.some((site) => site.id === sitePlacement.siteId);
  useEffect(() => {
    if (sitePlacement && !placingSite) setSitePlacement(null);
  }, [sitePlacement, placingSite]);
  const placeSite = (siteId: string | null) => {
    if (siteId === null) {
      setSitePlacement(null);
      return;
    }
    setMode("surface");
    setSitePlacement({ systemId: system.id, bodyId: body.id, siteId });
  };
  const sitePoint = (latitude: number, longitude: number) => {
    if (!placingSite || !sitePlacement) return;
    const { siteId } = sitePlacement;
    setSitePlacement(null);
    updateBody((body) => {
      if (body.kind !== "rocky") return;
      const site = body.landmarks.find((site) => site.id === siteId);
      if (site) {
        site.latitude = Number(latitude.toFixed(6));
        site.longitude = Number(longitude.toFixed(6));
      }
    });
  };
  const safeBody =
    body && body.kind !== "barycenter" && !(body.radiusKm > 0) ? { ...body, radiusKm: 1 } : body;
  const dialogTitle =
    modal === "export"
      ? "Export your universe"
      : modal === "settings"
        ? "Collection settings"
        : modal === "xml"
          ? "Native KSA XML"
          : modal === "delete"
            ? `Delete ${body.name}?`
            : modal === "deleteSystem"
              ? `Delete ${system.name}?`
              : modal === "new"
                ? "Start a new collection"
                : modal === "warnings"
                  ? "Warnings and validation"
                  : modal === "view"
                    ? "System view options"
                    : "Built for the worlds ahead.";
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Orbit Foundry">
          <Aperture size={28} />
          <span>
            ORBIT<span className="brand-light">FOUNDRY</span>
          </span>
          <span className="poc-badge">KSA</span>
        </a>
        <div className="project-title">
          <span className="project-dot" />
          {project.name}
          <ChevronDown size={13} />
        </div>
        <div className="top-actions">
          <span className="save-state">
            {saved ? <Check size={12} /> : <Circle size={10} />}{" "}
            {saveError
              ? "Autosave unavailable · save a file"
              : !storageReady
                ? "Restoring…"
                : saved
                  ? "Saved locally"
                  : "Saving…"}
          </span>
          <button
            className="icon-button"
            aria-label="Undo"
            title="Undo"
            onClick={undo}
            disabled={!history.past.length}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Redo"
            title="Redo"
            onClick={redo}
            disabled={!history.future.length}
          >
            <Redo2 size={17} />
          </button>
          <span className="separator" />
          <button
            className="quiet"
            aria-label="New collection"
            title="New collection"
            onClick={() => setModal("new")}
          >
            <Plus size={15} />
            <span>New</span>
          </button>
          <button className="quiet" onClick={() => input.current?.click()}>
            <FolderOpen size={15} />
            <span>Open</span>
          </button>
          <button className="quiet" onClick={saveProject}>
            <Save size={15} />
            <span>Save</span>
          </button>
          <button
            className={`warning-indicator ${issues.length ? "has-issues" : ""}`}
            aria-label="Warnings and validation"
            title={
              issues.length
                ? `${issues.length} collection issue${issues.length === 1 ? "" : "s"}`
                : "No collection warnings"
            }
            onClick={() => setModal("warnings")}
          >
            {issues.length ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
            {issues.length > 0 && <span>{issues.length}</span>}
          </button>
          <button className="primary" onClick={() => setModal("export")}>
            <ArrowDownToLine size={16} /> Export mod
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-top">
            <span className="eyebrow">COLLECTION</span>
            <button
              className="icon-button"
              title="Collection settings"
              aria-label="Collection settings"
              onClick={() => setModal("settings")}
            >
              <Settings2 size={16} />
            </button>
          </div>
          <div className="system-list">
            {project.systems.map((s, i) => (
              <button
                key={s.id}
                className={`system-card ${system.id === s.id ? "active" : ""}`}
                onClick={() => {
                  setSystemId(s.id);
                  const first = s.bodies.find(isPlanet) ?? s.bodies[0];
                  setBodyId(first.id);
                  setTab(isPlanet(first) ? "surface" : "physical");
                }}
              >
                <span className={`system-symbol system-${i % 3}`}>
                  <Orbit size={22} />
                </span>
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.bodies.filter((b) => b.kind === "star").length} star
                    {s.bodies.filter((b) => b.kind === "star").length !== 1 ? "s" : ""} ·{" "}
                    {s.bodies.filter(isPlanet).length} worlds
                  </small>
                </span>
                <span className="system-index">{String(i + 1).padStart(2, "0")}</span>
              </button>
            ))}
          </div>
          <div className="body-heading">
            <span className="eyebrow">SYSTEM BODIES</span>
            <div className="add-container">
              <button
                className="icon-button add-button"
                aria-label="Add body"
                title="Add body"
                onClick={() => setAddOpen(!addOpen)}
              >
                <Plus size={17} />
              </button>
              {addOpen && (
                <div className="add-menu">
                  {(
                    [
                      ["rocky", "Rocky world"],
                      ["atmospheric", "Atmospheric world"],
                      ["gas", "Gas giant"],
                      ["moon", "Moon"],
                      ["binary", "Companion star"],
                      ["system", "Star system"],
                    ] as const
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      onClick={() => addBody(kind)}
                      disabled={kind === "moon" && !isPlanet(body)}
                    >
                      {kind === "binary" || kind === "system" ? (
                        <Sun size={15} />
                      ) : (
                        <Globe2 size={15} />
                      )}{" "}
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <label className="search">
            <Search size={13} />
            <input
              aria-label="Search bodies"
              placeholder="Find a world…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>/</kbd>
          </label>
          <div className="body-list">
            {system.bodies
              .filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
              .map((b) => {
                const parent = system.bodies.find((p) => p.id === b.parentId),
                  depth = parent && isPlanet(parent) ? 1 : 0;
                return (
                  <button
                    key={b.id}
                    className={`body-row ${b.id === body.id ? "selected" : ""}`}
                    style={{ paddingLeft: 14 + depth * 19 }}
                    onClick={() => selectBody(b.id)}
                  >
                    <span
                      className={`body-dot ${b.kind}`}
                      style={{
                        background:
                          b.kind === "star"
                            ? b.color
                            : isPlanet(b)
                              ? b.surface.colors[Math.min(2, b.surface.colors.length - 1)].color
                              : undefined,
                      }}
                    />
                    <span>{b.name}</span>
                    {isPlanet(b) && b.homeBody && (
                      <span className="home-marker" title="Home world">
                        ⌂
                      </span>
                    )}
                    {isPlanet(b) && b.rings.enabled && <Orbit className="ring-marker" size={12} />}
                    <span className="body-kind">
                      {b.kind === "star"
                        ? "STAR"
                        : b.kind === "barycenter"
                          ? "BARY"
                          : parent && isPlanet(parent)
                            ? "MOON"
                            : b.kind === "gas"
                              ? "GAS"
                              : ""}
                    </span>
                  </button>
                );
              })}
          </div>
          <div className="sidebar-footer">
            <span className="status-led" />
            <span>
              {project.systems.length} systems · {bodyCount} bodies
            </span>
            <button
              className="icon-button"
              aria-label="Help and research"
              onClick={() => setModal("help")}
            >
              <BookOpen size={15} />
            </button>
          </div>
        </aside>
        <main className="main-view">
          <div className="view-toolbar">
            <div className="breadcrumbs">
              <span>{system.name}</span>
              <span>/</span>
              <strong>{body.name}</strong>
            </div>
            <div className="segmented">
              <button
                className={mode === "surface" ? "active" : ""}
                onClick={() => setMode("surface")}
              >
                <Globe2 size={14} /> Body
              </button>
              <button
                className={mode === "system" ? "active" : ""}
                onClick={() => setMode("system")}
              >
                <Orbit size={14} /> System
              </button>
              {body.kind === "rocky" && (
                <button
                  className={mode === "clutter" ? "active" : ""}
                  onClick={() => {
                    setMode("clutter");
                    setTab("clutter");
                  }}
                >
                  <Layers3 size={14} /> Clutter preview
                </button>
              )}
            </div>
            <div className="view-tools">
              {mode === "system" && (
                <button
                  aria-label="View options"
                  title="View options"
                  className={`view-options-button ${realScale ? "active" : ""}`}
                  onClick={() => setModal("view")}
                >
                  <Settings2 size={16} />
                  <span>View options</span>
                </button>
              )}
              <button
                aria-label="Toggle reference grid"
                className={grid ? "active" : ""}
                title="Reference grid"
                onClick={() => setGrid(!grid)}
              >
                <Grid2X2 size={16} />
              </button>
              <button
                aria-label="Reset camera"
                title="Reset camera"
                onClick={() => setResetKey((k) => k + 1)}
              >
                <Maximize2 size={16} />
              </button>
            </div>
          </div>
          <div className="scene-wrap">
            {safeBody && (
              <Viewport
                system={system}
                selected={safeBody}
                mode={mode}
                days={days}
                grid={grid}
                realScale={realScale}
                resetKey={resetKey}
                onSelect={selectBody}
                placingSite={placingSite}
                clutterPreview={clutterPreview}
                selectedClutterId={selectedClutter?.id ?? null}
                clutterPatch={clutterPatch}
                onSitePoint={sitePoint}
                onCancelSitePlacement={() => setSitePlacement(null)}
              />
            )}
            <div className="scene-heading">
              <span className="eyebrow">
                {mode === "surface"
                  ? "WORLD DESIGNER"
                  : mode === "clutter"
                    ? "CLUTTER DESIGNER"
                    : "ORBITAL OVERVIEW"}
              </span>
              <h1>
                {mode === "surface"
                  ? body.name
                  : mode === "clutter"
                    ? clutterPreview === "library"
                      ? "Clutter library"
                      : (selectedClutter?.name ?? "Clutter preview")
                    : system.name}
              </h1>
              <p>
                {mode === "surface"
                  ? body.kind === "rocky"
                    ? "A world of your own making."
                    : body.kind === "gas"
                      ? "Shape the atmosphere. Paint the currents."
                      : body.kind === "star"
                        ? "The light at the heart of a system."
                        : "A shared center of gravity."
                  : mode === "clutter"
                    ? clutterPreview === "scatter"
                      ? "An approximate placement sample at a stated physical scale."
                      : "Original geometry and materials. Ready for export."
                    : "Explore a connected family of worlds."}
              </p>
            </div>
            <div className="scene-badge">
              <span className="status-led" /> LIVE PROCEDURAL PREVIEW
            </div>
            <div className="axis-widget">
              <span className="axis-y">Y</span>
              <span className="axis-x">X</span>
              <span className="axis-z">Z</span>
              <i />
              <b />
            </div>
            <div className="scene-caption">
              Drag to orbit · Scroll to zoom{mode === "system" ? " · Double-click a body" : ""}
            </div>
            <div className="preview-disclaimer">
              {mode === "system"
                ? realScale
                  ? "Real scale · physical distances and body sizes"
                  : "Distances and body sizes compressed"
                : "Artistic preview · native rendering may differ"}
            </div>
          </div>
          <div className="transport">
            <button
              className={`play-button ${playing ? "active" : ""}`}
              aria-label={playing ? "Pause orbital simulation" : "Play orbital simulation"}
              onClick={() => {
                if (!playing && days >= maxDays) setDays(0);
                setPlaying(!playing);
              }}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              className="icon-button"
              aria-label="Reset simulation time"
              onClick={() => {
                setDays(0);
                setPlaying(false);
              }}
            >
              <RotateCcw size={14} />
            </button>
            <span className="transport-label">SIMULATION</span>
            <span className="time-value">
              T + {days.toFixed(1)} <small>days</small>
            </span>
            <input
              aria-label="Simulation time"
              type="range"
              min={0}
              max={maxDays}
              step={0.1}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
            <label
              className="simulation-limit"
              title="Maximum simulation time in days. Playback stops at this horizon."
            >
              <span>Max days</span>
              <input
                aria-label="Maximum simulation days"
                type="number"
                min={0.1}
                max={1000000000}
                step="any"
                value={maxDays}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next) && next >= 0.1 && next <= 1000000000) {
                    setMaxDays(next);
                    setDays((d) => Math.min(d, next));
                  }
                }}
              />
            </label>
            <span className="speed">10 days / sec</span>
          </div>
          <div className="data-strip">
            <div>
              <span>BODY CLASS</span>
              <strong>
                {body.kind === "rocky"
                  ? body.atmosphere.enabled
                    ? "Terrestrial"
                    : "Rocky world"
                  : body.kind === "gas"
                    ? "Gas giant"
                    : body.kind === "star"
                      ? "Stellar body"
                      : "Barycenter"}
              </strong>
            </div>
            <div>
              <span>MEAN RADIUS</span>
              <strong>
                {body.kind === "barycenter" ? "—" : body.radiusKm.toLocaleString()}
                <small>{body.kind !== "barycenter" ? " km" : ""}</small>
              </strong>
            </div>
            <div>
              <span>ORBITAL DISTANCE</span>
              <strong>
                {body.parentId ? body.orbit.semiMajorAxisAu.toLocaleString() : "—"}
                <small>{body.parentId ? " AU" : ""}</small>
              </strong>
            </div>
            <button
              className={issues.length ? "validation invalid" : "validation"}
              onClick={() => setModal("warnings")}
            >
              {issues.length ? <AlertTriangle size={20} /> : <ShieldCheck size={20} />}
              <span>
                {issues.length
                  ? `${issues.length} validation issue${issues.length !== 1 ? "s" : ""}`
                  : "Ready to export"}
                <small>
                  {issues.length ? "Review collection" : "Self-contained generated assets"}
                </small>
              </span>
            </button>
          </div>
        </main>
        <aside className="inspector">
          <div className="inspector-heading">
            <div>
              <span className="eyebrow">INSPECTOR</span>
              <strong>{body.name}</strong>
            </div>
            <div>
              <button
                className="icon-button"
                title="Duplicate body"
                aria-label="Duplicate body"
                disabled={body.kind === "barycenter" || (body.kind === "star" && !body.parentId)}
                onClick={duplicate}
              >
                <Copy size={14} />
              </button>
              <button
                className="icon-button"
                title="Delete body"
                aria-label="Delete body"
                onClick={() => setModal("delete")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className="inspector-tabs">
            {(
              [
                "physical",
                "surface",
                "biomes",
                "clutter",
                "atmosphere",
                "ocean",
                "rings",
                "sites",
              ] as const
            ).map((t) => (
              <button
                key={t}
                disabled={
                  (t !== "physical" && !isPlanet(body)) ||
                  (["ocean", "biomes", "clutter", "sites"].includes(t) && body.kind !== "rocky")
                }
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t === "physical"
                  ? "Body"
                  : t === "atmosphere"
                    ? "Air"
                    : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="inspector-scroll">
            <Inspector
              body={body}
              system={system}
              tab={tab}
              update={updateBody}
              placingSiteId={placingSite ? sitePlacement?.siteId : null}
              onPlaceSite={placeSite}
              onSelectClutter={setSelectedClutterId}
              clutterPreview={clutterPreview}
              onClutterPreview={(value) => {
                setClutterPreview(value);
                setMode("clutter");
              }}
              clutterPatch={clutterPatch}
              onClutterPatch={setClutterPatch}
              onShowClutter={() => setMode("clutter")}
              onIdChange={(id) => {
                const previous = body.id;
                commit((p) =>
                  p.systems.forEach((s) =>
                    s.bodies.forEach((b) => {
                      if (b.id === previous) b.id = id;
                      if (b.parentId === previous) b.parentId = id;
                    }),
                  ),
                );
                setBodyId(id);
              }}
              onHome={() =>
                commit((p) =>
                  p.systems.forEach((s) =>
                    s.bodies.forEach((b) => {
                      if (isPlanet(b)) b.homeBody = b.id === body.id;
                    }),
                  ),
                )
              }
            />
          </div>
          <button
            className="xml-link"
            disabled={issues.some((i) => i.severity === "error")}
            onClick={() => setModal("xml")}
          >
            <FileCode2 size={14} /> Inspect generated XML <span>↗</span>
          </button>
        </aside>
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,.orbit.json"
        aria-label="Open project file"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = "";
        }}
      />
      {notice && (
        <div role="status" className="toast">
          <span>{notice}</span>
          <button aria-label="Dismiss notification" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !progress) setModal(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={modal === "export" ? "Export KSA mod" : dialogTitle}
            className={`modal ${modal === "xml" ? "wide" : ""}`}
          >
            <div className="modal-heading">
              <h2>{dialogTitle}</h2>
              <button
                className="icon-button"
                aria-label="Close dialog"
                disabled={!!progress}
                onClick={() => setModal(null)}
              >
                <X size={19} />
              </button>
            </div>
            {modal === "warnings" && (
              <>
                <p className="modal-intro">
                  {issues.length
                    ? `${issues.length} issue${issues.length === 1 ? "" : "s"} in this collection.`
                    : "No current collection warnings or validation errors."}{" "}
                  Warnings allow export; errors must be corrected first.
                </p>
                {issues.length > 0 && (
                  <div className="issue-list warnings-list">
                    {issues.map((issue, i) => (
                      <div key={i} className={`warning-item ${issue.severity}`}>
                        <strong>{issue.severity === "error" ? "Error" : "Warning"}</strong>
                        <p>{issue.message}</p>
                        {issue.bodyId && (
                          <button
                            className="subtle"
                            onClick={() => {
                              const targetSystem = project.systems.find((s) =>
                                s.bodies.some((b) => b.id === issue.bodyId),
                              );
                              if (targetSystem) {
                                setSystemId(targetSystem.id);
                                setBodyId(issue.bodyId!);
                                setTab("physical");
                                setModal(null);
                              }
                            }}
                          >
                            Inspect body
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="info-box ocean-requirement">
                  <strong>At least one ocean is required</strong>
                  <p>
                    KSA 2026.10.10.5554 needs at least one rocky world with an enabled ocean in the
                    exported system. Without one, its ocean renderer tries to allocate a zero-byte
                    buffer and can crash at startup.
                  </p>
                  <p>
                    All star-system tabs export together as one selectable KSA system, so one ocean
                    anywhere in this collection satisfies this requirement. Select a rocky world and
                    enable its Ocean control.
                  </p>
                </div>
              </>
            )}
            {modal === "view" && (
              <>
                <Toggle
                  label="Real scale"
                  value={realScale}
                  onChange={(v) => {
                    setRealScale(v);
                    setResetKey((k) => k + 1);
                  }}
                  description="Use the same physical scale for orbital distances, body sizes, and rings."
                />
                <p className="info-box">
                  Real scale is off by default for an easy-to-explore overview. When enabled,
                  planets and moons may be too small to see at a whole-system distance. Scroll to
                  zoom, or switch to Body view to inspect the selected world.
                </p>
              </>
            )}
            {modal === "export" && (
              <>
                <p className="modal-intro">
                  A complete KSA content mod, generated in your browser. Your collection becomes one
                  selectable interstellar system.
                </p>
                <div className="export-stats">
                  <div>
                    <strong>{project.systems.length}</strong>
                    <span>star systems</span>
                  </div>
                  <div>
                    <strong>{bodyCount}</strong>
                    <span>celestial bodies</span>
                  </div>
                  <div>
                    <strong>100%</strong>
                    <span>original assets</span>
                  </div>
                </div>
                <label className="field">
                  <span>Cubemap face resolution</span>
                  <select
                    aria-label="Export texture resolution"
                    value={project.exportResolution}
                    onChange={(e) =>
                      commit(
                        (p) =>
                          (p.exportResolution = Number(
                            e.target.value,
                          ) as Project["exportResolution"]),
                      )
                    }
                  >
                    {[32, 64, 128, 256, 512].map((n) => (
                      <option key={n} value={n}>
                        {n} × {n}
                        {n === 32
                          ? " · draft"
                          : n === 128
                            ? " · balanced"
                            : n === 512
                              ? " · high detail"
                              : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="small-note">
                  Includes native biomes, independent clutter meshes and materials, cloud layer
                  maps, launch platforms, oceans, rings, XML, and your editable project. Each body
                  can override this resolution in Body settings. Export preflight limits archive
                  memory.
                </p>
                <p className="small-note">
                  Estimated source assets: {Math.ceil(estimateExportBytes(project) / 1024 / 1024)}{" "}
                  MB · browser budget {EXPORT_BUDGET_BYTES / 1024 / 1024} MB.
                </p>
                {estimateExportBytes(project) > EXPORT_BUDGET_BYTES && (
                  <p className="info-box">
                    This collection exceeds the browser export budget. Lower the collection
                    resolution or assign higher resolution only to selected worlds in Body settings.
                  </p>
                )}
                <div className="export-checklist">
                  <span>
                    <Check size={15} /> No borrowed celestial textures or models
                  </span>
                  <span>
                    <Check size={15} /> Native XML and asset paths checked
                  </span>
                  <span>
                    <Check size={15} /> Deterministic seeded generation
                  </span>
                </div>
                {issues.length > 0 && (
                  <div className="issue-list">
                    {issues.map((issue, i) => (
                      <p key={i} className={issue.severity}>
                        {issue.message}
                      </p>
                    ))}
                  </div>
                )}
                <div className="info-box">
                  Source-verified for KSA 2026.10.10.5554. Native game rendering has not been
                  tested. KSA’s engine and runtime shaders are still required.
                </div>
                {progress ? (
                  <div className="export-progress" role="status">
                    <span>{progress.message}</span>
                    <progress value={progress.value} max={1} />
                  </div>
                ) : (
                  <button
                    className="primary full export-submit"
                    disabled={
                      issues.some((i) => i.severity === "error") ||
                      estimateExportBytes(project) > EXPORT_BUDGET_BYTES
                    }
                    onClick={() => void doExport()}
                  >
                    <Download size={17} /> Generate & download ZIP
                  </button>
                )}
              </>
            )}
            {modal === "settings" && (
              <div className="modal-scroll">
                <Section title="Project">
                  <label className="field">
                    <span>Collection name</span>
                    <input
                      aria-label="Collection name"
                      value={project.name}
                      onChange={(e) => commit((p) => (p.name = e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span>Mod identifier</span>
                    <input
                      aria-label="Mod identifier"
                      value={project.id}
                      onChange={(e) => commit((p) => (p.id = e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span>Author</span>
                    <input
                      aria-label="Author"
                      value={project.author}
                      onChange={(e) => commit((p) => (p.author = e.target.value))}
                    />
                  </label>
                  <label className="text-area-field">
                    <span>Description</span>
                    <textarea
                      aria-label="Description"
                      value={project.description}
                      onChange={(e) => commit((p) => (p.description = e.target.value))}
                    />
                  </label>
                </Section>
                <Section title={`${system.name} · system`}>
                  <label className="field">
                    <span>System name</span>
                    <input
                      aria-label="System name"
                      value={system.name}
                      onChange={(e) =>
                        commit(
                          (p) => (p.systems.find((s) => s.id === system.id)!.name = e.target.value),
                        )
                      }
                    />
                  </label>
                  {system.position.map((v, i) => (
                    <Field
                      key={i}
                      label={`System position ${["X", "Y", "Z"][i]}`}
                      value={v}
                      unit="ly"
                      step={0.001}
                      onChange={(n) =>
                        commit((p) => (p.systems.find((s) => s.id === system.id)!.position[i] = n))
                      }
                    />
                  ))}
                  <button
                    className="subtle full"
                    onClick={() => {
                      setModal(null);
                      addBody("system");
                    }}
                  >
                    <Plus size={14} /> Add star system
                  </button>
                  <button
                    className="subtle full"
                    style={{ marginTop: 10 }}
                    disabled={project.systems.length <= 1}
                    onClick={() => setModal("deleteSystem")}
                  >
                    <Trash2 size={14} /> Delete this system
                  </button>
                </Section>
                <Section title="Interstellar medium">
                  <Field
                    label="Gas density"
                    value={project.interstellarGas}
                    min={0}
                    step={0.01}
                    unit="atoms/cm³"
                    onChange={(v) => commit((p) => (p.interstellarGas = v))}
                  />
                  <Field
                    label="Galactic right ascension"
                    value={project.galacticPlane.rightAscension}
                    unit="°"
                    step={0.01}
                    onChange={(v) => commit((p) => (p.galacticPlane.rightAscension = v))}
                  />
                  <Field
                    label="Galactic declination"
                    value={project.galacticPlane.declination}
                    unit="°"
                    step={0.01}
                    onChange={(v) => commit((p) => (p.galacticPlane.declination = v))}
                  />
                </Section>
              </div>
            )}
            {modal === "xml" && (
              <>
                <p className="modal-intro">
                  Live system definition. Asset references resolve inside the generated mod.
                </p>
                <pre className="xml-preview">{buildSystemXml(project)}</pre>
                <button
                  className="subtle"
                  onClick={() =>
                    download(
                      new Blob([buildSystemXml(project)], { type: "application/xml" }),
                      `${project.id}.xml`,
                    )
                  }
                >
                  <Download size={15} /> Download XML only
                </button>
              </>
            )}
            {modal === "delete" && (
              <>
                <p className="modal-intro">
                  This removes {body.name}
                  {descendants(body.id, system.bodies).length > 1
                    ? ` and its ${descendants(body.id, system.bodies).length - 1} orbiting bodies`
                    : ""}
                  . You can undo this change.
                </p>
                {system.bodies.filter(
                  (b) => b.kind === "star" && !descendants(body.id, system.bodies).includes(b.id),
                ).length === 0 ? (
                  <p className="info-box">
                    Keep at least one star in each system. Add a companion star before removing this
                    one.
                  </p>
                ) : (
                  <button
                    className="danger full"
                    onClick={() => {
                      const remove = descendants(body.id, system.bodies);
                      commit((p) => {
                        const s = p.systems.find((s) => s.id === system.id)!;
                        s.bodies = s.bodies.filter((b) => !remove.includes(b.id));
                      });
                      setBodyId(system.bodies.find((b) => !remove.includes(b.id))!.id);
                      setTab("physical");
                      setModal(null);
                    }}
                  >
                    <Trash2 size={16} /> Delete body
                  </button>
                )}
              </>
            )}
            {modal === "deleteSystem" && (
              <>
                <p className="modal-intro">
                  Remove {system.name} and its {system.bodies.length} bodies from this collection.
                  If this contains the home world, the first remaining rocky world becomes home. You
                  can undo this change.
                </p>
                <button
                  className="danger full"
                  disabled={project.systems.length <= 1}
                  onClick={() => {
                    const remaining = project.systems.find((s) => s.id !== system.id)!;
                    commit((p) => {
                      p.systems = p.systems.filter((s) => s.id !== system.id);
                      if (!p.systems.some((s) => s.bodies.some((b) => isPlanet(b) && b.homeBody))) {
                        const home = p.systems
                          .flatMap((s) => s.bodies)
                          .find((b) => b.kind === "rocky");
                        if (home && isPlanet(home)) home.homeBody = true;
                      }
                    });
                    setSystemId(remaining.id);
                    setBodyId(remaining.bodies[0].id);
                    setTab("physical");
                    setModal(null);
                  }}
                >
                  <Trash2 size={16} /> Delete entire system
                </button>
              </>
            )}
            {modal === "new" && (
              <>
                <p className="modal-intro">
                  Start from a single original star and home world, or explore the three-system
                  starter collection. Save your current project first if you want a separate backup.
                  Undo restores the previous collection.
                </p>
                <button className="primary full" onClick={() => startCollection(true)}>
                  <Sparkles size={16} /> Blank collection · one star and home world
                </button>
                <button
                  className="subtle full"
                  style={{ marginTop: 12 }}
                  onClick={() => startCollection(false)}
                >
                  <Orbit size={16} /> Starter collection · Sol, Barnard’s Star, Tau Ceti
                </button>
              </>
            )}
            {modal === "help" && (
              <>
                <p className="modal-intro">
                  Orbit Foundry is a browser workspace for original Kitten Space Agency solar
                  systems. Shape worlds, design stellar families, and export every celestial asset
                  from scratch.
                </p>
                <div className="help-grid">
                  <div>
                    <Globe2 />
                    <h3>Make a world</h3>
                    <p>
                      Shape seeded terrain and biomes; add clouds, oceans, rings and independent
                      clutter. Inspect original stock models, sample their terrain coverage, and
                      click the planet to place launch sites.
                    </p>
                  </div>
                  <div>
                    <Orbit />
                    <h3>Build a family</h3>
                    <p>
                      Add planets, moons, and companion stars. Edit full orbital elements and
                      preview their motion.
                    </p>
                  </div>
                  <div>
                    <Save />
                    <h3>Keep your work</h3>
                    <p>
                      Changes save locally. Save a project JSON for backup or sharing; Open restores
                      all settings.
                    </p>
                  </div>
                  <div>
                    <ArrowDownToLine />
                    <h3>Take it into KSA</h3>
                    <p>
                      Export a ZIP, place its folder in KSA’s user mods directory, enable it, then
                      select the new system.
                    </p>
                  </div>
                </div>
                <div className="info-box">
                  The 3D view is representative. System view options can switch from compressed to
                  real scale. Set Max days beside the simulation scrubber to explore longer orbital
                  periods. Native XML contracts were checked against the current decompiled build.
                  See the repository README and docs/research for source evidence, installation
                  paths, and rendering limitations.
                </div>
                <p className="small-note">
                  Keyboard: ⌘/Ctrl S saves · ⌘/Ctrl Z undoes · Shift ⌘/Ctrl Z redoes · Escape closes
                  dialogs.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
