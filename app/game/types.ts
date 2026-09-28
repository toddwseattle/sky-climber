export type HandId = "left" | "right";
export type Direction = "up" | "down" | "left" | "right";
export type GamePhase =
  | "title"
  | "intro"
  | "playing"
  | "paused"
  | "falling"
  | "gameover"
  | "victory";
export type HazardType = "window" | "debris" | "bird" | "wind";

export interface Grip {
  col: number;
  row: number;
}

export interface MovingHand {
  from: Grip;
  to: Grip;
  progress: number;
}

export interface HandState {
  grip: Grip;
  state: "attached" | "moving" | "dangling";
  moving?: MovingHand;
}

export interface HazardState {
  id: number;
  type: HazardType;
  row: number;
  col: number;
  side: HandId;
  phase: "warning" | "active";
  progress: number;
  windDirection?: "left" | "right";
}

export interface GameSnapshot {
  phase: GamePhase;
  left: HandState;
  right: HandState;
  floor: number;
  score: number;
  lives: number;
  checkpoint: number;
  elapsed: number;
  recoveryHand: HandId | null;
  recoveryRemaining: number;
  bracing: boolean;
  braceReady: boolean;
  windPressure: number;
  hazards: HazardState[];
  protection: number;
  message: string;
  section: number;
  introProgress: number;
}

export type GameEvent =
  | "grab"
  | "invalid"
  | "warning"
  | "hit"
  | "checkpoint"
  | "fall"
  | "victory";
