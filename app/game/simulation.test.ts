import { describe, expect, it } from "vitest";
import { authoredSectionsHaveSafeColumns } from "./levels";
import { SkyClimberSimulation } from "./simulation";

function finishMove(game: SkyClimberSimulation): void {
  game.tick(0.2);
}

function startGame(game: SkyClimberSimulation): void {
  game.start();
  game.skipIntro();
}

function climbTo(game: SkyClimberSimulation, floor: number): void {
  while (game.getSnapshot().floor < floor) {
    game.issueCommand("left", "up");
    finishMove(game);
    game.issueCommand("right", "up");
    finishMove(game);
  }
}

describe("SkyClimberSimulation", () => {
  it("holds gameplay during the fly-in, then begins the climb", () => {
    const game = new SkyClimberSimulation();
    game.start();

    expect(game.getSnapshot().phase).toBe("intro");
    expect(game.issueCommand("left", "up")).toBe(false);

    game.tick(2.6);
    expect(game.getSnapshot().introProgress).toBeCloseTo(0.5);
    expect(game.getSnapshot().elapsed).toBe(0);

    game.tick(2.6);
    expect(game.getSnapshot().phase).toBe("playing");
  });

  it("rejects hand crossing and occupied grips without causing a fall", () => {
    const game = new SkyClimberSimulation();
    startGame(game);

    expect(game.issueCommand("left", "right")).toBe(false);
    expect(game.getSnapshot().left.grip).toEqual({ col: 3, row: 1 });
    expect(game.getSnapshot().phase).toBe("playing");
  });

  it("gains a floor through alternating independent hand moves", () => {
    const game = new SkyClimberSimulation();
    startGame(game);

    expect(game.issueCommand("left", "up")).toBe(true);
    finishMove(game);
    expect(game.getSnapshot().floor).toBe(1);
    expect(game.issueCommand("right", "up")).toBe(true);
    finishMove(game);

    expect(game.getSnapshot().floor).toBe(2);
    expect(game.getSnapshot().score).toBe(100);
  });

  it("moves the valid hand when a reachable grip is tapped", () => {
    const game = new SkyClimberSimulation();
    startGame(game);

    expect(game.getReachableGrips()).toContainEqual({ col: 3, row: 2 });
    expect(game.issueGrip({ col: 3, row: 2 })).toBe(true);
    expect(game.getSnapshot().left.moving?.to).toEqual({ col: 3, row: 2 });
  });

  it("alternates hands when both can reach the tapped grip", () => {
    const game = new SkyClimberSimulation();
    startGame(game);
    game.issueCommand("right", "right");
    finishMove(game);

    expect(game.issueGrip({ col: 4, row: 1 })).toBe(true);
    expect(game.getSnapshot().left.moving?.to).toEqual({ col: 4, row: 1 });
  });

  it("allows a slipped hand to recover by tapping a reachable grip", () => {
    const game = new SkyClimberSimulation();
    startGame(game);
    game.dislodge("left");

    expect(game.getReachableGrips()).toContainEqual({ col: 3, row: 2 });
    expect(game.issueGrip({ col: 3, row: 2 })).toBe(true);
    expect(game.getSnapshot().recoveryHand).toBeNull();
    expect(game.getSnapshot().left.grip).toEqual({ col: 3, row: 2 });
  });

  it("buffers a near-simultaneous second command and revalidates it", () => {
    const game = new SkyClimberSimulation();
    startGame(game);

    expect(game.issueCommand("left", "up")).toBe(true);
    expect(game.issueCommand("right", "up")).toBe(false);
    game.tick(0.4);

    expect(game.getSnapshot().left.grip.row).toBe(2);
    expect(game.getSnapshot().right.state).toBe("moving");
    finishMove(game);
    expect(game.getSnapshot().floor).toBe(2);
  });

  it("interrupts a moving hand into the timed recovery state", () => {
    const game = new SkyClimberSimulation();
    startGame(game);
    game.issueCommand("left", "up");

    game.dislodge("left");

    expect(game.getSnapshot().left.state).toBe("dangling");
    expect(game.getSnapshot().recoveryHand).toBe("left");
  });

  it("falls and consumes one life when recovery expires", () => {
    const game = new SkyClimberSimulation();
    startGame(game);
    game.dislodge("left");
    game.tick(1.3);

    expect(game.getSnapshot().phase).toBe("falling");
    expect(game.getSnapshot().lives).toBe(2);
  });

  it("keeps checkpoint floor score unique after a respawn", () => {
    const game = new SkyClimberSimulation();
    startGame(game);
    climbTo(game, 21);
    const scoreAtCheckpoint = game.getSnapshot().score;

    expect(game.getSnapshot().checkpoint).toBe(21);
    game.tick(2.1);
    game.dislodge("left");
    game.tick(1.3);
    game.tick(1);

    expect(game.getSnapshot().floor).toBe(21);
    expect(game.getSnapshot().score).toBe(scoreAtCheckpoint);
  });

  it("keeps authored hazards away from edge columns so a route remains", () => {
    expect(authoredSectionsHaveSafeColumns()).toBe(true);
  });
});
