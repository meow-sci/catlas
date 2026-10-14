import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { importedClutterFixture, fixtureGlbJson } from "../fixtures/imported-clutter";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__THREE_DEVTOOLS__ = {
      dispatchEvent(event: any) {
        const renderer = event.detail;
        if (event.type !== "observe" || !renderer?.isWebGLRenderer) return;
        const render = renderer.render.bind(renderer);
        renderer.render = (scene: any, camera: any) => {
          render(scene, camera);
          scene.traverse((object: any) => {
            if (!object.isMesh || !Array.isArray(object.material)) return;
            (window as any).__importedFrame = {
              name: object.name,
              groups: object.geometry.groups,
              vertices: object.geometry.getAttribute("position").count,
              materials: object.material.map((m: any) => ({
                size: m.map.image.width,
                first: Array.from(m.map.image.data.slice(0, 4)),
                lastRow: Array.from(
                  m.map.image.data.slice(
                    (m.map.image.height - 1) * m.map.image.width * 4,
                    (m.map.image.height - 1) * m.map.image.width * 4 + 4,
                  ),
                ),
                alphaCutoff: m.alphaTest,
                opacityFirst: m.alphaMap?.image.data[0],
                side: m.side,
                flipY: m.map.flipY,
              })),
            };
          });
        };
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Clutter preview", exact: true }).click();
});

test("imports two textured materials at authored scale, supports undo/save/reimport and closes native export references", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByLabel("GLB file", { exact: true }).setInputFiles({
    name: "two-materials.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from(await importedClutterFixture()),
  });
  await expect(page.getByTestId("glb-import-status")).toContainText("2 triangles, 2 materials");
  await expect(page.getByLabel("Clutter model", { exact: true })).toHaveValue("imported");
  await expect(page.getByTestId("clutter-preview-summary")).toContainText("2 × 3 × 4 m");
  await expect
    .poll(() => page.evaluate(() => (window as any).__importedFrame?.materials.length))
    .toBe(2);
  const frame = await page.evaluate(() => (window as any).__importedFrame);
  expect(frame.groups.map((g: any) => g.materialIndex)).toEqual([0, 1]);
  expect(frame.vertices).toBe(6);
  expect(frame.materials[0].first).toEqual([255, 32, 16, 255]);
  expect(frame.materials[0].lastRow).toEqual([16, 48, 255, 255]);
  expect(frame.materials[1].first[0]).toBe(188);
  expect(frame.materials[1].opacityFirst).toBe(0);
  expect(frame.materials[1].alphaCutoff).toBe(0.4);
  expect(frame.materials[1].side).toBe(2);
  expect(frame.materials.every((m: any) => !m.flipY)).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Clutter model", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByLabel("Clutter model", { exact: true })).toHaveValue("imported");
  const savedEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = await savedEvent,
    savedBytes = await readFile((await saved.path())!),
    project = JSON.parse(savedBytes.toString());
  const earth = project.systems[0].bodies.find((b: any) => b.id === "Earth"),
    type = earth.clutter[0];
  expect(type.importedAsset.materials).toHaveLength(2);
  expect(type.importedAsset.geometry.positions).toBeTruthy();
  await page.getByLabel("Clutter model", { exact: true }).selectOption("wind_pine");
  await page
    .getByLabel("Open project file", { exact: true })
    .setInputFiles({ name: "import.orbit.json", mimeType: "application/json", buffer: savedBytes });
  await expect(page.locator(".toast")).toContainText("Opened");
  await page.locator(".body-row").filter({ hasText: "Earth" }).click();
  await page.getByRole("button", { name: "Clutter preview", exact: true }).click();
  await expect(page.getByLabel("Clutter model", { exact: true })).toHaveValue("imported");
  await page.getByRole("button", { name: "Export mod", exact: true }).click();
  await page.getByLabel("Export texture resolution").selectOption("32");
  const exportedEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate & download ZIP" }).click();
  const exported = await exportedEvent,
    zip = await JSZip.loadAsync(await readFile((await exported.path())!)),
    root = project.id + "/";
  const catalog = await zip.file(root + "Assets.xml")!.async("string");
  for (const match of catalog.matchAll(/Path="([^"]+)"/g))
    expect(zip.file(root + match[1]), match[1]).not.toBeNull();
  const atlasPath = /Path="(Meshes\/Earth_Clutter_[^"]+\.glb)"/.exec(catalog)![1];
  const glb = fixtureGlbJson(await zip.file(root + atlasPath)!.async("uint8array"));
  expect(glb.meshes).toHaveLength(5);
  for (const lod of glb.meshes)
    expect(lod.primitives.map((p: any) => glb.accessors[p.attributes.POSITION].count)).toEqual([
      3, 3,
    ]);
  expect(errors).toEqual([]);
});

test("autosaves imported texture data above the localStorage quota and retains the prior model after a rejected file", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByLabel("GLB file", { exact: true }).setInputFiles({
    name: "large-two-materials.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from(await importedClutterFixture(undefined, 512)),
  });
  await expect(page.getByTestId("glb-import-status")).toContainText("2 triangles, 2 materials");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const length = await page.evaluate(async () => {
    const moduleUrl = "/src/lib/autosave.ts",
      storage = await import(moduleUrl);
    return (await storage.readAutosavedProject()).length;
  });
  expect(length).toBeGreaterThan(5 * 1024 * 1024);
  expect(await page.evaluate(() => localStorage.getItem("orbit-foundry.project.v1"))).toBeNull();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Earth", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clutter preview", exact: true }).click();
  await expect(page.getByLabel("Clutter model", { exact: true })).toHaveValue("imported");
  await expect
    .poll(() => page.evaluate(() => (window as any).__importedFrame?.materials[0]?.size))
    .toBe(512);
  await page.getByLabel("GLB file", { exact: true }).setInputFiles({
    name: "external.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from(
      await importedClutterFixture(
        (j) => (j.buffers[0].uri = "https://invalid.example/buffer.bin"),
      ),
    ),
  });
  await expect(page.getByTestId("glb-import-status")).toContainText(
    "URI resources are unsupported",
  );
  await expect(page.getByLabel("Clutter name", { exact: true })).toHaveValue("large-two-materials");
  await expect(page.getByLabel("Clutter model", { exact: true })).toHaveValue("imported");
  expect(errors).toEqual([]);
});

test("restores a newer local fallback ahead of stale IndexedDB and serializes delayed writes", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const moduleUrl = "/src/lib/autosave.ts",
      storage = await import(moduleUrl);
    await storage.writeAutosavedProject("old IndexedDB project");
    localStorage.setItem(storage.AUTOSAVE_KEY, "new fallback project");
    const restored = await storage.readAutosavedProject();
    const nativeOpen = indexedDB.open.bind(indexedDB);
    let first = true;
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: (name: string, version: number) => {
        if (!first) return nativeOpen(name, version);
        first = false;
        const wrapper: any = {};
        setTimeout(() => {
          const request = nativeOpen(name, version);
          request.onsuccess = () => {
            wrapper.result = request.result;
            wrapper.onsuccess?.();
          };
          request.onerror = () => {
            wrapper.error = request.error;
            wrapper.onerror?.();
          };
        }, 100);
        return wrapper;
      },
    });
    await Promise.all([
      storage.writeAutosavedProject("older delayed write"),
      storage.writeAutosavedProject("newest write"),
    ]);
    delete (indexedDB as any).open;
    return {
      restored,
      latest: await storage.readAutosavedProject(),
      fallback: localStorage.getItem(storage.AUTOSAVE_KEY),
    };
  });
  expect(result).toEqual({
    restored: "new fallback project",
    latest: "newest write",
    fallback: null,
  });
});

test("shows autosave failure truthfully and keeps a self-contained downloadable project", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: () => {
        throw new DOMException("Storage is full", "QuotaExceededError");
      },
    });
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    };
  });
  await page.reload();
  await page.getByRole("button", { name: "Clutter preview", exact: true }).click();
  await page
    .getByLabel("GLB file", { exact: true })
    .setInputFiles({
      name: "recoverable.glb",
      mimeType: "model/gltf-binary",
      buffer: Buffer.from(await importedClutterFixture()),
    });
  await expect(page.getByTestId("glb-import-status")).toContainText("2 triangles, 2 materials");
  await expect(page.getByText("Autosave unavailable · save a file", { exact: true })).toBeVisible();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const downloaded = await event,
    project = JSON.parse(await readFile((await downloaded.path())!, "utf8"));
  expect(
    project.systems[0].bodies.find((b: any) => b.id === "Earth").clutter[0].importedAsset.materials,
  ).toHaveLength(2);
});

test("rejects collection-wide import and duplication excess before replacing the saved project", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const buffer = Buffer.from(await importedClutterFixture());
  await page.getByLabel("GLB file", { exact: true }).setInputFiles({
    name: "first.glb",
    mimeType: "model/gltf-binary",
    buffer,
  });
  await expect(page.getByTestId("glb-import-status")).toContainText("2 triangles, 2 materials");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const moduleUrls = await page.evaluate(() => {
    const loadedUrl = (path: string) => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => new URL(name).pathname === path)
        .at(-1);
      if (!url) throw new Error(`The app did not load ${path}`);
      return url;
    };
    // Preserve Vite's HMR timestamp: the plain path can create a second module instance.
    return {
      storageUrl: loadedUrl("/src/lib/autosave.ts"),
      importedUrl: loadedUrl("/src/lib/imported-clutter.ts"),
      projectUrl: loadedUrl("/src/lib/project.ts"),
    };
  });
  const original = await page.evaluate(
    async ({ storageUrl, importedUrl, projectUrl }) => {
      const storage = await import(storageUrl),
        imported = await import(importedUrl),
        projectTools = await import(projectUrl),
        text = (await storage.readAutosavedProject())!,
        project = JSON.parse(text);
      // Exercise the real commit boundary with a scaled limit, avoiding a 96 MB browser fixture.
      imported.IMPORTED_LIMITS.projectBytes = projectTools.importedProjectBytes(project) * 2 - 1;
      return text;
    },
    moduleUrls,
  );
  const options = page.getByLabel("Selected clutter type", { exact: true }).locator("option"),
    count = await options.count(),
    bodyCount = await page.locator(".body-row").count();
  await page.getByRole("button", { name: "Duplicate clutter type", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("96 MB project budget");
  await expect(options).toHaveCount(count);
  await page.getByRole("button", { name: "Duplicate body", exact: true }).click();
  await expect(page.locator(".body-row")).toHaveCount(bodyCount);
  await page.locator(".body-row").filter({ hasText: "Venus" }).click();
  const priorModel = await page.getByLabel("Clutter model", { exact: true }).inputValue();
  await page.getByLabel("GLB file", { exact: true }).setInputFiles({
    name: "second.glb",
    mimeType: "model/gltf-binary",
    buffer,
  });
  await expect(page.getByTestId("glb-import-status")).toContainText(
    "Could not import model: Imported model data exceeds the 96 MB project budget",
  );
  await expect(page.getByLabel("Clutter model", { exact: true })).toHaveValue(priorModel);
  const result = await page.evaluate(
    async ({ storageUrl, projectUrl }) => {
      const storage = await import(storageUrl),
        projectTools = await import(projectUrl),
        text = (await storage.readAutosavedProject())!;
      projectTools.parseProject(text);
      return text;
    },
    moduleUrls,
  );
  expect(result).toBe(original);
  expect(errors).toEqual([]);
});

async function holdNextImageDecode(page: Page) {
  await page.evaluate(() => {
    const nativeDecode = window.createImageBitmap.bind(window);
    let first = true;
    (window as any).__decodedImportImages = 0;
    window.createImageBitmap = async (...args: any[]) => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => {
          (window as any).__releaseImportDecode = resolve;
        });
      }
      const bitmap = await (nativeDecode as any)(...args);
      (window as any).__decodedImportImages++;
      return bitmap;
    };
  });
}

test("a pending import cannot replace a newly selected model", async ({ page }) => {
  await holdNextImageDecode(page);
  await page.getByLabel("GLB file", { exact: true }).setInputFiles({
    name: "delayed.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from(await importedClutterFixture()),
  });
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__releaseImportDecode))
    .toBe(true);
  await page.getByLabel("Clutter model", { exact: true }).selectOption("wind_pine");
  await page.evaluate(() => (window as any).__releaseImportDecode());
  await expect(page.getByTestId("glb-import-status")).toContainText(
    "selected type or model changed during import",
  );
  await expect(page.getByLabel("Clutter model", { exact: true })).toHaveValue("wind_pine");
  await expect(page.getByLabel("Clutter name", { exact: true })).not.toHaveValue("delayed");
});

test("returning to the original type does not revive an import canceled by type navigation", async ({
  page,
}) => {
  await holdNextImageDecode(page);
  await page.getByLabel("GLB file", { exact: true }).setInputFiles({
    name: "canceled.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from(await importedClutterFixture()),
  });
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__releaseImportDecode))
    .toBe(true);
  await page.getByRole("button", { name: "Add clutter type", exact: true }).click();
  await page.getByLabel("Selected clutter type", { exact: true }).selectOption("0");
  await page.evaluate(() => (window as any).__releaseImportDecode());
  await expect(page.getByTestId("glb-import-status")).toContainText(
    "selected type or model changed during import",
  );
  await expect(page.getByLabel("Clutter model", { exact: true })).toHaveValue("");
});

test("a pending import cannot overwrite an opened project with matching body and type IDs", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const download = await event,
    replacement = JSON.parse(await readFile((await download.path())!, "utf8"));
  replacement.name = "Replacement collection";
  const earth = replacement.systems[0].bodies.find((b: any) => b.id === "Earth");
  earth.clutter[0].name = "Replacement model";
  await holdNextImageDecode(page);
  await page.getByLabel("GLB file", { exact: true }).setInputFiles({
    name: "stale.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from(await importedClutterFixture()),
  });
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__releaseImportDecode))
    .toBe(true);
  await page.getByLabel("Open project file", { exact: true }).setInputFiles({
    name: "replacement.orbit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(replacement)),
  });
  await expect(page.locator(".toast")).toContainText("Opened Replacement collection");
  await page.evaluate(() => (window as any).__releaseImportDecode());
  await expect
    .poll(() => page.evaluate(() => (window as any).__decodedImportImages))
    .toBe(4);
  await page.locator(".body-row").filter({ hasText: "Earth" }).click();
  await page.getByRole("button", { name: "Clutter preview", exact: true }).click();
  await expect(page.getByLabel("Clutter name", { exact: true })).toHaveValue("Replacement model");
  await expect(page.getByLabel("Clutter model", { exact: true })).toHaveValue("");
  expect(errors).toEqual([]);
});
