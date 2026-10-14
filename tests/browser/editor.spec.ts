import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

test("authors worlds, stars, rings, restores projects, and exports a closed native mod", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Earth", exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  const startingSeed = await page.getByLabel("Surface seed", { exact: true }).inputValue();
  await page.getByLabel("Surface seed", { exact: true }).fill("123");
  await page.getByLabel("Surface seed", { exact: true }).fill("124");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Surface seed", { exact: true })).toHaveValue("123");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Surface seed", { exact: true })).toHaveValue(startingSeed);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByLabel("Surface seed", { exact: true })).toHaveValue("123");
  await page.getByLabel("Surface seed", { exact: true }).fill("12579");
  await page.getByRole("button", { name: "Add occurrence", exact: true }).click();
  await page.getByLabel("Occurrence 1 name").fill("Copper seams");
  await page.getByRole("button", { name: "Body", exact: true }).last().click();
  await page.getByLabel("Body name", { exact: true }).fill("Verdant");
  await page.getByLabel("Body identifier", { exact: true }).fill("Verdant");
  await page.getByRole("button", { name: "Rings", exact: true }).click();
  await page.getByRole("switch", { name: "Enable rings" }).check();
  await page.getByLabel("Outer radius", { exact: true }).fill("2.8");
  await page.getByRole("button", { name: "Add body", exact: true }).click();
  await page.getByRole("button", { name: "Moon", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New moon", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Body", exact: true }).last().click();
  await expect(page.getByLabel("Parent", { exact: true })).toHaveValue("Verdant");
  await page.locator(".body-row").filter({ hasText: "Sol" }).first().click();
  await page.getByRole("button", { name: "Add body", exact: true }).click();
  await page.getByRole("button", { name: "Companion star", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Barycentric orbit" })).toBeChecked();
  await page.getByRole("button", { name: "Play orbital simulation" }).click();
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "Pause orbital simulation" }).click();
  await expect(page.locator(".time-value")).not.toHaveText("T + 0.0 days");
  await page.getByRole("button", { name: "Collection settings", exact: true }).click();
  await page.getByLabel("Collection name", { exact: true }).fill("Test neighboring worlds");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const saveEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = await saveEvent;
  const projectPath = await saved.path();
  expect(projectPath).toBeTruthy();
  const savedProject = JSON.parse(await readFile(projectPath!, "utf8"));
  expect(savedProject.systems[0].bodies.find((b: any) => b.id === "Verdant").surface.seed).toBe(
    12579,
  );
  expect(savedProject.systems[0].bodies.find((b: any) => b.name === "New moon").parentId).toBe(
    "Verdant",
  );
  await page.reload();
  await expect(page.locator(".project-title")).toContainText("Test neighboring worlds");
  await page.locator("input[type=file]").setInputFiles(projectPath!);
  await expect(page.locator(".toast")).toContainText("Opened Test neighboring worlds");
  await page.getByRole("button", { name: "Export mod", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate & download ZIP" })).toBeEnabled();
  await page.getByLabel("Export texture resolution").selectOption("32");
  const exportEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate & download ZIP" }).click();
  const exported = await exportEvent;
  const zip = await JSZip.loadAsync(await readFile((await exported.path())!));
  const root = "OrbitFoundry/";
  const xml = await zip.file(root + "Systems/OrbitFoundry.xml")!.async("string");
  expect(xml).toContain("<Barycenter");
  expect(xml).toContain('Parent="OrbitFoundry_Verdant"');
  expect(xml).toContain("<Rings");
  expect(xml).not.toContain("Core:");
  const xmlFiles = Object.keys(zip.files).filter((f) => f.endsWith(".xml"));
  for (const file of xmlFiles) {
    const text = await zip.file(file)!.async("string");
    for (const match of text.matchAll(/Path="([^"]+)"/g))
      expect(zip.file(root + match[1]), `${file}: ${match[1]}`).not.toBeNull();
  }
  expect(errors).toEqual([]);
});

test("rejects malformed imports, prevents invalid export, and stays usable on narrow screens", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":1,"systems":[{}],"name":"broken"}'),
  });
  await expect(page.locator(".toast")).toContainText("Could not open project");
  await page.getByRole("button", { name: "Body", exact: true }).last().click();
  await page.getByLabel("Mean radius", { exact: true }).fill("-1");
  await page.getByRole("button", { name: "Export mod", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate & download ZIP" })).toBeDisabled();
  await expect(page.locator(".issue-list")).toContainText("radius");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.setViewportSize({ width: 620, height: 900 });
  await expect(page.getByRole("button", { name: "Export mod", exact: true })).toBeVisible();
  await expect(page.locator(".inspector")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test("starts from scratch and removes unwanted star systems", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New collection", exact: true }).click();
  await page
    .getByRole("button", { name: "Blank collection · one star and home world", exact: true })
    .click();
  await expect(page.locator(".system-card")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Homeworld", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add body", exact: true }).click();
  await page.getByRole("button", { name: "Star system", exact: true }).click();
  await expect(page.locator(".system-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Collection settings", exact: true }).click();
  await page.getByRole("button", { name: "Delete this system", exact: true }).click();
  await page.getByRole("button", { name: "Delete entire system", exact: true }).click();
  await expect(page.locator(".system-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Export mod", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate & download ZIP" })).toBeEnabled();
});
