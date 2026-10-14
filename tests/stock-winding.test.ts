import { describe, expect, it } from "vitest";
import { getStockMesh, STOCK_ASSETS } from "../src/lib/stock-assets";

describe("stock mesh front faces", () => {
  it("keeps source components outward-wound at all five native LODs", () => {
    for (const asset of STOCK_ASSETS)
      for (let lod = 0; lod < 5; lod++) {
        const mesh = getStockMesh(asset.id, lod),
          parent = new Map<string, string>();
        let normalError = 0;
        for (let at = 0; at < mesh.normals.length; at += 3)
          normalError = Math.max(
            normalError,
            Math.abs(Math.hypot(...mesh.normals.subarray(at, at + 3)) - 1),
          );
        expect(normalError, `${asset.id} LOD${lod} unit normals`).toBeLessThan(0.00005);
        const point = (index: number) => mesh.positions.slice(index * 3, index * 3 + 3);
        const key = (index: number) => point(index).join(",");
        const find = (value: string): string => {
          const p = parent.get(value);
          if (!p) {
            parent.set(value, value);
            return value;
          }
          if (p === value) return value;
          const root = find(p);
          parent.set(value, root);
          return root;
        };
        for (let at = 0; at < mesh.indices.length; at += 3) {
          const keys = Array.from(mesh.indices.subarray(at, at + 3), key);
          const root = find(keys[0]);
          for (const k of keys.slice(1)) parent.set(find(k), root);
        }
        const volumes = new Map<string, number>(),
          edges = new Map<string, { count: number; component: string }>();
        for (let at = 0; at < mesh.indices.length; at += 3) {
          const ids = Array.from(mesh.indices.subarray(at, at + 3)),
            [a, b, c] = ids.map(point);
          const volume =
            a[0] * (b[1] * c[2] - b[2] * c[1]) +
            a[1] * (b[2] * c[0] - b[0] * c[2]) +
            a[2] * (b[0] * c[1] - b[1] * c[0]);
          const root = find(key(ids[0]));
          volumes.set(root, (volumes.get(root) ?? 0) + volume / 6);
          for (let edge = 0; edge < 3; edge++) {
            const k = [key(ids[edge]), key(ids[(edge + 1) % 3])].sort().join("|");
            const previous = edges.get(k);
            edges.set(k, { count: (previous?.count ?? 0) + 1, component: root });
          }
        }
        const open = new Set(
          [...edges.values()].filter((edge) => edge.count !== 2).map((edge) => edge.component),
        );
        // Closed solids have meaningful signed volume. Open foliage cards do not;
        // their normals must follow their authored winding instead.
        let minimumAlignment = 1;
        for (let at = 0; at < mesh.indices.length; at += 3) {
          const ids = Array.from(mesh.indices.subarray(at, at + 3));
          if (!open.has(find(key(ids[0])))) continue;
          const [a, b, c] = ids.map(point),
            e1 = b.map((v, i) => v - a[i]),
            e2 = c.map((v, i) => v - a[i]),
            n = [
              e1[1] * e2[2] - e1[2] * e2[1],
              e1[2] * e2[0] - e1[0] * e2[2],
              e1[0] * e2[1] - e1[1] * e2[0],
            ],
            length = Math.hypot(...n);
          if (length < 1e-12) continue;
          const alignment =
            ids.reduce(
              (sum, id) =>
                sum + n.reduce((dot, v, axis) => dot + v * mesh.normals[id * 3 + axis], 0) / length,
              0,
            ) / 3;
          minimumAlignment = Math.min(minimumAlignment, alignment);
        }
        expect(minimumAlignment, `${asset.id} LOD${lod} open surface winding`).toBeGreaterThan(0);
        for (const [component, volume] of volumes)
          if (!open.has(component))
            expect(
              volume,
              `${asset.id} LOD ${lod} component ${component} must face outward`,
            ).toBeGreaterThanOrEqual(-1e-8);
        if (lod === 0 && [...volumes.keys()].some((component) => !open.has(component)))
          expect(
            [...volumes].reduce(
              (sum, [component, value]) => sum + (open.has(component) ? 0 : value),
              0,
            ),
          ).toBeGreaterThan(0);
      }
  }, 20_000);
});
