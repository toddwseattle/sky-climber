import { describe, expect, it } from "vitest";
import { directionFromPadPoint, nearestReachableGrip } from "./touch";

describe("directionFromPadPoint", () => {
  it("maps each side of a thumb pad to its cardinal direction", () => {
    expect(directionFromPadPoint(50, 0, 100, 100)).toBe("up");
    expect(directionFromPadPoint(0, 50, 100, 100)).toBe("left");
    expect(directionFromPadPoint(100, 50, 100, 100)).toBe("right");
    expect(directionFromPadPoint(50, 100, 100, 100)).toBe("down");
  });

  it("keeps the center neutral so a thumb can rest safely", () => {
    expect(directionFromPadPoint(50, 50, 100, 100)).toBeNull();
    expect(directionFromPadPoint(58, 55, 100, 100)).toBeNull();
  });

  it("uses the dominant axis for diagonal slides", () => {
    expect(directionFromPadPoint(80, 15, 100, 100)).toBe("up");
    expect(directionFromPadPoint(92, 25, 100, 100)).toBe("right");
  });
});

describe("nearestReachableGrip", () => {
  const targets = [
    { grip: { col: 3, row: 2 }, x: 100, y: 80, visible: true },
    { grip: { col: 4, row: 2 }, x: 140, y: 80, visible: true },
    { grip: { col: 5, row: 2 }, x: 180, y: 80, visible: false },
  ];

  it("selects the closest visible grip inside the tap radius", () => {
    expect(nearestReachableGrip(132, 82, targets, 30)).toEqual({ col: 4, row: 2 });
  });

  it("ignores off-screen and distant grips", () => {
    expect(nearestReachableGrip(180, 80, targets, 12)).toBeNull();
    expect(nearestReachableGrip(20, 20, targets, 30)).toBeNull();
  });
});
