import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

test("authors independent biomes, clutter, clouds and native launch destinations", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New collection", exact: true }).click();
  await page
    .getByRole("button", { name: "Blank collection · one star and home world", exact: true })
    .click();
  await page.getByRole("button", { name: "Biomes", exact: true }).click();
  await page.getByRole("button", { name: "Add biome", exact: true }).click();
  await page.getByLabel("Biome name", { exact: true }).fill("Amethyst flats");
  await page.getByLabel("Ground pattern", { exact: true }).selectOption("basalt");
  await page.getByLabel("Ground roughness", { exact: true }).fill("0.4");
  await page.getByRole("button", { name: "Clutter", exact: true }).click();
  await page.getByRole("button", { name: "Add clutter type", exact: true }).click();
  await page.getByLabel("Clutter name", { exact: true }).fill("Prism forest");
  await page.getByLabel("Geometry family", { exact: true }).selectOption("crystal");
  await page.getByLabel("Dimensions (m) Y", { exact: true }).fill("8");
  await page.getByLabel("Place in Amethyst flats", { exact: true }).check();
  await page.getByLabel("Object separation", { exact: true }).fill("22");
  await page.getByRole("button", { name: "Air", exact: true }).click();
  await page.getByRole("switch", { name: "Enable atmosphere", exact: true }).check();
  await page.getByRole("switch", { name: "Clouds enabled", exact: true }).check();
  await page.getByLabel("Cloud pattern", { exact: true }).selectOption("wispy");
  await page.getByLabel("Cloud base altitude", { exact: true }).fill("6");
  await page.getByRole("switch", { name: "Environment audio", exact: true }).check();
  await page.getByLabel("Loop duration", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Play audio preview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop audio preview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop audio preview", exact: true }).click();
  await page.getByRole("button", { name: "Sites", exact: true }).click();
  await page.getByLabel("Platform width", { exact: true }).fill("120");
  await page.getByRole("button", { name: "Add site", exact: true }).click();
  await page.getByLabel("Site name", { exact: true }).fill("Prism settlement");
  await page.getByLabel("Location category", { exact: true }).selectOption("city");
  await page.getByLabel("Site latitude", { exact: true }).fill("23");
  await page.getByRole("button", { name: "Body", exact: true }).last().click();
  await page.getByLabel("Body texture resolution", { exact: true }).selectOption("32");
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const json = JSON.parse(await readFile((await (await saved).path())!, "utf8"));
  const b = json.systems[0].bodies.find((b: any) => b.kind === "rocky");
  expect(b.surface.biomes.at(-1).ground).toMatchObject({ pattern: "basalt", roughness: 0.4 });
  expect(b.clutter).toHaveLength(2);
  expect(b.clutter[1]).toMatchObject({
    name: "Prism forest",
    geometry: { shape: "crystal", dimensionsM: [2.5, 8, 2.1] },
    distribution: { objectSeparationM: 22, biomeIds: [b.surface.biomes.at(-1).id] },
  });
  expect(b.clouds.layers[0].types[0].startAltitudeKm).toBe(6);
  expect(b.landmarks[0].sizeM[1]).toBe(120);
  expect(b.landmarks[1]).toMatchObject({ category: "city", launchPad: false, latitude: 23 });
  await page.getByRole("button", { name: "Export mod", exact: true }).click();
  await page.getByLabel("Export texture resolution", { exact: true }).selectOption("32");
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate & download ZIP", exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await exported).path())!));
  const xml = await zip.file("MyUniverse/Systems/MyUniverse.xml")!.async("string");
  const assets = await zip.file("MyUniverse/Assets.xml")!.async("string");
  expect(xml).toContain('<Biome IdMapIndex="3"');
  expect(xml).toContain("<Clouds>");
  expect(xml).toContain("<EnvironmentSound ");
  expect(zip.file("MyUniverse/Sounds/Homeworld_Environment.wav")).not.toBeNull();
  expect(xml).toContain('IsLaunchPad="true"');
  expect(xml).toContain("<City ");
  expect(assets).toContain("<StaticObject ");
  for (const [, path] of (xml + assets).matchAll(/\bPath="([^"]+)"/g))
    expect(zip.file("MyUniverse/" + path), path).not.toBeNull();
  expect(errors).toEqual([]);
});
