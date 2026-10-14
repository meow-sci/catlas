import { describe, expect, it } from "vitest";
import { Object3D, Vector3 } from "three";
import { nativeLocationDirection, nativeToAuthorDirection } from "../src/lib/procedural";
import { authorPointToNativeSite, terrainHitToNativeSite } from "../src/lib/sitePlacement";

describe("native pointer site coordinates", () => {
  it("converts the Three authoring frame into native latitude and longitude", () => {
    for (const [latitude, longitude] of [
      [0, 0],
      [42, 90],
      [-37, -122],
      [0, 180],
      [0, -180],
    ]) {
      const direction = nativeToAuthorDirection(nativeLocationDirection(latitude, longitude));
      const site = authorPointToNativeSite(direction)!;
      expect(site.latitude).toBeCloseTo(latitude, 10);
      expect(site.longitude).toBeCloseTo(longitude, 10);
    }
    expect(authorPointToNativeSite([0, 4, 0])).toEqual({ latitude: 89.999, longitude: 0 });
    expect(authorPointToNativeSite([0, -4, 0])).toEqual({ latitude: -89.999, longitude: 0 });
    expect(authorPointToNativeSite([0, 0, 0])).toBeNull();
    expect(authorPointToNativeSite([Infinity, 0, 0])).toBeNull();
  });

  it("undoes terrain rotation, translation and scale without mutating the hit point", () => {
    const terrain = new Object3D();
    terrain.position.set(21, -7, 4);
    terrain.rotation.set(0.31, -0.74, 0.41);
    terrain.scale.set(2.3, 0.9, 4.5);
    terrain.updateMatrixWorld();
    const direction = nativeToAuthorDirection(nativeLocationDirection(24.6, -83.7));
    const world = terrain.localToWorld(new Vector3(...direction).multiplyScalar(2.04));
    const before = world.clone();
    const site = terrainHitToNativeSite(terrain, world)!;
    expect(site.latitude).toBeCloseTo(24.6, 10);
    expect(site.longitude).toBeCloseTo(-83.7, 10);
    expect(world.equals(before)).toBe(true);
  });
});
