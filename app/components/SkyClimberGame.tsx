"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME, SECTION_NAMES } from "../game/config";
import { GameAudio } from "../game/audio";
import { SkyClimberRenderer, type Quality } from "../game/renderer";
import { SkyClimberSimulation } from "../game/simulation";
import { directionFromPadPoint, nearestReachableGrip } from "../game/touch";
import type { Direction, GameSnapshot, HandId } from "../game/types";

interface Settings {
  muted: boolean;
  reducedMotion: boolean;
  quality: Quality;
}

interface HeldInput {
  hand: HandId;
  direction: Direction;
  nextRepeat: number;
}

const DEFAULT_SETTINGS: Settings = {
  muted: false,
  reducedMotion: false,
  quality: "high",
};

const KEY_COMMANDS: Record<string, { hand: HandId; direction: Direction }> = {
  w: { hand: "left", direction: "up" },
  a: { hand: "left", direction: "left" },
  s: { hand: "left", direction: "down" },
  d: { hand: "left", direction: "right" },
  arrowup: { hand: "right", direction: "up" },
  arrowleft: { hand: "right", direction: "left" },
  arrowdown: { hand: "right", direction: "down" },
  arrowright: { hand: "right", direction: "right" },
};

function safeLoadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem("sky-climber-settings");
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function safeLoadBest(): number {
  try {
    return Number(window.localStorage.getItem("sky-climber-best")) || 0;
  } catch {
    return 0;
  }
}

function padButtonLabel(direction: Direction): string {
  return { up: "▲", down: "▼", left: "◀", right: "▶" }[direction];
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function SkyClimberGame() {
  const simulation = useMemo(() => new SkyClimberSimulation(), []);
  const audio = useMemo(() => new GameAudio(), []);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => simulation.getSnapshot());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [bestScore, setBestScore] = useState(0);
  const [showHowTo, setShowHowTo] = useState(false);
  const [webglError, setWebglError] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SkyClimberRenderer | null>(null);
  const heldKeys = useRef(new Map<string, HeldInput>());
  const heldPointers = useRef(new Map<number, HeldInput>());
  const bracePointers = useRef(new Set<number>());
  const accumulator = useRef(0);
  const previousTime = useRef(0);
  const frameCounter = useRef(0);
  const terminalSaved = useRef(false);

  useEffect(() => {
    queueMicrotask(() => {
      setSettings(safeLoadSettings());
      setBestScore(safeLoadBest());
      setSettingsReady(true);
    });
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    audio.setMuted(settings.muted);
    try {
      window.localStorage.setItem("sky-climber-settings", JSON.stringify(settings));
    } catch {
      // Device-local settings are optional; gameplay remains available.
    }
    rendererRef.current?.setOptions(settings);
  }, [audio, settings, settingsReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new SkyClimberRenderer(canvas, {
        quality: DEFAULT_SETTINGS.quality,
        reducedMotion: DEFAULT_SETTINGS.reducedMotion,
        onContextLost: () => setWebglError(true),
      });
      rendererRef.current.setSnapshot(simulation.getSnapshot());
    } catch {
      queueMicrotask(() => setWebglError(true));
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [simulation]);

  const clearHeld = useCallback(() => {
    heldKeys.current.clear();
    heldPointers.current.clear();
    bracePointers.current.clear();
    simulation.setBracing(false);
  }, [simulation]);

  const togglePause = useCallback(() => {
    const state = simulation.getSnapshot();
    if (state.phase !== "playing" && state.phase !== "paused") return;
    const shouldPause = state.phase === "playing";
    simulation.setPaused(shouldPause);
    clearHeld();
    const next = simulation.getSnapshot();
    rendererRef.current?.setSnapshot(next);
    setSnapshot(next);
  }, [clearHeld, simulation]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (process.env.NODE_ENV !== "production" && event.shiftKey && key === "v") {
        simulation.debugWarpToFloor(100);
        event.preventDefault();
        return;
      }
      if (process.env.NODE_ENV !== "production" && event.shiftKey && key === "g") {
        simulation.debugForceFinalFall();
        event.preventDefault();
        return;
      }
      if (key === "escape" || key === "p") {
        if (!event.repeat) togglePause();
        event.preventDefault();
        return;
      }
      if (key === " ") {
        simulation.setBracing(true);
        event.preventDefault();
        return;
      }
      const command = KEY_COMMANDS[key];
      if (!command) return;
      event.preventDefault();
      if (event.repeat || heldKeys.current.has(key)) return;
      simulation.issueCommand(command.hand, command.direction);
      heldKeys.current.set(key, {
        ...command,
        nextRepeat: performance.now() / 1000 + GAME.inputInitialDelay,
      });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      heldKeys.current.delete(key);
      if (key === " ") simulation.setBracing(false);
    };
    const onBlur = () => clearHeld();
    const onVisibility = () => {
      if (document.hidden && simulation.getSnapshot().phase === "playing") {
        simulation.setPaused(true);
        clearHeld();
      }
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [clearHeld, simulation, togglePause]);

  useEffect(() => {
    let animationFrame = 0;
    const loop = (timestamp: number) => {
      const now = timestamp / 1000;
      const frameDelta = previousTime.current
        ? Math.min(GAME.maxFrameDelta, now - previousTime.current)
        : 0;
      previousTime.current = now;

      for (const held of [...heldKeys.current.values(), ...heldPointers.current.values()]) {
        if (now >= held.nextRepeat) {
          simulation.issueCommand(held.hand, held.direction);
          held.nextRepeat += GAME.inputRepeat;
        }
      }

      accumulator.current += frameDelta;
      let steps = 0;
      while (accumulator.current >= GAME.fixedStep && steps < GAME.maxCatchUpSteps) {
        simulation.tick(GAME.fixedStep);
        accumulator.current -= GAME.fixedStep;
        steps += 1;
      }
      if (steps === GAME.maxCatchUpSteps) accumulator.current = 0;

      const next = simulation.getSnapshot();
      rendererRef.current?.setSnapshot(next);
      rendererRef.current?.render();
      for (const event of simulation.drainEvents()) audio.play(event);

      frameCounter.current += 1;
      if (frameCounter.current % 4 === 0) setSnapshot(next);
      animationFrame = requestAnimationFrame(loop);
    };
    animationFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrame);
  }, [audio, simulation]);

  useEffect(() => {
    if (snapshot.phase !== "gameover" && snapshot.phase !== "victory") {
      terminalSaved.current = false;
      return;
    }
    if (terminalSaved.current) return;
    terminalSaved.current = true;
    if (snapshot.score > bestScore) {
      queueMicrotask(() => setBestScore(snapshot.score));
      try {
        window.localStorage.setItem("sky-climber-best", String(snapshot.score));
      } catch {
        // A denied storage write must not block the end screen.
      }
    }
  }, [bestScore, snapshot.phase, snapshot.score]);

  const beginGame = async () => {
    await audio.unlock().catch(() => undefined);
    terminalSaved.current = false;
    clearHeld();
    simulation.start();
    if (settings.reducedMotion) simulation.skipIntro();
    const next = simulation.getSnapshot();
    rendererRef.current?.setSnapshot(next);
    setSnapshot(next);
    setShowHowTo(false);
  };

  const hapticPulse = useCallback((duration = 8) => {
    try {
      navigator.vibrate?.(duration);
    } catch {
      // Haptics are a progressive enhancement and may be blocked by the device.
    }
  }, []);

  const setPointerDirection = useCallback((
    pointerId: number,
    hand: HandId,
    direction: Direction | null,
  ) => {
    const current = heldPointers.current.get(pointerId);
    if (current?.hand === hand && current.direction === direction) return;
    if (!direction) {
      heldPointers.current.delete(pointerId);
      return;
    }

    void audio.unlock().catch(() => undefined);
    simulation.issueCommand(hand, direction);
    heldPointers.current.set(pointerId, {
      hand,
      direction,
      nextRepeat: performance.now() / 1000 + GAME.inputInitialDelay,
    });
    hapticPulse();
  }, [audio, hapticPulse, simulation]);

  const endPointer = useCallback((pointerId: number) => {
    heldPointers.current.delete(pointerId);
  }, []);

  const tapDirection = useCallback((hand: HandId, direction: Direction) => {
    void audio.unlock().catch(() => undefined);
    simulation.issueCommand(hand, direction);
    hapticPulse();
  }, [audio, hapticPulse, simulation]);

  const tapReachableGrip = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas) return;

    const reachable = simulation.getReachableGrips();
    const tapRadius = Math.min(48, Math.max(26, Math.min(canvas.clientWidth, canvas.clientHeight) * 0.075));
    const target = nearestReachableGrip(
      event.clientX,
      event.clientY,
      reachable.map((grip) => renderer.projectGrip(grip)),
      tapRadius,
    );
    if (!target) return;

    event.preventDefault();
    void audio.unlock().catch(() => undefined);
    if (simulation.issueGrip(target)) hapticPulse(10);
  }, [audio, hapticPulse, simulation]);

  const bracePointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    void audio.unlock().catch(() => undefined);
    bracePointers.current.add(event.pointerId);
    simulation.setBracing(true);
    hapticPulse(12);
  };

  const releaseBrace = (event: React.PointerEvent<HTMLButtonElement>) => {
    bracePointers.current.delete(event.pointerId);
    if (bracePointers.current.size === 0) simulation.setBracing(false);
  };

  const updateSettings = (patch: Partial<Settings>) =>
    setSettings((current) => ({ ...current, ...patch }));

  const liveBest = Math.max(bestScore, snapshot.score);
  const showControls = snapshot.phase === "playing" || snapshot.phase === "paused" || snapshot.phase === "falling";
  const warningHazard = snapshot.hazards.find((hazard) => hazard.phase === "warning");

  return (
    <main className="game-shell">
      <section className="game-stage" aria-label="Taipei 101 climbing game">
        <canvas ref={canvasRef} className="game-canvas" aria-hidden="true" />
        <div className="sky-wash" aria-hidden="true" />

        {snapshot.phase === "title" && (
          <div className="title-screen">
            <div className="eyebrow">An original hand-over-hand arcade climb</div>
            <h1>
              <span>Taipei 101</span>
              Sky Climber
            </h1>
            <p className="title-copy">
              Two hands. One hundred and one floors. A very small helicopter waiting at the top.
            </p>
            <div className="title-actions">
              <button className="primary-button" onClick={beginGame}>Start climbing</button>
              <button className="ghost-button" onClick={() => setShowHowTo(true)}>How to play</button>
            </div>
            <div className="title-settings" aria-label="Game settings">
              <button
                className="setting-chip"
                aria-pressed={settings.muted}
                onClick={() => updateSettings({ muted: !settings.muted })}
              >
                {settings.muted ? "Sound off" : "Sound on"}
              </button>
              <button
                className="setting-chip"
                onClick={() => updateSettings({ quality: settings.quality === "high" ? "low" : "high" })}
              >
                {settings.quality === "high" ? "High detail" : "Low detail"}
              </button>
              <button
                className="setting-chip"
                aria-pressed={settings.reducedMotion}
                onClick={() => updateSettings({ reducedMotion: !settings.reducedMotion })}
              >
                {settings.reducedMotion ? "Reduced motion" : "Full motion"}
              </button>
            </div>
          </div>
        )}

        {snapshot.phase !== "title" && snapshot.phase !== "intro" && (
          <header className="hud">
            <div className="hud-group">
              <div className="hud-item"><span>Floor</span><strong>{snapshot.floor}<small>/101</small></strong></div>
              <div className="hud-item"><span>Score</span><strong>{snapshot.score.toLocaleString()}</strong></div>
            </div>
            <div className="hud-center">
              <span>{SECTION_NAMES[snapshot.section]}</span>
              <div className="tower-progress"><i style={{ width: `${snapshot.floor}%` }} /></div>
            </div>
            <div className="hud-group hud-group-right">
              <div className="hud-item"><span>Lives</span><strong aria-label={`${snapshot.lives} lives`}>{"♥".repeat(snapshot.lives)}<i>{"♥".repeat(3 - snapshot.lives)}</i></strong></div>
              <div className="hud-item"><span>Best</span><strong>{liveBest.toLocaleString()}</strong></div>
              <button className="pause-button" onClick={togglePause} aria-label="Pause game">Ⅱ</button>
            </div>
          </header>
        )}

        {snapshot.phase === "intro" && (
          <div className="fly-in-overlay" aria-live="polite">
            <div className="fly-in-copy">
              <span>Taipei, Taiwan</span>
              <strong>101 floors. One way up.</strong>
            </div>
            <button
              className="skip-fly-in"
              onClick={() => simulation.skipIntro()}
            >
              Skip intro
            </button>
          </div>
        )}

        {showControls && (
          <>
            <div className="status-card" role="status" aria-live="polite">
              <span className="status-dot" />
              {snapshot.message}
              {snapshot.recoveryHand && (
                <b>{snapshot.recoveryRemaining.toFixed(1)}s</b>
              )}
            </div>
            <div className={`wind-meter ${snapshot.windPressure > 0 ? "is-active" : ""}`}>
              <span>Wind</span><div><i style={{ width: `${snapshot.windPressure * 100}%` }} /></div>
            </div>
            {warningHazard && (
              <div className="hazard-banner" role="alert">
                <span>!</span> Incoming · floor {warningHazard.row}
              </div>
            )}
          </>
        )}

        {snapshot.phase === "playing" && (
          <div
            className="grip-tap-layer"
            aria-hidden="true"
            onPointerDown={tapReachableGrip}
          />
        )}

        {snapshot.phase === "paused" && (
          <div className="modal-backdrop">
            <div className="modal-card pause-card">
              <div className="eyebrow">Taking a breather</div>
              <h2>Paused at floor {snapshot.floor}</h2>
              <p>The tower, timer, and every hazard are frozen.</p>
              <button className="primary-button" onClick={togglePause}>Resume climb</button>
              <button className="ghost-button" onClick={beginGame}>Restart from floor 1</button>
            </div>
          </div>
        )}

        {(snapshot.phase === "gameover" || snapshot.phase === "victory") && (
          <div className="modal-backdrop result-backdrop">
            <div className={`modal-card result-card ${snapshot.phase}`}>
              <div className="result-icon">{snapshot.phase === "victory" ? "🚁" : "🧤"}</div>
              <div className="eyebrow">{snapshot.phase === "victory" ? "Rescue complete" : "Run over"}</div>
              <h2>{snapshot.phase === "victory" ? "Made it to the skyline" : `Floor ${snapshot.floor} fought back`}</h2>
              <div className="result-stats">
                <div><span>Score</span><strong>{snapshot.score.toLocaleString()}</strong></div>
                <div><span>Time</span><strong>{formatTime(snapshot.elapsed)}</strong></div>
                <div><span>Best</span><strong>{liveBest.toLocaleString()}</strong></div>
              </div>
              <button className="primary-button" onClick={beginGame}>Climb again</button>
            </div>
          </div>
        )}

        {showHowTo && (
          <div className="modal-backdrop">
            <div className="modal-card how-to-card">
              <button className="close-button" onClick={() => setShowHowTo(false)} aria-label="Close how to play">×</button>
              <div className="eyebrow">The two-hand rhythm</div>
              <h2>Climb like you mean it</h2>
              <div className="how-grid">
                <div><span className="hand-swatch left">L</span><h3>Left hand</h3><p><span className="keyboard-help">W A S D moves one neighboring grip.</span><span className="touch-help">Use the L pad, or tap a reachable hold near the hands.</span></p></div>
                <div><span className="hand-swatch right">R</span><h3>Right hand</h3><p><span className="keyboard-help">Arrow keys move the other hand.</span><span className="touch-help">Use the R pad, or tap a reachable hold near the hands.</span></p></div>
                <div><span className="hand-swatch brace">◆</span><h3>Brace</h3><p><span className="keyboard-help">Hold Space to resist wind or absorb one hit.</span><span className="touch-help">Hold the center button to resist wind or a hit.</span></p></div>
              </div>
              <ul>
                <li>Tap a nearby reachable hold, or use the L and R pads.</li>
                <li>Alternate upward moves to gain height.</li>
                <li>For sideways movement, move the outside hand first.</li>
                <li>If a hand slips, use that hand’s controls to grab a glowing grip.</li>
              </ul>
              <button className="primary-button" onClick={beginGame}>Got it — start</button>
            </div>
          </div>
        )}

        {webglError && (
          <div className="modal-backdrop">
            <div className="modal-card"><h2>3D graphics unavailable</h2><p>Sky Climber needs WebGL. Try an up-to-date browser with hardware acceleration enabled.</p></div>
          </div>
        )}

        {showControls && snapshot.phase === "playing" && (
          <div className="touch-controls" aria-label="Touch climbing controls">
            <TouchPad
              hand="left"
              label="L"
              onDirection={setPointerDirection}
              onRelease={endPointer}
              onTap={tapDirection}
            />
            <p className="mobile-control-hint">Tap a nearby hold or use the pads · hold Brace against danger</p>
            <button
              className={`brace-button ${snapshot.bracing ? "is-active" : ""} ${!snapshot.braceReady ? "is-cooling" : ""}`}
              aria-label="Hold to brace against wind or an incoming hit"
              aria-pressed={snapshot.bracing}
              onPointerDown={bracePointer}
              onPointerUp={releaseBrace}
              onPointerCancel={releaseBrace}
              onLostPointerCapture={releaseBrace}
            >
              <span>{snapshot.bracing ? "HOLDING" : snapshot.braceReady ? "BRACE" : "COOLING"}</span>
              <small><span className="keyboard-help">SPACE</span><span className="touch-help">HOLD</span></small>
            </button>
            <TouchPad
              hand="right"
              label="R"
              onDirection={setPointerDirection}
              onRelease={endPointer}
              onTap={tapDirection}
            />
          </div>
        )}

        {showControls && <div className="rotate-prompt">Rotate to landscape for more room to climb</div>}
      </section>
    </main>
  );
}

function TouchPad({
  hand,
  label,
  onDirection,
  onRelease,
  onTap,
}: {
  hand: HandId;
  label: string;
  onDirection: (pointerId: number, hand: HandId, direction: Direction | null) => void;
  onRelease: (pointerId: number) => void;
  onTap: (hand: HandId, direction: Direction) => void;
}) {
  const activePointer = useRef<number | null>(null);
  const activeDirectionRef = useRef<Direction | null>(null);
  const [activeDirection, setActiveDirection] = useState<Direction | null>(null);

  const updateDirection = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const direction = directionFromPadPoint(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      bounds.width,
      bounds.height,
    );
    if (direction === activeDirectionRef.current) return;
    activeDirectionRef.current = direction;
    setActiveDirection(direction);
    onDirection(event.pointerId, hand, direction);
  };

  const startPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.pointerType === "mouse" && event.button !== 0) || activePointer.current !== null) return;
    event.preventDefault();
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDirection(event);
  };

  const movePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== event.pointerId) return;
    event.preventDefault();
    updateDirection(event);
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== event.pointerId) return;
    if (event.type === "pointerup") updateDirection(event);
    activePointer.current = null;
    activeDirectionRef.current = null;
    setActiveDirection(null);
    onRelease(event.pointerId);
  };

  return (
    <div
      className={`touch-pad ${hand}`}
      role="group"
      aria-label={`${hand} hand thumb pad. Press an arrow or slide your thumb.`}
      data-active={activeDirection ?? "none"}
      onPointerDown={startPointer}
      onPointerMove={movePointer}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onLostPointerCapture={finishPointer}
    >
      <span className="pad-label" aria-hidden="true">{label}</span>
      {(["up", "left", "right", "down"] as Direction[]).map((direction) => (
        <button
          key={direction}
          className={`pad-${direction}`}
          aria-label={`${hand} hand ${direction}`}
          aria-pressed={activeDirection === direction}
          onClick={(event) => {
            if (event.detail === 0) onTap(hand, direction);
          }}
        >
          {padButtonLabel(direction)}
        </button>
      ))}
    </div>
  );
}
