export const GAME = {
  columns: 8,
  floors: 101,
  floorHeight: 1.4,
  columnWidth: 1.25,
  transferSeconds: 0.18,
  recoverySeconds: 1.25,
  braceRechargeSeconds: 2,
  hitImmunitySeconds: 1,
  respawnProtectionSeconds: 2,
  startingLives: 3,
  checkpoints: [1, 21, 41, 61, 81] as const,
  fixedStep: 1 / 60,
  maxFrameDelta: 0.1,
  maxCatchUpSteps: 6,
  flyInSeconds: 5.2,
  inputInitialDelay: 0.25,
  inputRepeat: 0.2,
} as const;

export const SECTION_NAMES = [
  "Streetlight Steps",
  "Neon Works",
  "Cloudline Crossing",
  "Typhoon Terrace",
  "Summit Run",
] as const;
