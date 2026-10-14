import type { Object3D, Vector3 } from "three";
import { authorToNativeDirection } from "./procedural";

export interface NativeSitePoint {
  latitude: number;
  longitude: number;
}

/** KSA's surface-location frame is singular at an exact pole. */
export const MAX_NATIVE_SITE_LATITUDE = 89.999;

export function authorPointToNativeSite(
  point: readonly [number, number, number],
): NativeSitePoint | null {
  const length = Math.hypot(...point);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  const native = authorToNativeDirection(point);
  const latitude = (Math.asin(Math.max(-1, Math.min(1, native[2] / length))) * 180) / Math.PI;
  const longitude = (Math.atan2(native[1], native[0]) * 180) / Math.PI;
  return {
    latitude: Math.max(-MAX_NATIVE_SITE_LATITUDE, Math.min(MAX_NATIVE_SITE_LATITUDE, latitude)),
    longitude: Math.abs(longitude) < 1e-10 ? 0 : longitude,
  };
}

/** Undo the body's current tilt/spin/scene transform before assigning native coordinates. */
export function terrainHitToNativeSite(
  terrain: Object3D,
  worldPoint: Vector3,
): NativeSitePoint | null {
  const local = terrain.worldToLocal(worldPoint.clone());
  return authorPointToNativeSite([local.x, local.y, local.z]);
}
