import type { GameEvent } from "./types";

const NOTES: Record<GameEvent, [number, number, OscillatorType]> = {
  grab: [520, 0.07, "sine"],
  invalid: [145, 0.09, "square"],
  warning: [760, 0.18, "triangle"],
  hit: [95, 0.28, "sawtooth"],
  checkpoint: [660, 0.42, "sine"],
  fall: [180, 0.55, "sawtooth"],
  victory: [880, 0.8, "triangle"],
};

export class GameAudio {
  private context: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  async unlock(): Promise<void> {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
  }

  play(event: GameEvent): void {
    if (this.muted || !this.context || this.context.state !== "running") return;
    const [frequency, duration, type] = NOTES[event];
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (event === "fall") oscillator.frequency.exponentialRampToValueAtTime(55, now + duration);
    if (event === "checkpoint" || event === "victory") {
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.5, now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
