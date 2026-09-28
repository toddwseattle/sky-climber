import { GAME } from "./config";
import type { Grip, HandId, HazardType } from "./types";

export interface HazardPattern {
  type: HazardType;
  offsetRows: number;
  col: number;
  side: HandId;
  warning: number;
  active: number;
}

const SECTION_PATTERNS: readonly (readonly HazardPattern[])[] = [
  [
    { type: "window", offsetRows: 3, col: 2, side: "left", warning: 1.25, active: 2.4 },
    { type: "window", offsetRows: 4, col: 5, side: "right", warning: 1.2, active: 2.2 },
  ],
  [
    { type: "debris", offsetRows: 5, col: 5, side: "right", warning: 1.35, active: 0.75 },
    { type: "window", offsetRows: 4, col: 3, side: "left", warning: 1.15, active: 2.1 },
  ],
  [
    { type: "bird", offsetRows: 3, col: 4, side: "right", warning: 1.15, active: 0.8 },
    { type: "window", offsetRows: 5, col: 4, side: "right", warning: 1.1, active: 2.2 },
  ],
  [
    { type: "wind", offsetRows: 2, col: 3, side: "left", warning: 1.6, active: 3.2 },
    { type: "debris", offsetRows: 5, col: 2, side: "left", warning: 1.3, active: 0.75 },
  ],
  [
    { type: "bird", offsetRows: 4, col: 2, side: "left", warning: 1.1, active: 0.8 },
    { type: "wind", offsetRows: 2, col: 4, side: "right", warning: 1.55, active: 3.25 },
    { type: "window", offsetRows: 5, col: 5, side: "right", warning: 1.1, active: 2 },
  ],
] as const;

export function sectionForFloor(floor: number): number {
  return Math.min(4, Math.max(0, Math.floor((floor - 1) / 20)));
}

export function patternFor(section: number, index: number): HazardPattern {
  const patterns = SECTION_PATTERNS[section] ?? SECTION_PATTERNS[0];
  return patterns[index % patterns.length];
}

export function gripExists(grip: Grip): boolean {
  return (
    grip.col >= 0 &&
    grip.col < GAME.columns &&
    grip.row >= 1 &&
    grip.row <= GAME.floors
  );
}

export function authoredSectionsHaveSafeColumns(): boolean {
  return SECTION_PATTERNS.every((patterns) =>
    patterns.every((pattern) => pattern.col > 0 && pattern.col < GAME.columns - 1),
  );
}
