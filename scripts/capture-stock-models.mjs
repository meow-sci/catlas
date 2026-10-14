// Reproducible close-up inspection of the browser's actual stock meshes/materials.
// Usage: STOCK_URL=http://127.0.0.1:5176 node scripts/capture-stock-models.mjs [output-directory]
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(process.argv[2] ?? "docs/screenshots/stock-detail");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /WebGL|THREE|shader/i.test(message.text()))
      errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.__THREE_DEVTOOLS__ = {
      dispatchEvent(event) {
        const renderer = event.detail;
        if (event.type !== "observe" || !renderer?.isWebGLRenderer) return;
        const render = renderer.render.bind(renderer);
        renderer.render = (scene, camera) => {
          render(scene, camera);
          window.stockFrame = [];
          window.stockPatch = null;
          scene.traverse((object) => {
            if (object.isInstancedMesh) {
              window.stockPatch = {
                name: object.name,
                drawn: object.count,
                lod: object.userData.clutterLod,
                triangles: (object.geometry.index.count / 3) * object.count,
              };
            }
            if (object.userData.clutterPreviewKind !== "asset") return;
            for (const mesh of object.children.filter((child) => child.isMesh)) {
              window.stockFrame.push({
                name: mesh.name,
                vertices: mesh.geometry.attributes.position.count,
                triangles: mesh.geometry.index.count / 3,
                textureSize: mesh.material.map.image.width,
                cutoutSize: mesh.material.alphaMap?.image.width ?? null,
                alphaCutoff: mesh.material.alphaTest,
                shadows: mesh.castShadow && mesh.receiveShadow && renderer.shadowMap.enabled,
              });
            }
          });
        };
      },
    };
  });
  await page.goto(process.env.STOCK_URL ?? "http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Clutter preview", exact: true }).click();
  const select = page.getByLabel("Clutter model", { exact: true });
  const assets = await select
    .locator("option")
    .evaluateAll((options) =>
      options
        .filter((option) => option.value !== "")
        .map((option) => ({ id: option.value, name: option.textContent })),
    );
  const reports = [];
  for (const asset of assets) {
    await select.selectOption(asset.id);
    const name = await page.getByLabel("Clutter name", { exact: true }).inputValue();
    await page.waitForFunction((name) => window.stockFrame?.[0]?.name === name, name);
    await page.waitForTimeout(300);
    await page.locator("canvas").screenshot({ path: `${output}/${asset.id}.png` });
    reports.push({ id: asset.id, ...(await page.evaluate(() => window.stockFrame[0])) });
  }
  const patches = [];
  for (const asset of assets.filter((asset) => asset.name.includes("groundcover"))) {
    await select.selectOption(asset.id);
    const name = await page.getByLabel("Clutter name", { exact: true }).inputValue();
    await page
      .getByRole("combobox", { name: "Clutter preview", exact: true })
      .selectOption("scatter");
    for (const sizeM of [20, 5]) {
      await page.getByLabel("Patch size", { exact: true }).fill(String(sizeM));
      await page.waitForFunction((name) => window.stockPatch?.name === `${name} scatter`, name);
      await page.waitForTimeout(300);
      await page
        .locator("canvas")
        .screenshot({ path: `${output}/${asset.id}-patch-${sizeM}m.png` });
      patches.push({
        id: asset.id,
        sizeM,
        ...(await page.evaluate(() => window.stockPatch)),
        summary: await page.getByTestId("clutter-preview-summary").textContent(),
      });
    }
  }
  const report = { browser: await browser.version(), errors, models: reports, patches };
  await writeFile(`${output}/capture.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
