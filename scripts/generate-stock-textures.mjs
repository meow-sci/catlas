// Write the same original material atlases used by browser previews and native exports.
// Usage: node scripts/generate-stock-textures.mjs [output-directory] [seed] [design-manifest]
// Images are temporary by default; pack them into the .blend instead of committing duplicates.
import { createServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] ?? `${tmpdir()}/orbit-foundry-stock-atlases`);
const seed = Number(process.argv[3] ?? 1);
if (!Number.isSafeInteger(seed)) throw new Error("Seed must be an integer");
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});
try {
  const { STOCK_ASSETS, STOCK_TEXTURE_SIZE } = await server.ssrLoadModule(
    "/src/lib/stock-assets.ts",
  );
  const { defaultClutter } = await server.ssrLoadModule("/src/lib/surface.ts");
  const { encodePng } = await server.ssrLoadModule("/src/lib/assets.ts");
  const { generateStockMaterialPixels } = await server.ssrLoadModule("/src/lib/stock-materials.ts");
  const assets = new Map(STOCK_ASSETS.map((asset) => [asset.id, asset]));
  if (process.argv[4]) {
    const designs = JSON.parse(await readFile(resolve(process.argv[4]), "utf8"));
    for (const design of designs) assets.set(design.id, { ...design, ...design.metadata });
  }
  const report = [];
  for (const asset of assets.values()) {
    const material = {
      ...defaultClutter().material,
      color: "#ffffff",
      secondaryColor: "#ffffff",
      roughness: asset.category === "rock" ? 0.85 : asset.category === "tree" ? 0.9 : 0.65,
      metalness: 0,
      normalStrength: 0.65,
    };
    const started = performance.now();
    const pixels = generateStockMaterialPixels(asset, STOCK_TEXTURE_SIZE, material, seed);
    for (const map of [
      "diffuse",
      "normal",
      "orm",
      ...(pixels.opacity ? ["opacity"] : []),
      ...(pixels.thickness ? ["thickness"] : []),
    ])
      await writeFile(
        `${output}/${asset.id}_${map}.png`,
        await encodePng(STOCK_TEXTURE_SIZE, STOCK_TEXTURE_SIZE, pixels[map]),
      );
    report.push({
      id: asset.id,
      size: STOCK_TEXTURE_SIZE,
      material,
      elapsedMs: Math.round(performance.now() - started),
    });
  }
  await writeFile(
    `${output}/manifest.json`,
    JSON.stringify({ seed, uvRowZero: 0, assets: report }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ output, assets: report.length, size: STOCK_TEXTURE_SIZE, seed }));
} finally {
  await server.close();
}
