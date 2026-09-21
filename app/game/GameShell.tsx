"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Engine, EngineCallbacks, GameState, HudState, MinimapState } from "./engine/Engine";
import Minimap from "./Minimap";
import { initCrazyGames, cgGameplayStart, cgGameplayStop, showMidgameAd } from "./engine/crazygames";

const GameCanvas = dynamic(() => import("./GameCanvas"), { ssr: false });

const INITIAL_HUD: HudState = {
  pages: 0,
  totalPages: 8,
  stamina: 1,
  prompt: null,
  objective: "COLLECT THE PAGES — 0/8",
  flashlight: true,
  sneaking: false,
  cheats: null,
  mapCheat: false,
  dangerLevel: 0,
};

function EKG({ danger }: { danger: number }) {
  if (danger <= 0.05) return null;
  const h = 5 + danger * 40;
  const dur = Math.max(0.2, 1.5 - danger * 1.2);
  const segWidth = 80;
  let d = "M 0,50 ";
  for (let i = 0; i < 20; i++) {
    const x = i * segWidth;
    d += `L ${x + 20},50 L ${x + 30},${50 - h} L ${x + 40},${50 + h} L ${x + 50},${50 - h * 0.5} L ${x + 60},50 L ${x + 80},50 `;
  }

  const keyframes = `@keyframes ekgSlide { from { transform: translateX(0); } to { transform: translateX(-${segWidth}px); } }`;

  return (
    <div className="absolute inset-x-0 top-[20%] flex justify-center pointer-events-none z-10 opacity-60 overflow-hidden" style={{ maskImage: 'linear-gradient(to right, transparent, black 20%, black 80%, transparent)' }}>
      <style dangerouslySetInnerHTML={{ __html: keyframes }} />
      <svg width="100%" height="100" viewBox="0 0 800 100" preserveAspectRatio="none" className="max-w-2xl w-full">
        <path d={d} fill="none" stroke={danger > 0.8 ? "#ff2a2a" : "white"} strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ animation: `ekgSlide ${dur}s linear infinite` }} />
      </svg>
    </div>
  );
}

export default function GameShell() {
  const engineRef = useRef<Engine | null>(null);
  const autoStartRef = useRef(false);
  const [runId, setRunId] = useState(0);
  const [state, setState] = useState<GameState>("idle");
  const [booted, setBooted] = useState(false);
  const [settings, setSettings] = useState({ volume: 1, quality: "high", sensitivity: 1, invertY: false });
  const [showSettings, setShowSettings] = useState(false);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [minimap, setMinimap] = useState<MinimapState | null>(null);
  const [pageLines, setPageLines] = useState<string[] | null>(null);
  const [stats, setStats] = useState({ pages: 0, seconds: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [banner, setBanner] = useState<{ title: string; hint: string } | null>(null);
  const [currentLevel, setCurrentLevel] = useState(0);
  const isTouch = useMediaQuery("(pointer: coarse)");
  const portrait = useMediaQuery("(orientation: portrait)");
  const [mobileSprint, setMobileSprint] = useState(false);
  // Force-landscape: on touch + portrait, rotate the entire UI 90deg via CSS
  const forceRotate = isTouch && portrait;

  // Automatically default to "normal" (optimized) graphics on mobile devices
  useEffect(() => {
    if (isTouch) {
      setSettings((prev) => (prev.quality === "high" ? { ...prev, quality: "normal" } : prev));
    }
  }, [isTouch]);

  // On mount, try to lock orientation to landscape (best-effort)
  useEffect(() => {
    if (!isTouch) return;
    const tryLock = async () => {
      try {
        // Fullscreen is required for orientation lock on most browsers
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen({ navigationUI: "hide" });
        }
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        if (o?.lock) await o.lock("landscape");
      } catch { /* silently fail — CSS force-rotate is the fallback */ }
    };
    // Attempt on first user interaction (click/touch)
    const handler = () => { tryLock(); document.removeEventListener("pointerdown", handler); };
    document.addEventListener("pointerdown", handler, { once: true });
    return () => document.removeEventListener("pointerdown", handler);
  }, [isTouch]);

  const [showTutorial, setShowTutorial] = useState(false);
  useEffect(() => {
    if (state === "playing" && runId === 0) {
      setShowTutorial(true);
      const id = setTimeout(() => setShowTutorial(false), 12000);
      return () => clearTimeout(id);
    } else {
      setShowTutorial(false);
    }
  }, [state, runId]);

  const bannerKindRef = useRef("");
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchRef = useRef(false);
  useEffect(() => {
    isTouchRef.current = isTouch;
  }, [isTouch]);

  useEffect(() => {
    initCrazyGames();
  }, []);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    engineRef.current?.setSettings(settings);
  }, [settings]);

  const callbacksRef = useRef<EngineCallbacks>({
    onState: (s) => {
      setState(s);
      if (s === "playing") {
        cgGameplayStart();
      } else {
        cgGameplayStop();
      }
      if (s !== "paused") setResuming(false); // clears "RESUMING…" feedback
    },
    onHud: (h) => {
      setHud(h);
      // Big objective banner whenever the objective *kind* changes (run
      // start, all pages found, door opened) — not on every counter tick.
      // New players were missing the tiny corner text entirely.
      const kind = h.objective.split("—")[0].trim();
      if (kind !== bannerKindRef.current) {
        bannerKindRef.current = kind;
        const hint =
          kind === "COLLECT THE PAGES"
            ? isTouchRef.current
              ? "PINNED TO THE WALLS — GET CLOSE, TAP TAKE PAGE"
              : "PINNED TO THE WALLS — PRESS [E] TO TAKE THEM"
            : kind === "FIND THE EXIT DOOR"
              ? "ALL PAGES FOUND — A DOOR HAS UNLOCKED SOMEWHERE"
              : "THROUGH THE DOOR — RUN";
        setBanner({ title: h.objective, hint });
        if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = setTimeout(() => setBanner(null), 5200);
      }
    },
    onMinimap: (m) => setMinimap(m),
    onPageText: (lines) => setPageLines(lines),
    onStats: (s) => setStats(s),
    onToast: (m) => setToast(m),
    onNextLevel: () => {
      // Transition to next level — dispose current engine & remount with new levelIndex
      autoStartRef.current = true;
      setBooted(false);
      setState("idle");
      setHud(INITIAL_HUD);
      setMinimap(null);
      setPageLines(null);
      setBanner(null);
      bannerKindRef.current = "";
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      engineRef.current = null;
      setCurrentLevel((prev) => prev + 1);
      setRunId((r) => r + 1);
    },
  });

  const handleReady = useCallback((engine: Engine) => {
    engineRef.current = engine;
    engine.setSettings(settingsRef.current);
    setBooted(true);
    if (autoStartRef.current) {
      autoStartRef.current = false;
      engine.start();
    }
  }, []);

  // Page text fades out on its own.
  useEffect(() => {
    if (!pageLines) return;
    const id = setTimeout(() => setPageLines(null), 6500);
    return () => clearTimeout(id);
  }, [pageLines]);

  // Toasts fade out on their own.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const requestLandscapeFullscreen = async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      }
      const o = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      if (o?.lock) {
        await o.lock("landscape");
      }
    } catch (err) {
      console.warn("Fullscreen/orientation lock not supported or cancelled", err);
    }
  };

  const attemptOrientationLock = async () => {
    if (isTouch) {
      await requestLandscapeFullscreen();
    }
  };

  // Trigger a resize event after force-rotate so the engine picks up the new dimensions
  useEffect(() => {
    if (isTouch) {
      // Small delay so the CSS transform applies before the engine measures
      const id = setTimeout(() => window.dispatchEvent(new Event("resize")), 120);
      return () => clearTimeout(id);
    }
  }, [isTouch, portrait]);

  const begin = () => {
    attemptOrientationLock();
    engineRef.current?.start();
  };
  const resume = () => {
    attemptOrientationLock();
    setResuming(true);
    engineRef.current?.resume();
  };
  /** Tear down the current run and remount a fresh engine (new maze). */
  const resetRun = (autoStart: boolean) => {
    autoStartRef.current = autoStart;
    setBooted(false);
    setState("idle");
    setHud(INITIAL_HUD);
    setMinimap(null);
    setPageLines(null);
    setBanner(null);
    setMobileSprint(false);
    bannerKindRef.current = ""; // next run re-announces the objective
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    engineRef.current = null;
    setCurrentLevel(0);
    setRunId((r) => r + 1);
  };
  const retry = async () => {
    await showMidgameAd();
    resetRun(true);
  };
  const exitToMenu = () => resetRun(false);

  const mmss = useMemo(() => {
    const m = Math.floor(stats.seconds / 60);
    const s = stats.seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, [stats.seconds]);

  // When force-rotating, we swap width/height so children render in "landscape" dimensions
  const forceRotateStyle: React.CSSProperties = forceRotate
    ? {
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vh",   // swap: use viewport height as width
        height: "100vw",  // swap: use viewport width as height
        transform: "rotate(90deg)",
        transformOrigin: "top left",
        marginLeft: "100vw", // push it back into view after rotation
        overflow: "hidden",
      }
    : {};

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden bg-black"
      style={forceRotateStyle}
    >
      <GameCanvas key={runId} callbacksRef={callbacksRef} onReady={handleReady} levelIndex={currentLevel} />

      {/* dev/cheat toast — sits above everything */}
      {toast && (
        <div className="font-elite pointer-events-none absolute left-1/2 top-[8%] z-20 -translate-x-1/2 border border-emerald-200/20 bg-black/80 px-5 py-2 text-[12px] tracking-[0.25em] text-emerald-100/90 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
          {toast}
        </div>
      )}

      {/* touch controls — work in both portrait and landscape */}
      {isTouch && state === "playing" && (
        <TouchControls
          engineRef={engineRef}
          prompt={hud.prompt}
          flashlight={hud.flashlight}
          sneaking={hud.sneaking}
          sprint={mobileSprint}
          setSprint={setMobileSprint}
          sensitivity={settings.sensitivity}
        />
      )}

      {/* ------------------------------ HUD ------------------------------ */}
      {(state === "playing" || state === "dying") && (
        <div className="pointer-events-none absolute inset-0 cursor-none">
          {/* crosshair */}
          <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-100/40" />

          {/* minimap */}
          {hud.mapCheat && <Minimap data={minimap} />}

          {/* tutorial overlay */}
          {showTutorial && (
            <div className="pointer-events-none absolute top-[22%] flex w-full justify-center animate-[pulse_3s_ease-in-out_infinite]">
              {isTouch ? (
                <div className="font-elite flex flex-col items-center gap-2 text-amber-100/90 tracking-[0.25em] text-xs sm:text-sm [text-shadow:0_0_10px_rgba(255,225,150,0.4)] bg-black/60 px-6 py-3 rounded-lg border border-amber-100/20">
                  <p>🕹️ LEFT AREA: DRAG TO WALK</p>
                  <p>👆 RIGHT AREA: DRAG TO LOOK</p>
                  <p>⚡ TAP RUN / SNEAK / TORCH BUTTONS</p>
                </div>
              ) : (
                <div className="font-elite flex gap-12 text-amber-100/80 text-sm tracking-[0.3em] [text-shadow:0_0_10px_rgba(255,225,150,0.4)]">
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex gap-1">
                      <kbd className="rounded border border-amber-100/40 px-2 py-1 bg-black/40">W</kbd>
                    </div>
                    <div className="flex gap-1">
                      <kbd className="rounded border border-amber-100/40 px-2 py-1 bg-black/40">A</kbd>
                      <kbd className="rounded border border-amber-100/40 px-2 py-1 bg-black/40">S</kbd>
                      <kbd className="rounded border border-amber-100/40 px-2 py-1 bg-black/40">D</kbd>
                    </div>
                    <span className="mt-2 text-[10px]">WALK</span>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-1">
                    <div className="flex h-full items-center justify-center rounded border border-amber-100/40 px-4 py-2 bg-black/40">MOUSE</div>
                    <span className="mt-2 text-[10px]">LOOK</span>
                  </div>
                  <div className="flex flex-col gap-2 justify-center ml-4">
                    <div className="text-[10px]"><kbd className="rounded border border-amber-100/40 px-1.5 py-0.5 bg-black/40 mr-2">P</kbd> PAUSE</div>
                    <div className="text-[10px]"><kbd className="rounded border border-amber-100/40 px-1.5 py-0.5 bg-black/40 mr-2">C</kbd> SNEAK</div>
                    <div className="text-[10px]"><kbd className="rounded border border-amber-100/40 px-1.5 py-0.5 bg-black/40 mr-2">F</kbd> TORCH</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* level indicator */}
          <div className="font-elite absolute right-5 top-4 text-xs tracking-[0.35em] text-amber-100/60 [text-shadow:0_0_10px_rgba(255,225,150,0.3)]">
            {currentLevel === 0 ? "LEVEL 0 — THE LOBBY" : "LEVEL 1 — HABITABLE ZONE"}
          </div>

          {/* objective — bright + glowing so new players actually see it */}
          <div className="font-elite absolute left-5 top-4 text-sm tracking-[0.25em] text-amber-50/95 [text-shadow:0_0_14px_rgba(255,225,150,0.5)]">
            {hud.objective}
          </div>

          {/* objective banner — announces goal changes front and center */}
          {banner && (
            <div className="objective-pop absolute left-1/2 top-[28%] border-y border-amber-100/15 bg-black/45 px-10 py-4 text-center shadow-[0_0_50px_rgba(0,0,0,0.55)] backdrop-blur-[2px]">
              <div className="font-elite text-[11px] tracking-[0.55em] text-amber-100/55">
                OBJECTIVE
              </div>
              <div className="font-elite mt-2 whitespace-nowrap text-2xl tracking-[0.3em] text-amber-50 [text-shadow:0_0_26px_rgba(255,230,160,0.7)]">
                {banner.title}
              </div>
              <div className="font-elite mt-3 text-[12px] tracking-[0.28em] text-amber-100/80">
                {banner.hint}
              </div>
            </div>
          )}

          {/* active cheats — always visible while any cheat is on */}
          {hud.cheats && (
            <div className="font-elite absolute left-5 top-10 text-[11px] tracking-[0.25em] text-emerald-300/80 [text-shadow:0_0_10px_rgba(60,255,160,0.35)]">
              CHEATS: {hud.cheats}
            </div>
          )}

          {/* sneaking indicator */}
          {hud.sneaking && (
            <div className="font-elite absolute bottom-14 left-1/2 -translate-x-1/2 text-[11px] tracking-[0.4em] text-amber-100/45">
              — SNEAKING —
            </div>
          )}

          {/* pages */}
          <div className="font-elite absolute bottom-4 left-5 text-sm tracking-[0.3em] text-amber-100/60">
            PAGES {hud.pages}/{hud.totalPages}
          </div>

          {/* key hints (desktop only) */}
          {!isTouch && (
            <div className="font-elite absolute bottom-4 right-5 text-[11px] tracking-[0.25em] text-amber-100/35">
              [F] TORCH {hud.flashlight ? "ON" : "OFF"} · [SHIFT] RUN · [C] SNEAK{" "}
              {hud.sneaking ? "ON" : "OFF"}
            </div>
          )}

          {/* heartbeat / danger ui */}
          <EKG danger={hud.dangerLevel} />

          {/* stamina */}
          {hud.stamina < 0.995 && (
            <div className="absolute bottom-9 left-1/2 h-[3px] w-44 -translate-x-1/2 overflow-hidden rounded bg-white/10">
              <div
                className={`h-full transition-[width] duration-150 ${
                  hud.stamina < 0.25 ? "bg-red-400/80" : "bg-amber-100/70"
                }`}
                style={{ width: `${hud.stamina * 100}%` }}
              />
            </div>
          )}

          {/* interaction prompt */}
          {hud.prompt && (
            <div className="font-elite absolute bottom-[18%] left-1/2 -translate-x-1/2 animate-pulse text-base tracking-[0.3em] text-amber-100/90 [text-shadow:0_0_12px_rgba(255,220,150,0.5)]">
              {hud.prompt}
            </div>
          )}

          {/* collected page readout */}
          {pageLines && (
            <div className="page-pop absolute left-1/2 top-[16%] -translate-x-1/2">
              <div className="font-elite max-w-sm -rotate-1 border border-amber-100/10 bg-[#171410]/90 px-7 py-5 text-center text-[15px] leading-7 text-amber-100/85 shadow-[0_0_60px_rgba(0,0,0,0.9)]">
                {pageLines.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --------------------------- START MENU --------------------------- */}
      {state === "idle" && (
        <Overlay vhs>
          <>
              <div className="flicker-slow font-elite text-[11px] tracking-[0.6em] text-amber-200/40">
                LEVEL 0
              </div>
              <h1 className="vhs-title font-elite mt-3 text-5xl tracking-[0.15em] text-amber-50/95 sm:text-7xl sm:tracking-[0.18em] md:text-8xl">
                BACKROOMS
              </h1>

              <div className="mt-12 flex flex-col items-center gap-4 h-16 justify-center">
                {!booted ? (
                  <div className="w-64 w-full max-w-[16rem]">
                    <div className="mb-3 text-center font-elite text-[10px] tracking-[0.3em] text-amber-100/50 animate-pulse">
                      GENERATING LEVEL...
                    </div>
                    <div className="h-[2px] w-full bg-amber-100/10">
                      <div 
                        className="h-full bg-amber-100/60 transition-all duration-[3000ms] ease-out" 
                        style={{ width: '90%' }} 
                        ref={(el) => { if (el) { el.style.width = '0%'; setTimeout(() => el.style.width = '90%', 50); } }}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={begin}
                      className="font-elite group flex items-center gap-3 sm:gap-4 border border-white/80 bg-transparent px-8 py-2.5 sm:px-10 sm:py-3 text-base sm:text-lg tracking-[0.3em] sm:tracking-[0.5em] text-white transition-all duration-500 hover:bg-white hover:text-black hover:shadow-[0_0_40px_rgba(255,255,255,0.5)]"
                    >
                      <svg viewBox="0 0 10 12" className="h-3 w-3 sm:h-4 sm:w-4 fill-current transition-transform duration-500 group-hover:translate-x-2" aria-hidden="true">
                        <path d="M0 0 L10 6 L0 12 Z" />
                      </svg>
                      ENTER
                    </button>
                    <button
                      onClick={() => setShowSettings(true)}
                      className="font-elite mt-4 text-[12px] tracking-[0.35em] text-amber-100/35 transition-colors hover:text-amber-100/70"
                    >
                      ⚙ SETTINGS
                    </button>
                  </>
                )}
              </div>

              <p className="font-elite mt-8 text-[11px] tracking-[0.3em] text-amber-100/25">
                HEADPHONES STRONGLY RECOMMENDED
              </p>
          </>
        </Overlay>
      )}

      {/* ----------------------------- PAUSED ----------------------------- */}
      {state === "paused" && (
        <Overlay>
          <h2 className="font-elite text-4xl tracking-[0.3em] text-amber-100/80">
            PAUSED
          </h2>
          <p className="font-elite mt-4 text-sm tracking-[0.2em] text-amber-100/40">
            it is still in there. it does not pause.
          </p>
          <ArmedButton
            onClick={resume}
            disabled={resuming}
            className="font-elite mt-8 border border-amber-100/30 px-10 py-3 tracking-[0.4em] text-amber-100/80 transition-all hover:border-amber-100/80 hover:bg-amber-100/5 disabled:opacity-50"
          >
            {resuming ? "RESUMING…" : "RESUME"}
          </ArmedButton>
          <ArmedButton
            onClick={exitToMenu}
            className="font-elite mt-4 border border-amber-100/15 px-10 py-2.5 text-sm tracking-[0.4em] text-amber-100/45 transition-all hover:border-red-300/50 hover:text-red-200/80 disabled:opacity-50"
          >
            EXIT TO MENU
          </ArmedButton>

          <p className="font-elite mt-8 text-[10px] tracking-[0.25em] text-amber-100/20">
            THE RUN IS LOST. THE PAGES STAY.
          </p>
        </Overlay>
      )}

      {/* Settings Menu */}
      {showSettings && (
        <Overlay>
          <h2 className="font-elite text-4xl tracking-[0.3em] text-amber-100/80 mb-10">
            SETTINGS
          </h2>
          
          <div className="flex w-full max-w-sm flex-col gap-8 font-elite text-sm tracking-[0.2em] text-amber-100/70">
            <label className="flex flex-col gap-3">
              <span className="text-amber-100/50">VOLUME</span>
              <input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={(e) => setSettings({...settings, volume: parseFloat(e.target.value)})} className="w-full accent-amber-100/70" />
            </label>

            <label className="flex flex-col gap-3">
              <span className="text-amber-100/50">GRAPHICS QUALITY</span>
              <select value={settings.quality} onChange={(e) => setSettings({...settings, quality: e.target.value})} className="bg-black/80 border border-amber-100/20 text-amber-100/80 px-3 py-2 outline-none">
                <option value="low">LOW (BATTERY SAVER)</option>
                <option value="normal">NORMAL (RECOMMENDED FOR MOBILE)</option>
                <option value="high">HIGH (PC FIDELITY)</option>
              </select>
            </label>

            <label className="flex flex-col gap-3">
              <span className="text-amber-100/50">LOOK SENSITIVITY</span>
              <input type="range" min="0.1" max="3" step="0.1" value={settings.sensitivity} onChange={(e) => setSettings({...settings, sensitivity: parseFloat(e.target.value)})} className="w-full accent-amber-100/70" />
            </label>

            <label className="flex items-center gap-4 cursor-pointer">
              <input type="checkbox" checked={settings.invertY} onChange={(e) => setSettings({...settings, invertY: e.target.checked})} className="w-5 h-5 accent-amber-100/70 bg-black/80 border border-amber-100/30 rounded-sm appearance-none checked:bg-amber-100/70 flex items-center justify-center after:content-[''] after:w-2 after:h-2 after:bg-[#12100b] after:rounded-sm checked:after:block after:hidden" />
              <span className="text-amber-100/50">INVERT Y-AXIS</span>
            </label>
          </div>

          <ArmedButton
            onClick={() => setShowSettings(false)}
            className="font-elite mt-12 border border-amber-100/30 px-12 py-3 tracking-[0.4em] text-amber-100/80 transition-all hover:border-amber-100/80 hover:bg-amber-100/5"
          >
            BACK
          </ArmedButton>
        </Overlay>
      )}



      {/* ------------------------------ DEAD ------------------------------ */}
      {state === "dead" && (
        <Overlay tint="red">
          <h2 className="font-elite glitch-text text-5xl tracking-[0.25em] text-red-300/90 [text-shadow:0_0_40px_rgba(255,40,40,0.4)]">
            YOU WERE TAKEN
          </h2>
          <p className="font-elite mt-6 text-sm tracking-[0.25em] text-red-200/40">
            PAGES FOUND — {stats.pages}/8 · SURVIVED — {mmss}
          </p>
          <p className="font-elite mt-2 text-xs tracking-[0.2em] text-red-200/30">
            the backrooms keep what they catch.
          </p>
          <ArmedButton
            onClick={retry}
            className="font-elite mt-10 border border-red-300/30 px-10 py-3 tracking-[0.4em] text-red-200/80 transition-all hover:border-red-300/80 hover:bg-red-300/5 disabled:opacity-40"
          >
            WAKE UP AGAIN
          </ArmedButton>
        </Overlay>
      )}

      {/* ------------------------------ WON ------------------------------ */}
      {state === "won" && (
        <Overlay tint="light">
          <h2 className="font-elite text-5xl tracking-[0.25em] text-amber-50 [text-shadow:0_0_50px_rgba(255,255,220,0.8)]">
            YOU GOT OUT
          </h2>
          <p className="font-elite mt-6 text-sm tracking-[0.25em] text-amber-100/60">
            ALL 8 PAGES · ESCAPED IN {mmss}
          </p>
          <p className="font-elite mt-2 text-xs tracking-[0.2em] text-amber-100/40">
            …or did you just noclip into level 1?
          </p>
          <ArmedButton
            onClick={retry}
            className="font-elite mt-10 border border-amber-100/40 px-10 py-3 tracking-[0.4em] text-amber-100/90 transition-all hover:border-amber-100/90 hover:bg-amber-100/10 disabled:opacity-40"
          >
            GO BACK IN
          </ArmedButton>
        </Overlay>
      )}
    </div>
  );
}

/**
 * A button that ignores input for its first 450ms on screen — soaks up the
 * second half of an accidental double-click (which used to instantly retry
 * or quit a run the moment an overlay appeared).
 */
function ArmedButton({
  children,
  onClick,
  className,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setArmed(true), 450);
    return () => clearTimeout(id);
  }, []);
  return (
    <button onClick={onClick} disabled={!armed || disabled} className={className}>
      {children}
    </button>
  );
}



/* ------------------------------ touch UI ------------------------------ */

function TouchControls({
  engineRef,
  prompt,
  flashlight,
  sneaking,
  sprint,
  setSprint,
  sensitivity = 1,
}: {
  engineRef: React.RefObject<Engine | null>;
  prompt: string | null;
  flashlight: boolean;
  sneaking: boolean;
  sprint: boolean;
  setSprint: React.Dispatch<React.SetStateAction<boolean>>;
  sensitivity?: number;
}) {
  const [stickCenter, setStickCenter] = useState<{ x: number; y: number } | null>(null);
  const [knobDelta, setKnobDelta] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const stickPointerId = useRef<number | null>(null);
  const lookLast = useRef<{ id: number; x: number; y: number } | null>(null);

  const startStick = (e: React.PointerEvent) => {
    if (stickPointerId.current !== null) return;
    stickPointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setStickCenter({ x: e.clientX, y: e.clientY });
    setKnobDelta({ x: 0, y: 0 });
  };

  const moveStick = (e: React.PointerEvent) => {
    if (stickPointerId.current !== e.pointerId || !stickCenter) return;
    let dx = e.clientX - stickCenter.x;
    let dy = e.clientY - stickCenter.y;
    const maxR = 52;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    setKnobDelta({ x: dx, y: dy });
    engineRef.current?.setTouchMove(dx / maxR, dy / maxR);
  };

  const endStick = (e: React.PointerEvent) => {
    if (stickPointerId.current !== e.pointerId) return;
    stickPointerId.current = null;
    setStickCenter(null);
    setKnobDelta({ x: 0, y: 0 });
    engineRef.current?.setTouchMove(0, 0);
  };

  return (
    <div
      className="absolute inset-0 z-20 select-none overflow-hidden"
      style={{ touchAction: "none", WebkitTouchCallout: "none" }}
    >
      {/* Left movement zone — covers lower-left region */}
      <div
        className="absolute bottom-0 left-0 top-[20%] w-[48%]"
        style={{ touchAction: "none" }}
        onPointerDown={startStick}
        onPointerMove={moveStick}
        onPointerUp={endStick}
        onPointerCancel={endStick}
      >
        {/* Default stick placeholder */}
        {!stickCenter && (
          <div
            className="absolute bottom-8 left-8 flex h-32 w-32 items-center justify-center rounded-full border border-amber-100/25 bg-black/35 backdrop-blur-[1px] pointer-events-none"
            style={{
              left: "max(1.5rem, env(safe-area-inset-left, 1.5rem))",
              bottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
            }}
          >
            <div className="h-12 w-12 rounded-full border border-amber-100/40 bg-amber-100/15" />
            <span className="absolute bottom-[-1.3rem] font-elite text-[9px] tracking-[0.2em] text-amber-100/40">
              DRAG TO WALK
            </span>
          </div>
        )}

        {/* Dynamic floating stick base & knob */}
        {stickCenter && (
          <div
            className="pointer-events-none fixed h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-100/35 bg-black/45 backdrop-blur-xs"
            style={{ left: stickCenter.x, top: stickCenter.y }}
          >
            <div
              className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-100/80 bg-amber-100/25 shadow-[0_0_15px_rgba(255,225,150,0.3)]"
              style={{
                transform: `translate(calc(-50% + ${knobDelta.x}px), calc(-50% + ${knobDelta.y}px))`,
              }}
            />
          </div>
        )}
      </div>

      {/* Right camera look pad (right 52% of screen) */}
      <div
        className="absolute bottom-0 right-0 top-0 w-[52%]"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          lookLast.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const last = lookLast.current;
          if (!last || last.id !== e.pointerId) return;
          const factor = 2.1 * Math.max(0.4, Math.min(2.5, sensitivity));
          const dx = (e.clientX - last.x) * factor;
          const dy = (e.clientY - last.y) * factor;
          engineRef.current?.touchLook(dx, dy);
          lookLast.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          if (lookLast.current?.id === e.pointerId) lookLast.current = null;
        }}
        onPointerCancel={(e) => {
          if (lookLast.current?.id === e.pointerId) lookLast.current = null;
        }}
      />

      {/* Action buttons on the right side */}
      <div
        className="pointer-events-none absolute bottom-8 right-6 z-30 flex flex-col items-end gap-3"
        style={{
          right: "max(1.25rem, env(safe-area-inset-right, 1.25rem))",
          bottom: "max(1.25rem, env(safe-area-inset-bottom, 1.25rem))",
        }}
      >
        {/* Interact / Take Page [E] Button */}
        {prompt && (
          <button
            className="pointer-events-auto font-elite animate-pulse rounded-lg border-2 border-amber-100 bg-amber-100/25 px-6 py-3.5 text-sm font-bold tracking-[0.25em] text-amber-50 shadow-[0_0_25px_rgba(255,230,160,0.5)] active:scale-95 active:bg-amber-100/40"
            onPointerDown={(e) => {
              e.stopPropagation();
              engineRef.current?.touchInteract();
            }}
          >
            {prompt.replace("[E] ", "")}
          </button>
        )}

        {/* Action control buttons */}
        <div className="pointer-events-auto flex items-center gap-2">
          {/* RUN / SPRINT TOGGLE */}
          <button
            className={`font-elite rounded-lg border px-4 py-3 text-xs tracking-[0.2em] transition-all active:scale-95 ${
              sprint
                ? "border-amber-100 bg-amber-100/35 text-amber-50 shadow-[0_0_18px_rgba(255,225,150,0.4)] font-bold"
                : "border-amber-100/30 bg-black/50 text-amber-100/70 hover:bg-black/70"
            }`}
            onPointerDown={(e) => {
              e.stopPropagation();
              const next = !sprint;
              setSprint(next);
              engineRef.current?.setTouchSprint(next);
            }}
          >
            RUN {sprint ? "ON" : "OFF"}
          </button>

          {/* SNEAK TOGGLE */}
          <button
            className={`font-elite rounded-lg border px-4 py-3 text-xs tracking-[0.2em] transition-all active:scale-95 ${
              sneaking
                ? "border-amber-100/80 bg-amber-100/30 text-amber-100 font-bold"
                : "border-amber-100/30 bg-black/50 text-amber-100/70 hover:bg-black/70"
            }`}
            onPointerDown={(e) => {
              e.stopPropagation();
              engineRef.current?.setSneak(!sneaking);
            }}
          >
            SNEAK
          </button>

          {/* TORCH TOGGLE */}
          <button
            className={`font-elite rounded-lg border px-4 py-3 text-xs tracking-[0.2em] transition-all active:scale-95 ${
              flashlight
                ? "border-amber-100/70 bg-amber-100/25 text-amber-100 font-bold"
                : "border-amber-100/30 bg-black/50 text-amber-100/60 hover:bg-black/70"
            }`}
            onPointerDown={(e) => {
              e.stopPropagation();
              engineRef.current?.touchTorch();
            }}
          >
            TORCH
          </button>
        </div>
      </div>

      {/* Pause Button in top-right */}
      <button
        className="pointer-events-auto font-elite absolute top-4 right-5 rounded-lg border border-amber-100/40 bg-black/60 px-4 py-2 text-xs tracking-[0.2em] text-amber-100/80 shadow-md active:bg-amber-100/20"
        style={{
          top: "max(1rem, env(safe-area-inset-top, 1rem))",
          right: "max(1.25rem, env(safe-area-inset-right, 1.25rem))",
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          engineRef.current?.pause();
        }}
      >
        ❚❚ PAUSE
      </button>
    </div>
  );
}

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false, // SSR: assume desktop, corrected on hydration
  );
}

function Overlay({
  children,
  tint = "dark",
  vhs = false,
}: {
  children: React.ReactNode;
  tint?: "dark" | "red" | "light";
  vhs?: boolean;
}) {
  const bg = vhs
    ? "bg-black"
    : tint === "red"
      ? "bg-[#180404]/90"
      : tint === "light"
        ? "bg-[#15130c]/85"
        : "bg-[#0a0905]/92";
  return (
    <div className={`absolute inset-0 z-10 ${bg}`}>
      {/* Background image with creepy slow zoom + breathing */}
      {vhs && (
        <div className="absolute inset-0 overflow-hidden breathing-effect">
          <img
            src="/bg-image.jpg"
            alt=""
            className="bg-creepy-zoom absolute inset-0 h-full w-full object-cover opacity-70"
          />
          {/* Monster eyes glow */}
          <div className="monster-eyes-glow pointer-events-none absolute inset-0" />
        </div>
      )}
      {/* Dark red pulsing vignette */}
      {vhs && <div className="horror-vignette pointer-events-none absolute inset-0" />}
      {/* Floating dust particles */}
      {vhs && <DustParticles />}
      {/* Fog effect */}
      {vhs && <div className="fog-effect pointer-events-none absolute inset-x-0 bottom-0 h-[45%]" />}
      {/* Blood drips */}
      {vhs && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden">
          <div className="blood-drip blood-drip-1" />
          <div className="blood-drip blood-drip-2" />
          <div className="blood-drip blood-drip-3" />
          <div className="blood-drip blood-drip-4" />
          <div className="blood-drip blood-drip-5" />
        </div>
      )}
      {/* Flickering light overlay */}
      {vhs && <div className="light-flicker pointer-events-none absolute inset-0" />}
      {/* Scroll layer: on short screens (phone landscape) the menu is taller
          than the viewport — center when it fits, scroll when it doesn't.
          (Flex centering directly on the overflow container would clip the
          top of the content with no way to reach it.) */}
      <div className="absolute inset-0 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full flex-col items-center justify-center px-6 py-10">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Floating dust particles — lightweight CSS-only */
function DustParticles() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          className="dust-particle absolute rounded-full"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            width: `${1.5 + Math.random() * 2.5}px`,
            height: `${1.5 + Math.random() * 2.5}px`,
            opacity: 0.15 + Math.random() * 0.35,
            animationDuration: `${12 + Math.random() * 20}s`,
            animationDelay: `${Math.random() * -20}s`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Analog tape snow: a tiny canvas of random grayscale redrawn ~12fps and
 * stretched across the screen. Cheap (20k pixels) and reads far more like
 * a real camcorder than any CSS trick.
 */
function VHSNoise() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const W = 320, H = 180;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const d = img.data;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 80) return; // ~12fps — chunky, like real snow
      last = t;
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.random() * 255;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.11] [image-rendering:pixelated]"
    />
  );
}

/** Camcorder on-screen display: blinking REC + a ticking tape counter. */
function RecOSD() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return (
    <>
      <div className="font-elite pointer-events-none absolute left-5 top-4 flex items-center gap-2 text-[12px] tracking-[0.3em] text-amber-50/70">
        <span className="rec-dot h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(255,40,40,0.8)]" />
        REC
      </div>
      <div className="font-elite pointer-events-none absolute right-5 top-4 text-[12px] tracking-[0.25em] text-amber-50/50">
        SP {h}:{m}:{s}
      </div>
    </>
  );
}
