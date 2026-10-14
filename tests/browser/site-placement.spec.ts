import { test, expect, type Page } from "@playwright/test";

const statusText = "Click the planet to place this site · Esc to cancel";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__THREE_DEVTOOLS__ = {
      dispatchEvent(event: any) {
        const renderer = event.detail;
        if (event.type !== "observe" || !renderer?.isWebGLRenderer) return;
        const render = renderer.render.bind(renderer);
        renderer.render = (scene: any, camera: any) => {
          render(scene, camera);
          (window as any).__siteCameraFrame = {
            position: camera.position.toArray(),
            quaternion: camera.quaternion.toArray(),
          };
          const terrain = scene.children.find(
            (object: any) => object.userData.rockyTerrain && object.userData.surface,
          );
          if (terrain)
            (window as any).__sitePreview = { terrain, camera, canvas: renderer.domElement };
        };
      },
    };
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Earth", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sites", exact: true }).click();
  await expect(page.getByRole("button", { name: "Place on planet", exact: true })).toBeVisible();
});

async function frame(page: Page) {
  return page.evaluate(() => (window as any).__siteCameraFrame);
}

async function pointOnPlanet(page: Page, latitude: number, longitude: number, radius = 2) {
  return page.evaluate(
    ({ latitude, longitude, radius }) => {
      const { terrain, camera, canvas } = (window as any).__sitePreview;
      const lat = (latitude * Math.PI) / 180,
        lon = (longitude * Math.PI) / 180;
      const author = terrain.position
        .clone()
        .set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
        .multiplyScalar(radius);
      const projected = terrain.localToWorld(author).project(camera),
        bounds = canvas.getBoundingClientRect();
      return {
        x: bounds.left + ((projected.x + 1) * bounds.width) / 2,
        y: bounds.top + ((1 - projected.y) * bounds.height) / 2,
      };
    },
    { latitude, longitude, radius },
  );
}

test("ignores a visible ring outside the terrain silhouette", async ({ page }) => {
  await page.getByRole("button", { name: "Rings", exact: true }).click();
  await page.getByRole("switch", { name: "Enable rings", exact: true }).check();
  await page.getByRole("button", { name: "Sites", exact: true }).click();
  await page.waitForTimeout(250);
  const point = await pointOnPlanet(page, 0, 0, 4),
    before = await frame(page);
  const latitude = await page.getByLabel("Site latitude", { exact: true }).inputValue();
  const longitude = await page.getByLabel("Site longitude", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Place on planet", exact: true }).click();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole("status").filter({ hasText: statusText })).toBeVisible();
  await expect(page.getByLabel("Site latitude", { exact: true })).toHaveValue(latitude);
  await expect(page.getByLabel("Site longitude", { exact: true })).toHaveValue(longitude);
  expect(await frame(page)).toEqual(before);
  await page.keyboard.press("Escape");
});

test("places the selected site on rotated terrain in native coordinates without moving the camera", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Surface", exact: true }).click();
  await page.getByLabel("Relief", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Sites", exact: true }).click();
  await page.getByLabel("Site latitude", { exact: true }).fill("0");
  await page.getByLabel("Site longitude", { exact: true }).fill("0");
  await page.waitForTimeout(250);
  const point = await pointOnPlanet(page, 20, -80),
    before = await frame(page);
  await page.getByRole("button", { name: "Place on planet", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: statusText })).toBeVisible();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole("status").filter({ hasText: statusText })).toHaveCount(0);
  expect(Number(await page.getByLabel("Site latitude", { exact: true }).inputValue())).toBeCloseTo(
    20,
    0,
  );
  expect(Number(await page.getByLabel("Site longitude", { exact: true }).inputValue())).toBeCloseTo(
    -80,
    0,
  );
  expect(await frame(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("rejects empty space and secondary clicks and restores controls after Escape or repeated placement", async ({
  page,
}) => {
  await page.waitForTimeout(250);
  const latitude = await page.getByLabel("Site latitude", { exact: true }).inputValue();
  const longitude = await page.getByLabel("Site longitude", { exact: true }).inputValue();
  const canvas = page.locator(".viewport canvas"),
    bounds = (await canvas.boundingBox())!;
  const before = await frame(page);
  await page.getByRole("button", { name: "Place on planet", exact: true }).click();
  await page.mouse.click(bounds.x + 12, bounds.y + bounds.height - 12);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
    button: "right",
  });
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 150);
  await expect(page.getByRole("status").filter({ hasText: statusText })).toBeVisible();
  await expect(page.getByLabel("Site latitude", { exact: true })).toHaveValue(latitude);
  await expect(page.getByLabel("Site longitude", { exact: true })).toHaveValue(longitude);
  expect(await frame(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status").filter({ hasText: statusText })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Place on planet", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Place on planet", exact: true }).click();
  await page.getByRole("button", { name: "Cancel placement", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: statusText })).toHaveCount(0);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 150);
  await expect.poll(() => frame(page)).not.toEqual(before);
});

test("cancels placement when switching body or preview mode", async ({ page }) => {
  await page.getByRole("button", { name: "Place on planet", exact: true }).click();
  await page.locator(".body-row").filter({ hasText: "Mercury" }).click();
  await expect(page.getByRole("status").filter({ hasText: statusText })).toHaveCount(0);
  await page.locator(".body-row").filter({ hasText: "Earth" }).click();
  await page.getByRole("button", { name: "Place on planet", exact: true }).click();
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: statusText })).toHaveCount(0);
  await page.locator(".view-toolbar").getByRole("button", { name: "Body", exact: true }).click();
  await expect(page.getByRole("button", { name: "Place on planet", exact: true })).toBeVisible();
});
