import { isPlanet, type Planet, type Project } from "./types";
import {
  stockMeshByteEstimate,
  stockIsGroundcover,
  stockUsesCutout,
  STOCK_TEXTURE_SIZE,
} from "./stock-assets";
import { importedAssetBytes, importedMeshByteEstimate } from "./imported-clutter";
export const EXPORT_BUDGET_BYTES = 384 * 1024 * 1024;
export function bodyResolution(project: Project, body: Planet) {
  return body.exportResolution || project.exportResolution;
}
/** Conservative uncompressed payload estimate; ZIP retains source buffers in memory. */
export function estimateExportBytes(project: Project) {
  return project.systems
    .flatMap((s) => s.bodies)
    .filter(isPlanet)
    .reduce((total, body) => {
      const n = bodyResolution(project, body);
      const cubes = ((n * n * 6 * 4) / 3) * (body.kind === "rocky" ? 26 : 4);
      const materials =
        body.kind === "rocky"
          ? body.surface.biomes.length * 2 * 5 * Math.min(256, Math.max(64, n)) ** 2 * 4
          : 0;
      const clutter = body.clutter
        .filter((c) => c.enabled)
        .reduce(
          (bytes, type) =>
            type.importedAsset
              ? bytes +
                importedMeshByteEstimate(type) +
                type.importedAsset.materials.reduce(
                  (sum, m) =>
                    sum + m.size * m.size * (m.cutout || type.material.opacity ? 4 : 3) * 4,
                  0,
                ) +
                Math.min(256, Math.max(64, n)) ** 2 * 4
              : bytes +
                (type.stockAssetId
                  ? STOCK_TEXTURE_SIZE ** 2 *
                      ((stockUsesCutout(type.stockAssetId) ? 4 : 3) +
                        (stockIsGroundcover(type.stockAssetId) ? 1 : 0)) +
                    Math.min(256, Math.max(64, n)) ** 2 * 2
                  : Math.min(256, Math.max(64, n)) ** 2 * 5) *
                  4 +
                (type.stockAssetId ? stockMeshByteEstimate(type.stockAssetId) : 512 * 1024),
          0,
        );
      // Disabled types still retain their source data in the archive's project.json.
      const storedImports = body.clutter.reduce(
        (bytes, type) =>
          bytes + (type.importedAsset ? 2 * importedAssetBytes(type.importedAsset) : 0),
        0,
      );
      const clouds =
        body.clouds.enabled && body.atmosphere.enabled
          ? body.clouds.layers
              .filter((l) => l.enabled)
              .reduce((sum, l) => sum + n * n * 8 * 4 * (l.flow.enabled ? 4 : 3), 0)
          : 0;
      const sites = body.landmarks.filter((s) => s.enabled && s.launchPad).length * 300 * 1024;
      return (
        total +
        cubes +
        materials +
        clutter +
        storedImports +
        clouds +
        sites +
        (body.environmentAudio.enabled ? body.environmentAudio.loopSeconds * 22050 * 2 : 0)
      );
    }, 1024 * 1024);
}
export function assertExportBudget(project: Project) {
  const bytes = estimateExportBytes(project);
  if (bytes > EXPORT_BUDGET_BYTES)
    throw new Error(
      `This export needs about ${Math.ceil(bytes / 1024 / 1024)} MB of source assets, above the browser's 384 MB export budget. Lower the collection resolution or set individual body resolutions in Body settings.`,
    );
}
