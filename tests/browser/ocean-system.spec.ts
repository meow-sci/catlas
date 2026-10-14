import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { readFile } from "node:fs/promises";
import { createProject } from "../../src/lib/project";
import { isPlanet, type Planet, type Project } from "../../src/lib/types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
});
const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /shader|webgl|gl_invalid/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Earth", exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

async function setControl(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  const type = await input.getAttribute("type");
  if (type === "range" || type === "color") {
    // Native setters let React receive the same input event as these browser widgets.
    await input.evaluate((element, next) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(element, next);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  } else {
    await input.fill(value);
  }
  await expect(input).toHaveValue(value);
}

async function exportArchive(page: Page) {
  await page.getByRole("button", { name: "Export mod", exact: true }).click();
  await page.getByLabel("Export texture resolution").selectOption("32");
  await expect(page.getByRole("button", { name: "Generate & download ZIP" })).toBeEnabled();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate & download ZIP" }).click();
  const downloaded = await event;
  return JSZip.loadAsync(await readFile((await downloaded.path())!));
}

test("authors an ocean, roundtrips every control, and exports its native mesh and wave settings", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Ocean", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Enable ocean" })).toBeChecked();
  const controls = {
    "Ocean level": "1.25",
    "Ocean color": "#336699",
    "Transparency depth": "85",
    "Minimum wind speed": "3",
    "Maximum wind speed": "18",
    "Minimum wind fetch": "45",
    "Maximum wind fetch": "900",
    "Wave depth": "250",
    "Wave directionality": "0.65",
    "Foam amount": "0.35",
    "Wave count": "4",
    "Wave length": "650",
    "Wave amplitude": "0.125",
    "Wave speed": "8.5",
    "Length persistence": "0.85",
    "Amplitude persistence": "1.01",
    "Speed persistence": "0.95",
  };
  for (const [label, value] of Object.entries(controls)) await setControl(page, label, value);
  const expectedOcean = {
    enabled: true,
    levelKm: 1.25,
    color: "#336699",
    transparencyDepthM: 85,
    windWaves: {
      minWindSpeed: 3,
      maxWindSpeed: 18,
      minWindFetchKm: 45,
      maxWindFetchKm: 900,
      depthM: 250,
      directionality: 0.65,
      foamAmount: 0.35,
    },
    gerstnerWaves: {
      count: 4,
      lengthM: 650,
      amplitude: 0.125,
      speed: 8.5,
      lengthPersistence: 0.85,
      amplitudePersistence: 1.01,
      speedPersistence: 0.95,
    },
  };
  const saveEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = await saveEvent;
  const savedPath = (await saved.path())!;
  const savedProject = JSON.parse(await readFile(savedPath, "utf8")) as Project;
  const earth = savedProject.systems[0].bodies.find((body) => body.id === "Earth");
  if (!earth || !isPlanet(earth)) throw new Error("Saved Earth is missing");
  expect(earth.ocean).toEqual(expectedOcean);

  await page.getByRole("switch", { name: "Enable ocean" }).uncheck();
  await page.locator("input[type=file]").setInputFiles(savedPath);
  await expect(page.locator(".toast")).toContainText("Opened The neighboring stars");
  await page.locator(".body-row").filter({ hasText: "Earth" }).click();
  await page.getByRole("button", { name: "Ocean", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Enable ocean" })).toBeChecked();
  for (const [label, value] of Object.entries(controls))
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);

  const zip = await exportArchive(page);
  const xml = await zip.file("OrbitFoundry/Systems/OrbitFoundry.xml")!.async("string");
  const system = parser.parse(xml).System;
  const bodies = Array.isArray(system.AtmosphericBody)
    ? system.AtmosphericBody
    : [system.AtmosphericBody];
  const exportedEarth = bodies.find(
    (body: Record<string, unknown>) => body["@_Id"] === "OrbitFoundry_Earth",
  );
  expect(exportedEarth.Ocean.Level).toEqual({ "@_Km": 1.25 });
  expect(exportedEarth.Ocean.Color).toEqual({ "@_R": 0.2, "@_G": 0.4, "@_B": 0.6 });
  expect(exportedEarth.Ocean.TransparencyDepth).toEqual({ "@_M": 85 });
  expect(exportedEarth.Ocean.WindWaves).toEqual({
    MinWindSpeed: { "@_Value": 3 },
    MaxWindSpeed: { "@_Value": 18 },
    MinWindFetch: { "@_Km": 45 },
    MaxWindFetch: { "@_Km": 900 },
    Directionality: { "@_Value": 0.65 },
    Depth: { "@_M": 250 },
    FoamAmount: { "@_Value": 0.35 },
  });
  expect(exportedEarth.Ocean.GerstnerWaves).toEqual({
    Count: { "@_Value": 4 },
    Length: { "@_M": 650 },
    Amplitude: { "@_Value": 0.125 },
    Speed: { "@_Value": 8.5 },
    LengthPersistence: { "@_Value": 0.85 },
    AmplitudePersistence: { "@_Value": 1.01 },
    SpeedPersistence: { "@_Value": 0.95 },
  });
  const meshes = parser.parse(
    await zip.file("OrbitFoundry/PlanetMeshes.xml")!.async("string"),
  ).PlanetMeshCollection;
  expect(exportedEarth.Ocean.MeshCollection["@_Id"]).toBe(meshes["@_Id"]);
  expect(
    Array.isArray(meshes.CubeMesh) ? meshes.CubeMesh.length : Number(!!meshes.CubeMesh),
  ).toBeGreaterThan(0);
  const exportedProject = JSON.parse(
    await zip.file("OrbitFoundry/project.json")!.async("string"),
  ) as Project;
  const exportedBody = exportedProject.systems[0].bodies.find((body) => body.id === "Earth");
  if (!exportedBody || !isPlanet(exportedBody)) throw new Error("Exported Earth is missing");
  expect(exportedBody.ocean).toEqual(expectedOcean);
});

test("shows one collection warning when the last ocean is disabled and clears it for an ocean in another system", async ({
  page,
}) => {
  const indicator = page.getByRole("button", { name: "Warnings and validation", exact: true });
  await expect(indicator).not.toHaveClass(/has-issues/);
  await page.getByRole("button", { name: "Ocean", exact: true }).click();
  await page.getByRole("switch", { name: "Enable ocean" }).uncheck();
  await expect(indicator).toHaveClass(/has-issues/);
  await expect(indicator).toHaveText("1");
  await indicator.click();
  const dialog = page.getByRole("dialog", { name: "Warnings and validation", exact: true });
  await expect(dialog.locator(".warning-item.warning")).toHaveCount(1);
  await expect(dialog).toContainText("at least one enabled ocean on a rocky body");
  await expect(dialog).toContainText("one ocean anywhere in this collection");
  await expect(dialog).toContainText("Warnings allow export");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Export mod", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Export KSA mod" }).locator(".issue-list .warning"),
  ).toContainText("at least one enabled ocean");
  await expect(page.getByRole("button", { name: "Generate & download ZIP" })).toBeEnabled();
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.locator(".system-card").filter({ hasText: "Barnard’s Star" }).click();
  await page.getByRole("button", { name: "Ocean", exact: true }).click();
  await page.getByRole("switch", { name: "Enable ocean" }).check();
  await expect(indicator).not.toHaveClass(/has-issues/);
  await expect(indicator).toHaveText("");
  await page.locator(".system-card").filter({ hasText: "Sol" }).click();
  await page.locator(".body-row").filter({ hasText: "Earth" }).click();
  await page.getByRole("button", { name: "Ocean", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Enable ocean" })).not.toBeChecked();
  await expect(indicator).not.toHaveClass(/has-issues/);

  await page.locator(".body-row").filter({ hasText: "Jupiter" }).click();
  await expect(page.getByRole("button", { name: "Ocean", exact: true })).toBeDisabled();
});

test("imports legacy projects without adding water and permits an explicitly warned dry export", async ({
  page,
}) => {
  const legacy = createProject();
  legacy.name = "Legacy dry collection";
  for (const system of legacy.systems)
    for (const body of system.bodies.filter(isPlanet)) delete (body as Partial<Planet>).ocean;
  await page.locator("input[type=file]").setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await expect(page.locator(".toast")).toContainText("Opened Legacy dry collection");
  await page.locator(".body-row").filter({ hasText: "Earth" }).click();
  await page.getByRole("button", { name: "Ocean", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Enable ocean" })).not.toBeChecked();
  await expect(page.getByLabel("Ocean level", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Warnings and validation", exact: true }),
  ).toHaveText("1");
  const zip = await exportArchive(page);
  expect(await zip.file("OrbitFoundry/Systems/OrbitFoundry.xml")!.async("string")).not.toContain(
    "<Ocean>",
  );
  const migrated = JSON.parse(
    await zip.file("OrbitFoundry/project.json")!.async("string"),
  ) as Project;
  const planets = migrated.systems.flatMap((system) => system.bodies).filter(isPlanet);
  expect(planets).toHaveLength(16);
  expect(planets.every((body) => body.ocean.enabled === false)).toBe(true);
});

test("keeps real scale selected across body and system views, systems, and camera resets", async ({
  page,
}) => {
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.locator(".preview-disclaimer")).toHaveText(
    "Distances and body sizes compressed",
  );
  await page.getByRole("button", { name: "View options", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "System view options", exact: true });
  await expect(dialog.getByRole("switch", { name: "Real scale" })).not.toBeChecked();
  await dialog.getByRole("switch", { name: "Real scale" }).check();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".preview-disclaimer")).toHaveText(
    "Real scale · physical distances and body sizes",
  );
  await expect(page.getByRole("button", { name: "View options", exact: true })).toHaveClass(
    /active/,
  );
  await page.locator(".view-toolbar").getByRole("button", { name: "Body", exact: true }).click();
  await expect(page.getByRole("button", { name: "View options", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "System", exact: true }).click();
  await page.locator(".system-card").filter({ hasText: "Tau Ceti" }).click();
  await page.getByRole("button", { name: "Reset camera" }).click();
  await expect(page.locator(".preview-disclaimer")).toHaveText(
    "Real scale · physical distances and body sizes",
  );
  await page.getByRole("button", { name: "View options", exact: true }).click();
  await expect(dialog.getByRole("switch", { name: "Real scale" })).toBeChecked();
  await dialog.getByRole("switch", { name: "Real scale" }).uncheck();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".preview-disclaimer")).toHaveText(
    "Distances and body sizes compressed",
  );
});

test("extends, scrubs, clamps, and resets the simulation horizon and restarts playback at its endpoint", async ({
  page,
}) => {
  const limit = page.getByLabel("Maximum simulation days", { exact: true });
  const scrubber = page.getByLabel("Simulation time", { exact: true });
  const time = page.locator(".time-value");
  await expect(limit).toHaveValue("3652.5");
  await expect(scrubber).toHaveAttribute("max", "3652.5");
  await limit.fill("100000");
  await expect(scrubber).toHaveAttribute("max", "100000");
  await setControl(page, "Simulation time", "100000");
  await expect(time).toHaveText("T + 100000.0 days");
  await limit.fill("40000");
  await expect(scrubber).toHaveValue("40000");
  await expect(time).toHaveText("T + 40000.0 days");
  await page.getByRole("button", { name: "Reset simulation time" }).click();
  await expect(scrubber).toHaveValue("0");
  await expect(time).toHaveText("T + 0.0 days");
  await expect(limit).toHaveValue("40000");

  await limit.fill("1");
  await page.getByRole("button", { name: "Play orbital simulation" }).click();
  await expect(scrubber).toHaveValue("1");
  await expect(time).toHaveText("T + 1.0 days");
  await expect(page.getByRole("button", { name: "Play orbital simulation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause orbital simulation" })).toHaveCount(0);
  // A longer horizon makes the restart observable before the next endpoint.
  await limit.fill("100");
  await setControl(page, "Simulation time", "100");
  await page.getByRole("button", { name: "Play orbital simulation" }).click();
  await expect(page.getByRole("button", { name: "Pause orbital simulation" })).toBeVisible();
  await page.getByRole("button", { name: "Pause orbital simulation" }).click();
  expect(Number(await scrubber.inputValue())).toBeLessThan(100);
  await page.getByRole("button", { name: "Reset simulation time" }).click();
  await expect(scrubber).toHaveValue("0");
  await expect(page.getByRole("button", { name: "Play orbital simulation" })).toBeVisible();
});
