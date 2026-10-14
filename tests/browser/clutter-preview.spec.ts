import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__THREE_DEVTOOLS__ = {
      dispatchEvent(event: any) {
        const renderer = event.detail;
        if (event.type !== "observe" || !renderer?.isWebGLRenderer) return;
        const render = renderer.render.bind(renderer);
        renderer.render = (scene: any, camera: any) => {
          render(scene, camera);
          const frame: any = { cameraFar: camera.far, assets: [] };
          scene.traverse((object: any) => {
            if (object.userData.clutterPreviewKind === "asset") {
              const asset = object.children.find((child: any) => child.isMesh);
              if (asset) frame.assets.push({ name: asset.name, scale: asset.scale.toArray() });
            }
            if (object.name === "Clutter terrain patch") {
              object.geometry.computeBoundingBox();
              const size = object.geometry.boundingBox.getSize(object.position.clone());
              frame.patch = { widthM: size.x, depthM: size.z };
            }
            if (object.isInstancedMesh) {
              frame.drawn = object.count;
              frame.scatter = {
                triangles: (object.geometry.index.count / 3) * object.count,
                lod: object.userData.clutterLod,
                cutoutSize: object.material.alphaMap?.image.width,
                alphaCutoff: object.material.alphaTest,
              };
            }
          });
          (window as any).__clutterPreviewFrame = frame;
        };
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Clutter preview", exact: true }).click();
  await expect(page.getByTestId("clutter-preview-summary")).toBeVisible();
});

async function setRange(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("isolates the selected asset at authored scale, including a disabled type, and retains library view", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const view = page.getByRole("combobox", { name: "Clutter preview", exact: true });
  await expect(view).toHaveValue("asset");
  await page.getByRole("button", { name: "Add clutter type", exact: true }).click();
  await page.getByLabel("Clutter name", { exact: true }).fill("Selected prism");
  await page.getByLabel("Geometry family", { exact: true }).selectOption("crystal");
  await page.getByLabel("Dimensions (m) Y", { exact: true }).fill("6");
  await page.getByLabel("Maximum scale X", { exact: true }).fill("3");
  await page.getByLabel("Minimum scale X", { exact: true }).fill("2");
  await page.getByRole("switch", { name: "Enable clutter type", exact: true }).uncheck();
  const summary = page.getByTestId("clutter-preview-summary");
  await expect(summary).toContainText("Selected prism · Selected asset · 2.5 × 6 × 2.1 m");
  await expect(summary).toContainText("disabled for scatter");
  await expect
    .poll(() => page.evaluate(() => (window as any).__clutterPreviewFrame.assets))
    .toEqual([{ name: "Selected prism", scale: [1, 1, 1] }]);
  await view.selectOption("library");
  await expect(summary).toContainText("Entire library · 1 enabled assets");
  await view.selectOption("asset");
  await expect(summary).toContainText("Selected prism · Selected asset");
  expect(errors).toEqual([]);
});

test("shows bounded physical scatter, responds to zero density, and fits a large patch", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("combobox", { name: "Clutter preview", exact: true })
    .selectOption("scatter");
  await page.getByLabel("Object separation", { exact: true }).fill("1");
  await setRange(page, "Clutter density", "1");
  const summary = page.getByTestId("clutter-preview-summary");
  await expect(summary).toContainText("500 × 500 m patch");
  await expect(summary).toContainText("preview capped at 256");
  await expect(summary).toContainText("4096 candidate samples");
  await expect
    .poll(() => page.evaluate(() => (window as any).__clutterPreviewFrame.patch))
    .toEqual({ widthM: 500, depthM: 500 });
  await expect
    .poll(() => page.evaluate(() => (window as any).__clutterPreviewFrame.drawn))
    .toBe(256);
  await setRange(page, "Clutter density", "0");
  await expect(summary).toContainText("0 drawn · ~0 estimated eligible");
  await expect.poll(() => page.evaluate(() => (window as any).__clutterPreviewFrame.drawn)).toBe(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).__clutterPreviewFrame.patch))
    .toEqual({ widthM: 500, depthM: 500 });
  await page.getByLabel("Patch size", { exact: true }).fill("5000");
  await expect(summary).toContainText("5000 × 5000 m patch");
  await expect
    .poll(() => page.evaluate(() => (window as any).__clutterPreviewFrame.patch))
    .toEqual({ widthM: 5000, depthM: 5000 });
  await expect
    .poll(() => page.evaluate(() => (window as any).__clutterPreviewFrame.cameraFar))
    .toBeGreaterThan(5000);
  expect(errors).toEqual([]);
});

test("keeps dense stock foliage within a practical triangle budget with full cutout detail", async ({
  page,
}) => {
  await page.getByLabel("Clutter model", { exact: true }).selectOption("wind_pine");
  await page
    .getByRole("combobox", { name: "Clutter preview", exact: true })
    .selectOption("scatter");
  await page.getByLabel("Object separation", { exact: true }).fill("1");
  await setRange(page, "Clutter density", "1");
  await expect
    .poll(() => page.evaluate(() => (window as any).__clutterPreviewFrame.drawn))
    .toBe(256);
  const frame = await page.evaluate(() => (window as any).__clutterPreviewFrame.scatter);
  expect(frame.triangles).toBeLessThanOrEqual(600_000);
  expect(frame.lod).toBe(4);
  expect(frame.cutoutSize).toBe(512);
  expect(frame.alphaCutoff).toBe(0.4);
});

test("shows dense grass coverage on close terrain patches with Earth and alien variants", async ({
  page,
}) => {
  const model = page.getByLabel("Clutter model", { exact: true });
  await model.selectOption("meadow_grass");
  await page
    .getByRole("combobox", { name: "Clutter preview", exact: true })
    .selectOption("scatter");
  await expect(page.getByLabel("Patch size", { exact: true })).toHaveValue("20");
  await expect(page.getByTestId("clutter-preview-summary")).toContainText("20 × 20 m patch");
  await expect
    .poll(() => page.evaluate(() => (window as any).__clutterPreviewFrame.drawn))
    .toBeGreaterThan(256);
  expect(
    await page.evaluate(() => (window as any).__clutterPreviewFrame.scatter.triangles),
  ).toBeLessThanOrEqual(600_000);
  await page.getByLabel("Patch size", { exact: true }).fill("5");
  await expect
    .poll(() => page.evaluate(() => (window as any).__clutterPreviewFrame.patch))
    .toEqual({ widthM: 5, depthM: 5 });
  await model.selectOption("alien_ribbon_grass");
  await expect(page.getByTestId("clutter-preview-summary")).toContainText("Alien ribbon grass");
  await expect
    .poll(() => page.evaluate(() => (window as any).__clutterPreviewFrame.drawn))
    .toBeGreaterThan(256);
});
