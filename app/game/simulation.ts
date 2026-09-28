import { GAME, SECTION_NAMES } from "./config";
import { gripExists, patternFor, sectionForFloor } from "./levels";
import type {
  Direction,
  GameEvent,
  GamePhase,
  GameSnapshot,
  Grip,
  HandId,
  HandState,
  HazardState,
  HazardType,
} from "./types";

const VECTORS: Record<Direction, Grip> = {
  up: { col: 0, row: 1 },
  down: { col: 0, row: -1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

interface InternalHazard extends HazardState {
  age: number;
  warningDuration: number;
  activeDuration: number;
  resolved: boolean;
}

interface BufferedMove {
  hand: HandId;
  direction: Direction;
  remaining: number;
}

function sameGrip(a: Grip, b: Grip): boolean {
  return a.col === b.col && a.row === b.row;
}

function cloneHand(hand: HandState): HandState {
  return {
    state: hand.state,
    grip: { ...hand.grip },
    moving: hand.moving
      ? {
          from: { ...hand.moving.from },
          to: { ...hand.moving.to },
          progress: hand.moving.progress,
        }
      : undefined,
  };
}

function directionBetween(from: Grip, to: Grip): Direction | null {
  const columnDelta = to.col - from.col;
  const rowDelta = to.row - from.row;
  for (const [direction, vector] of Object.entries(VECTORS) as [Direction, Grip][]) {
    if (vector.col === columnDelta && vector.row === rowDelta) return direction;
  }
  return null;
}

export class SkyClimberSimulation {
  private phase: GamePhase = "title";
  private hands: Record<HandId, HandState> = {
    left: { state: "attached", grip: { col: 3, row: 1 } },
    right: { state: "attached", grip: { col: 4, row: 1 } },
  };
  private lastMoved: HandId = "right";
  private buffered: BufferedMove | null = null;
  private score = 0;
  private reachedRows = new Set<number>([1]);
  private lives = GAME.startingLives;
  private checkpoint = 1;
  private elapsed = 0;
  private recoveryHand: HandId | null = null;
  private recoveryRemaining = 0;
  private bracing = false;
  private braceRecharge = 0;
  private windPressure = 0;
  private protection = 0;
  private hazards: InternalHazard[] = [];
  private hazardClock = 5.25;
  private hazardIndex = 0;
  private hazardId = 0;
  private fallClock = 0;
  private introClock = 0;
  private events: GameEvent[] = [];
  private message = "Ready for the first grip";

  start(): void {
    this.reset();
    this.phase = "intro";
    this.message = "Taipei 101 · 508 metres to the skyline";
  }

  reset(): void {
    this.phase = "title";
    this.hands = {
      left: { state: "attached", grip: { col: 3, row: 1 } },
      right: { state: "attached", grip: { col: 4, row: 1 } },
    };
    this.lastMoved = "right";
    this.buffered = null;
    this.score = 0;
    this.reachedRows = new Set([1]);
    this.lives = GAME.startingLives;
    this.checkpoint = 1;
    this.elapsed = 0;
    this.recoveryHand = null;
    this.recoveryRemaining = 0;
    this.bracing = false;
    this.braceRecharge = 0;
    this.windPressure = 0;
    this.protection = 0;
    this.hazards = [];
    this.hazardClock = 5.25;
    this.hazardIndex = 0;
    this.fallClock = 0;
    this.introClock = 0;
    this.events = [];
    this.message = "Ready for the first grip";
  }

  setPaused(paused: boolean): void {
    if (paused && this.phase === "playing") {
      this.phase = "paused";
      this.bracing = false;
    } else if (!paused && this.phase === "paused") {
      this.phase = "playing";
    }
  }

  skipIntro(): void {
    if (this.phase !== "intro") return;
    this.introClock = GAME.flyInSeconds;
    this.phase = "playing";
    this.message = "Tap a nearby hold or alternate hands upward";
  }

  setBracing(active: boolean): void {
    if (this.phase !== "playing") {
      this.bracing = false;
      return;
    }
    const bothAttached =
      this.hands.left.state === "attached" && this.hands.right.state === "attached";
    this.bracing = active && bothAttached && this.braceRecharge <= 0;
  }

  issueCommand(handId: HandId, direction: Direction): boolean {
    if (this.phase !== "playing" || this.bracing) return false;
    if (this.recoveryHand) {
      if (this.recoveryHand !== handId) return false;
      return this.tryRecovery(handId, direction);
    }

    const moving = this.movingHand();
    if (moving) {
      if (!this.buffered) {
        this.buffered = { hand: handId, direction, remaining: 0.15 };
      }
      return false;
    }
    return this.beginMove(handId, direction);
  }

  getReachableGrips(): Grip[] {
    if (this.phase !== "playing" || this.bracing || this.movingHand()) return [];
    const handIds: HandId[] = this.recoveryHand
      ? [this.recoveryHand]
      : ["left", "right"];
    const reachable = new Map<string, Grip>();

    for (const handId of handIds) {
      const hand = this.hands[handId];
      if (hand.state !== "attached" && this.recoveryHand !== handId) continue;
      for (const vector of Object.values(VECTORS)) {
        const target = {
          col: hand.grip.col + vector.col,
          row: hand.grip.row + vector.row,
        };
        if (this.isLegal(handId, target, this.recoveryHand === handId)) {
          reachable.set(`${target.col}:${target.row}`, target);
        }
      }
    }

    return [...reachable.values()].map((grip) => ({ ...grip }));
  }

  issueGrip(target: Grip): boolean {
    if (this.phase !== "playing" || this.bracing || this.movingHand()) return false;
    const handIds: HandId[] = this.recoveryHand
      ? [this.recoveryHand]
      : this.lastMoved === "left"
        ? ["right", "left"]
        : ["left", "right"];

    for (const handId of handIds) {
      const direction = directionBetween(this.hands[handId].grip, target);
      if (!direction || !this.isLegal(handId, target, this.recoveryHand === handId)) continue;
      if (this.recoveryHand === handId) return this.tryRecovery(handId, direction);
      return this.beginMove(handId, direction);
    }

    return false;
  }

  tick(dt: number): void {
    if (this.phase === "paused" || this.phase === "title" || this.phase === "gameover" || this.phase === "victory") {
      return;
    }

    if (this.phase === "intro") {
      this.introClock = Math.min(GAME.flyInSeconds, this.introClock + dt);
      if (this.introClock >= GAME.flyInSeconds) this.skipIntro();
      return;
    }

    if (this.phase === "falling") {
      this.fallClock -= dt;
      if (this.fallClock <= 0) this.finishFall();
      return;
    }

    this.elapsed += dt;
    this.protection = Math.max(0, this.protection - dt);
    this.braceRecharge = Math.max(0, this.braceRecharge - dt);
    this.updateMoves(dt);

    if (this.recoveryHand) {
      this.recoveryRemaining -= dt;
      if (this.recoveryRemaining <= 0) this.beginFall();
    }

    this.updateHazards(dt);
    this.updateProgress();
  }

  dislodge(handId: HandId): void {
    if (this.phase !== "playing" || this.protection > 0 || this.recoveryHand) return;
    if (this.bracing && this.braceRecharge <= 0) {
      this.bracing = false;
      this.braceRecharge = GAME.braceRechargeSeconds;
      this.protection = GAME.hitImmunitySeconds;
      this.events.push("hit");
      this.message = "Brace held! Recharging…";
      return;
    }
    this.hands[handId].state = "dangling";
    this.hands[handId].moving = undefined;
    this.recoveryHand = handId;
    this.recoveryRemaining = GAME.recoverySeconds;
    this.protection = GAME.hitImmunitySeconds;
    this.events.push("hit");
    this.message = `${handId === "left" ? "Left" : "Right"} hand loose — grab a glowing grip!`;
  }

  drainEvents(): GameEvent[] {
    return this.events.splice(0);
  }

  debugWarpToFloor(floor: number): void {
    const target = Math.max(1, Math.min(GAME.floors - 1, Math.floor(floor)));
    this.hands = {
      left: { state: "attached", grip: { col: 3, row: target } },
      right: { state: "attached", grip: { col: 4, row: target } },
    };
    this.hazards = [];
    this.recoveryHand = null;
    this.recoveryRemaining = 0;
    this.updateProgress();
    this.message = `Development shortcut · floor ${target}`;
  }

  debugForceFinalFall(): void {
    this.lives = 1;
    this.beginFall();
  }

  getSnapshot(): GameSnapshot {
    const floor = this.currentFloor();
    return {
      phase: this.phase,
      left: cloneHand(this.hands.left),
      right: cloneHand(this.hands.right),
      floor,
      score: this.score,
      lives: this.lives,
      checkpoint: this.checkpoint,
      elapsed: this.elapsed,
      recoveryHand: this.recoveryHand,
      recoveryRemaining: this.recoveryRemaining,
      bracing: this.bracing,
      braceReady: this.braceRecharge <= 0,
      windPressure: this.windPressure,
      hazards: this.hazards.map((hazard) => ({
        id: hazard.id,
        type: hazard.type,
        row: hazard.row,
        col: hazard.col,
        side: hazard.side,
        phase: hazard.phase,
        progress: hazard.progress,
        windDirection: hazard.windDirection,
      })),
      protection: this.protection,
      message: this.message,
      section: sectionForFloor(floor),
      introProgress: Math.min(1, this.introClock / GAME.flyInSeconds),
    };
  }

  private beginMove(handId: HandId, direction: Direction): boolean {
    const hand = this.hands[handId];
    if (hand.state !== "attached") return false;
    const delta = VECTORS[direction];
    const target = { col: hand.grip.col + delta.col, row: hand.grip.row + delta.row };
    if (!this.isLegal(handId, target)) {
      this.events.push("invalid");
      this.message = "That grip is out of reach";
      return false;
    }
    hand.state = "moving";
    hand.moving = { from: { ...hand.grip }, to: target, progress: 0 };
    return true;
  }

  private tryRecovery(handId: HandId, direction: Direction): boolean {
    const hand = this.hands[handId];
    const delta = VECTORS[direction];
    const target = { col: hand.grip.col + delta.col, row: hand.grip.row + delta.row };
    if (!this.isLegal(handId, target, true)) {
      this.events.push("invalid");
      return false;
    }
    hand.grip = target;
    hand.state = "attached";
    this.recoveryHand = null;
    this.recoveryRemaining = 0;
    this.events.push("grab");
    this.message = "Recovered — keep climbing!";
    return true;
  }

  private isLegal(handId: HandId, target: Grip, recovery = false): boolean {
    if (!gripExists(target) || this.isClosed(target)) return false;
    const otherId: HandId = handId === "left" ? "right" : "left";
    const other = this.hands[otherId].grip;
    if (sameGrip(target, other)) return false;
    const left = handId === "left" ? target : other;
    const right = handId === "right" ? target : other;
    if (left.col >= right.col) return false;
    if (Math.abs(left.col - right.col) > 2 || Math.abs(left.row - right.row) > 1) return false;
    if (!recovery && this.hands[otherId].state === "dangling") return false;
    return true;
  }

  private isClosed(grip: Grip): boolean {
    return this.hazards.some(
      (hazard) =>
        hazard.type === "window" &&
        hazard.phase === "active" &&
        hazard.row === grip.row &&
        hazard.col === grip.col,
    );
  }

  private movingHand(): HandId | null {
    if (this.hands.left.state === "moving") return "left";
    if (this.hands.right.state === "moving") return "right";
    return null;
  }

  private updateMoves(dt: number): void {
    const movingId = this.movingHand();
    if (movingId) {
      const hand = this.hands[movingId];
      if (!hand.moving) return;
      hand.moving.progress = Math.min(1, hand.moving.progress + dt / GAME.transferSeconds);
      if (hand.moving.progress >= 1) {
        if (this.isClosed(hand.moving.to)) {
          hand.state = "attached";
          hand.moving = undefined;
          this.events.push("invalid");
        } else {
          hand.grip = { ...hand.moving.to };
          hand.state = "attached";
          hand.moving = undefined;
          this.lastMoved = movingId;
          this.events.push("grab");
          this.message = this.tutorialMessage();
        }
      }
    }

    if (this.buffered) {
      this.buffered.remaining -= dt;
      if (!this.movingHand()) {
        const move = this.buffered;
        this.buffered = null;
        this.beginMove(move.hand, move.direction);
      } else if (this.buffered.remaining <= 0) {
        this.buffered = null;
      }
    }
  }

  private updateProgress(): void {
    const floor = this.currentFloor();
    for (let row = 2; row <= floor; row += 1) {
      if (!this.reachedRows.has(row)) {
        this.reachedRows.add(row);
        this.score += 100;
      }
    }
    for (const cp of GAME.checkpoints) {
      if (cp > this.checkpoint && floor >= cp) {
        this.checkpoint = cp;
        this.hazards = [];
        this.protection = GAME.respawnProtectionSeconds;
        this.events.push("checkpoint");
        this.message = `Checkpoint ${cp} — ${SECTION_NAMES[sectionForFloor(cp)]}`;
      }
    }
    if (this.hands.left.grip.row === GAME.floors && this.hands.right.grip.row === GAME.floors) {
      const timeBonus = Math.max(0, 6000 - 10 * Math.floor(this.elapsed));
      this.score += this.lives * 2000 + timeBonus;
      this.phase = "victory";
      this.events.push("victory");
      this.message = "Summit reached — rescue inbound!";
    }
  }

  private currentFloor(): number {
    const attachedRows = (["left", "right"] as HandId[])
      .filter((id) => this.hands[id].state !== "dangling")
      .map((id) => this.hands[id].grip.row);
    return Math.min(...attachedRows);
  }

  private updateHazards(dt: number): void {
    const floor = this.currentFloor();
    if (floor >= 4 && floor < 99 && !this.recoveryHand) {
      this.hazardClock -= dt;
      if (this.hazardClock <= 0 && this.hazards.length === 0) {
        this.spawnHazard();
        const section = sectionForFloor(floor);
        this.hazardClock = Math.max(3.8, 6.5 - section * 0.45);
      }
    }

    let activeWind = false;
    for (const hazard of this.hazards) {
      hazard.age += dt;
      if (hazard.phase === "warning") {
        hazard.progress = Math.min(1, hazard.age / hazard.warningDuration);
        if (hazard.age >= hazard.warningDuration) {
          hazard.phase = "active";
          hazard.age = 0;
          hazard.progress = 0;
          this.resolveHazardStart(hazard);
        }
      } else {
        hazard.progress = Math.min(1, hazard.age / hazard.activeDuration);
        if (hazard.type === "wind") activeWind = true;
        if (!hazard.resolved && hazard.age >= Math.min(0.28, hazard.activeDuration * 0.45)) {
          this.resolveImpact(hazard);
          hazard.resolved = true;
        }
      }
    }

    if (activeWind) {
      this.windPressure = Math.min(1, this.windPressure + dt * (this.bracing ? -1 : 0.5));
      if (this.windPressure >= 1) {
        const wind = this.hazards.find((h) => h.type === "wind" && h.phase === "active");
        this.dislodge(wind?.side ?? "left");
        this.windPressure = 0;
      }
    } else {
      this.windPressure = Math.max(0, this.windPressure - dt);
    }

    this.hazards = this.hazards.filter(
      (hazard) => hazard.phase === "warning" || hazard.age < hazard.activeDuration,
    );
  }

  private spawnHazard(): void {
    const section = sectionForFloor(this.currentFloor());
    const pattern = patternFor(section, this.hazardIndex++);
    const row = Math.min(98, Math.max(this.currentFloor() + 2, this.currentFloor() + pattern.offsetRows));
    const hazard: InternalHazard = {
      id: ++this.hazardId,
      type: pattern.type,
      row,
      col: pattern.col,
      side: pattern.side,
      phase: "warning",
      progress: 0,
      age: 0,
      warningDuration: pattern.warning,
      activeDuration: pattern.active,
      resolved: false,
      windDirection: pattern.side === "left" ? "right" : "left",
    };
    this.hazards.push(hazard);
    this.events.push("warning");
    this.message = this.hazardMessage(pattern.type, pattern.side);
  }

  private resolveHazardStart(hazard: InternalHazard): void {
    if (hazard.type !== "window") return;
    for (const id of ["left", "right"] as HandId[]) {
      if (sameGrip(this.hands[id].grip, hazard)) this.dislodge(id);
    }
  }

  private resolveImpact(hazard: InternalHazard): void {
    if (hazard.type === "window" || hazard.type === "wind") return;
    const hand = this.hands[hazard.side];
    if (Math.abs(hand.grip.row - hazard.row) <= 1 || hazard.type === "bird") {
      this.dislodge(hazard.side);
    }
  }

  private beginFall(): void {
    if (this.phase !== "playing") return;
    this.phase = "falling";
    this.fallClock = 0.9;
    this.lives = Math.max(0, this.lives - 1);
    this.bracing = false;
    this.events.push("fall");
    this.message = this.lives > 0 ? "Hold tight — checkpoint rewind" : "The tower wins this round";
  }

  private finishFall(): void {
    if (this.lives <= 0) {
      this.phase = "gameover";
      return;
    }
    this.hands = {
      left: { state: "attached", grip: { col: 3, row: this.checkpoint } },
      right: { state: "attached", grip: { col: 4, row: this.checkpoint } },
    };
    this.recoveryHand = null;
    this.recoveryRemaining = 0;
    this.buffered = null;
    this.hazards = [];
    this.hazardClock = 4.5;
    this.windPressure = 0;
    this.protection = GAME.respawnProtectionSeconds;
    this.phase = "playing";
    this.message = `Back at floor ${this.checkpoint} — protected for 2 seconds`;
  }

  private tutorialMessage(): string {
    const floor = this.currentFloor();
    if (floor < 3) return "Nice rhythm — move the other hand";
    if (floor < 5) return "To sidestep, move the outside hand first";
    if (floor < 8) return "Flashing frames close — find another route";
    if (floor < 21) return "Hold Brace or Space to absorb an impact";
    return `${SECTION_NAMES[sectionForFloor(floor)]} · floor ${floor}`;
  }

  private hazardMessage(type: HazardType, side: HandId): string {
    if (type === "window") return "Window closing — flashing grip ahead";
    if (type === "debris") return `Debris above — protect the ${side} side`;
    if (type === "bird") return `Bird sweep — brace or protect the ${side} hand`;
    return "Wind rising — hold Space to brace";
  }
}
