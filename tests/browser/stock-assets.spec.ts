import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

test("authors independent Blender stock models and exports their five native mesh LODs", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New collection", exact: true }).click();
  await page
    .getByRole("button", { name: "Blank collection · one star and home world", exact: true })
    .click();
  await page.getByRole("button", { name: "Clutter", exact: true }).click();
  await expect(page.getByLabel("Clutter model").locator("option")).toHaveCount(26);
  await page.getByLabel("Clutter model", { exact: true }).selectOption("wind_pine");
  await page.getByLabel("Clutter name", { exact: true }).fill("Copper pines");
  await page.getByLabel("Dimensions (m) Y", { exact: true }).fill("18");
  await page.getByLabel("Palette tint", { exact: true }).fill("#d5eadf");
  await expect(page.getByLabel("Geometry family", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add clutter type", exact: true }).click();
  await page.getByLabel("Clutter model", { exact: true }).selectOption("alien_lantern");
  await page.getByLabel("Clutter density", { exact: true }).fill("0.15");
  await page.getByRole("button", { name: "Clutter preview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Amber lantern plant", exact: true }),
  ).toBeVisible();
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const source = JSON.parse(await readFile((await (await saved).path())!, "utf8"));
  const body = source.systems[0].bodies.find((body: any) => body.kind === "rocky");
  expect(body.clutter[0]).toMatchObject({
    stockAssetId: "wind_pine",
    name: "Copper pines",
    material: { color: "#d5eadf", secondaryColor: "#ffffff" },
  });
  expect(body.clutter[0].geometry.dimensionsM[1]).toBe(18);
  expect(body.clutter[1]).toMatchObject({
    stockAssetId: "alien_lantern",
    distribution: { density: 0.15 },
  });
  await page.getByRole("button", { name: "Export mod", exact: true }).click();
  await page.getByLabel("Export texture resolution", { exact: true }).selectOption("32");
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate & download ZIP", exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await exported).path())!));
  for (const type of body.clutter) {
    const glb = await zip
      .file(`MyUniverse/Meshes/Homeworld_Clutter_${type.id}.glb`)!
      .async("uint8array");
    const jsonLength = new DataView(glb.buffer, glb.byteOffset, glb.byteLength).getUint32(12, true);
    const model = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLength)));
    expect(model.meshes).toHaveLength(5);
    expect(new Set(model.meshes.map((mesh: any) => mesh.name)).size).toBe(5);
  }
  expect(errors).toEqual([]);
});
