import type { Direction, Grip } from "./types";

export interface ProjectedGripTarget {
  grip: Grip;
  x: number;
  y: number;
  visible: boolean;
}

/**
 * Converts a point inside a thumb pad into a cardinal direction. The dead zone
 * lets a player rest in the middle without accidentally moving either hand.
 */
export function directionFromPadPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  deadZone = 0.24,
): Direction | null {
  if (width <= 0 || height <= 0) return null;

  const normalizedX = (x - width / 2) / (width / 2);
  const normalizedY = (y - height / 2) / (height / 2);
  const horizontal = Math.abs(normalizedX);
  const vertical = Math.abs(normalizedY);

  if (Math.max(horizontal, vertical) < deadZone) return null;
  if (horizontal > vertical) return normalizedX < 0 ? "left" : "right";
  return normalizedY < 0 ? "up" : "down";
}

/** Finds the closest reachable grip while keeping a generous but finite tap target. */
export function nearestReachableGrip(
  x: number,
  y: number,
  targets: readonly ProjectedGripTarget[],
  maxDistance: number,
): Grip | null {
  let nearest: Grip | null = null;
  let nearestDistanceSquared = maxDistance * maxDistance;

  for (const target of targets) {
    if (!target.visible) continue;
    const deltaX = target.x - x;
    const deltaY = target.y - y;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    if (distanceSquared > nearestDistanceSquared) continue;
    nearest = target.grip;
    nearestDistanceSquared = distanceSquared;
  }

  return nearest ? { ...nearest } : null;
}
