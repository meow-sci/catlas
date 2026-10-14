import { test, expect, type Page } from "@playwright/test";

type Frame = {
  centerError: number;
  position: number[];
  offset: number[];
};

async function bodyFrame(page: Page, id: string): Promise<Frame | null> {
  return page.evaluate((bodyId) => (window as any).__cameraFrames?.[bodyId] ?? null, id);
}

async function expectCentered(page: Page, id: string) {
  await expect
    .poll(async () => (await bodyFrame(page, id))?.centerError ?? Infinity)
    .toBeLessThan(1e-6);
}

for (const realScale of [false, true]) {
  test(`system camera follows the selected body in ${realScale ? "real" : "compressed"} scale`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    // Observe actual rendered body/camera transforms through Three's devtools hook.
    // This adds no test/debug interface to the shipped application.
    await page.addInitScript(() => {
      (window as any).__THREE_DEVTOOLS__ = {
        dispatchEvent(event: any) {
          const renderer = event.detail;
          if (event.type !== "observe" || !renderer?.isWebGLRenderer) return;
          const render = renderer.render.bind(renderer);
          renderer.render = (scene: any, camera: any) => {
            render(scene, camera);
            const frames: Record<string, Frame> = {};
            const resources: string[] = [];
            const orbitColors: Record<string, string> = {};
            for (const body of scene.children) {
              if (body.userData.overview || body.userData.orbitBodyId) {
                body.traverse((object: any) => {
                  resources.push(object.uuid);
                  if (object.geometry) resources.push(object.geometry.uuid);
                  if (object.material) {
                    resources.push(object.material.uuid);
                    for (const value of Object.values(object.material) as any[])
                      if (value?.isTexture) resources.push(value.uuid);
                  }
                });
              }
              if (body.userData.orbitBodyId)
                orbitColors[body.userData.orbitBodyId] = body.material.color.getHexString();
              if (!body.userData.overview) continue;
              const position = body.getWorldPosition(body.position.clone());
              const projected = position.clone().project(camera);
              frames[body.userData.bodyId] = {
                centerError: Math.hypot(projected.x, projected.y),
                position: position.toArray(),
                offset: camera.position.clone().sub(position).toArray(),
              };
            }
            (window as any).__cameraFrames = frames;
            (window as any).__cameraResources = resources;
            (window as any).__orbitColors = orbitColors;
          };
        },
      };
    });
    await page.goto("/");
    await page.getByRole("button", { name: "System", exact: true }).click();
    if (realScale) {
      await page.getByRole("button", { name: "View options", exact: true }).click();
      await page.getByRole("switch", { name: "Real scale" }).check();
      await page.getByRole("button", { name: "Close dialog" }).click();
    }
    await expectCentered(page, "Earth");
    // Wait for initial scene construction, then prove selection keeps all GPU resources.
    await page.waitForTimeout(250);
    const resources = await page.evaluate(() => (window as any).__cameraResources);
    expect(resources.length).toBeGreaterThan(0);
    for (const name of ["Neptune", "Luna"]) {
      await page.locator(".body-row").filter({ hasText: name }).click();
      await expectCentered(page, name);
      await expect
        .poll(() => page.evaluate(() => (window as any).__orbitColors))
        .toMatchObject({
          Earth: "354152",
          [name]: "e4b785",
        });
      // Catch the old delayed full-scene rebuild rather than only the immediate frame.
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => (window as any).__cameraResources)).toEqual(resources);
    }
    await page.getByRole("button", { name: "Reset camera" }).click();
    await expectCentered(page, "Luna");
    const before = (await bodyFrame(page, "Luna"))!;
    await page.getByLabel("Simulation time", { exact: true }).evaluate((element) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        element,
        "900",
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect
      .poll(async () => (await bodyFrame(page, "Luna"))?.position)
      .not.toEqual(before.position);
    await expectCentered(page, "Luna");
    const after = (await bodyFrame(page, "Luna"))!;
    for (let i = 0; i < 3; i++) expect(after.offset[i]).toBeCloseTo(before.offset[i], 7);

    await page.getByRole("button", { name: "Play orbital simulation" }).click();
    await expect
      .poll(async () => (await bodyFrame(page, "Luna"))?.position)
      .not.toEqual(after.position);
    await expectCentered(page, "Luna");
    await page.getByRole("button", { name: "Pause orbital simulation" }).click();
    await page.getByRole("button", { name: "Reset simulation time" }).click();
    await expectCentered(page, "Luna");
    await page.setViewportSize({ width: 1100, height: 800 });
    await expectCentered(page, "Luna");
    // Authored data changes still rebuild the preview and retain the current highlight.
    await page
      .locator(".inspector-tabs")
      .getByRole("button", { name: "Body", exact: true })
      .click();
    await page.getByLabel("Mean radius", { exact: true }).fill("2000");
    await expect
      .poll(() => page.evaluate(() => (window as any).__cameraResources))
      .not.toEqual(resources);
    await expectCentered(page, "Luna");
    await expect.poll(() => page.evaluate(() => (window as any).__orbitColors.Luna)).toBe("e4b785");
    await page.locator(".view-toolbar").getByRole("button", { name: "Body", exact: true }).click();
    await page.getByRole("button", { name: "System", exact: true }).click();
    await expectCentered(page, "Luna");
    await page.locator(".body-row").filter({ hasText: "Sol" }).click();
    await expectCentered(page, "Sol");
    expect(errors).toEqual([]);
  });
}
