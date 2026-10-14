import { test, expect } from "@playwright/test";

test("names the clutter and altitude density point, highlights its input, and clears the error when corrected", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Clutter", exact: true }).click();
  await page.getByLabel("Clutter name", { exact: true }).fill("Giant redwood");
  for (const name of ["Scree talus", "Glass urchin"]) {
    await page.getByRole("button", { name: "Add clutter type", exact: true }).click();
    await page.getByLabel("Clutter name", { exact: true }).fill(name);
  }
  const density = page.getByLabel("Clutter density", { exact: true });
  await density.evaluate((input) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0.54");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const altitudeDensity = page.getByLabel("Altitude density 1", { exact: true });
  await altitudeDensity.fill("10");
  await expect(density).toHaveValue("0.54");
  await expect(altitudeDensity).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Warnings and validation", exact: true }).click();
  await expect(page.locator(".warning-item")).toHaveCount(1);
  await expect(page.locator(".warning-item")).toContainText(
    "Earth: clutter “Glass urchin” altitude density point 1 at -5000 m must be a finite number between 0 and 1 (current value: 10).",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await altitudeDensity.fill("1");
  await expect(altitudeDensity).toHaveAttribute("aria-invalid", "false");
  await expect(
    page.getByRole("button", { name: "Warnings and validation", exact: true }),
  ).toHaveAttribute("title", "No collection warnings");
  await page.getByRole("button", { name: "Export mod", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate & download ZIP", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
