"use client";

/**
 * FloatingMiniPlayer (فاز A2 — RA2.1/RM2.2, A.2.3): the SCREEN-space
 * AUDIO player overlay.
 *
 * Binding contract (STRICT REUSE of the video FloatingPlayerWindow's
 * discovered mechanism — A.2.9: NO new dependency):
 * - a React PORTAL above every panel, NO scrim — the canvas stays
 *   interactive (the window never moves with the camera);
 * - draggable by its title bar + resizable via the corner handle
 *   (min 320×100, default 400×120) — the SAME hand-rolled
 *   pointer-capture pattern the video window uses;
 * - ONE instance at a time ACROSS players: opening this closes the
 *   video window (and vice-versa — the store owns the hand-off);
 * - the source is fetched ONCE into a blob URL (typed from the object's
 *   MIME) and REVOKED on close; the `<audio>` element exists ONLY while
 *   the window is open — closing STOPS playback (no background audio,
 *   A.3 NON-GOALS);
 * - NO autoplay: opens paused at 0:00;
 * - NO fullscreen button (audio only, RM2.2);
 * - last position/size/volume/speed persist in APP data
 *   (`miniPlayerSettings.ts`'s dedicated localStorage slot);
 * - custom Persian/RTL chrome (Vazirmatn, theme-aware tokens): play/
 *   pause, seek slider + buffered range, ±۱۰s skips, volume + mute,
 *   speed menu (۰٫۵/۱/۱٫۵/۲), close; the time readout follows the
 *   Persian-digits setting; keyboard: Space, ←/→ (±۱۰s in the
 *   RTL-correct direction), ↑/↓ volume, M mute, Esc close.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
  X,
  Rewind,
  FastForward,
  Music,
} from "lucide-react";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import { formatTimecode } from "@/ui/i18n/numbers";
import { Application, Services } from "@/App";
import { isAudioObject } from "@/core/model/AudioObject";
import { assetUrlOf } from "@/media/AssetUrlResolver";
import { isInteractiveTitleBarTarget } from "@/ui/player/titleBarDrag";
import {
  MINI_PLAYER_MIN_HEIGHT,
  MINI_PLAYER_MIN_WIDTH,
  MINI_PLAYER_SPEEDS,
  readMiniPlayerSettings,
  writeMiniPlayerSettings,
  type MiniPlayerSettings,
} from "@/ui/player/miniPlayerSettings";
import { cn } from "@/lib/utils";

/** Skip step of the ±10s buttons (seconds, RM2.2). */
const SKIP_SECONDS = 10;

/** Volume step of the ↑/↓ keys. */
const VOLUME_STEP = 0.1;

/** The floating mini-player window (portal; nothing renders while closed). */
export default function FloatingMiniPlayer(): ReactNode {
  const { t, language } = useTranslation();
  const objectId = useUiStore((state) => state.playerAudioId);
  const closePlayer = useUiStore((state) => state.closeAudioPlayer);
  const persianDigits = useUiStore((state) => state.persianDigits);

  const [settings, setSettings] = useState<MiniPlayerSettings>(() =>
    readMiniPlayerSettings(),
  );
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [bufferedRatio, setBufferedRatio] = useState(0);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [meta, setMeta] = useState<{ name: string } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** The current clip's blob URL (state — StrictMode-safe re-renders). */
  const [src, setSrc] = useState<string | null>(null);
  const srcRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Swaps the clip's blob URL (revoking whatever came before). */
  const setSrcUrl = useCallback((url: string | null): void => {
    if (srcRef.current !== null && srcRef.current !== url) {
      URL.revokeObjectURL(srcRef.current);
    }
    srcRef.current = url;
    setSrc(url);
  }, []);

  /** Revokes the current clip's blob URL (close/cleanup). */
  const revokeCurrentUrl = useCallback((): void => {
    if (srcRef.current !== null) {
      URL.revokeObjectURL(srcRef.current);
      srcRef.current = null;
    }
    setSrc(null);
  }, []);

  const digitInput = persianDigits && language === "fa" ? "fa" : "en";
  const rtl = language === "fa";

  /**
   * Persists the settings (every mutation flows through here so the
   * window's state survives restarts).
   */
  const updateSettings = useCallback((patch: Partial<MiniPlayerSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      writeMiniPlayerSettings(next);
      return next;
    });
  }, []);

  /** Loads the object's bytes into a blob URL (revoked on close). */
  useEffect(() => {
    if (objectId === null) {
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    abortRef.current = abort;
    void Application.boot().then((context) => {
      if (cancelled) {
        return;
      }
      // Resetting the clip state inside the async continuation (not
      // the effect body) — no cascading-render lint, same semantics.
      setReady(false);
      setPlaying(false);
      setCurrentMs(0);
      setDurationMs(0);
      setBufferedRatio(0);
      const scene = context.tryGet(Services.scene);
      const object =
        scene !== undefined ? scene.findById(objectId) : undefined;
      if (object === undefined || !isAudioObject(object)) {
        closePlayer();
        return;
      }
      setMeta({ name: object.originalName });
      const url = assetUrlOf(object.assetHash, object.mimeType);
      if (url === null) {
        closePlayer();
        return;
      }
      void fetch(url, { signal: abort.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error("asset fetch failed");
          }
          return response.blob();
        })
        .then((blob) => {
          if (cancelled) {
            return;
          }
          const typed = blob.type.startsWith("audio/")
            ? blob
            : new Blob([blob], { type: "audio/mpeg" });
          const url = URL.createObjectURL(typed);
          setSrcUrl(url);
          setReady(true);
        })
        .catch(() => {
          if (!cancelled) {
            closePlayer();
          }
        });
    });
    return () => {
      cancelled = true;
      abort.abort();
      // Opening another clip (or closing) releases THIS blob URL
      // immediately — no leaked decoders between sessions.
      revokeCurrentUrl();
    };
  }, [objectId, closePlayer, setSrcUrl, revokeCurrentUrl]);

  /**
   * Closes the player: stop playback, revoke the blob URL, destroy the
   * element (closing STOPS audio — no background playback, A.3).
   */
  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio !== null) {
      audio.pause();
    }
    revokeCurrentUrl();
    setSpeedMenuOpen(false);
    closePlayer();
  }, [closePlayer, revokeCurrentUrl]);

  /** Revokes on unmount (HMR/StrictMode safety). */
  useEffect(() => {
    return () => {
      revokeCurrentUrl();
    };
  }, [revokeCurrentUrl]);

  /** The audio element's live state → React (timeupdate/loadedmetadata). */
  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null || !ready) {
      return;
    }
    const onTime = (): void => setCurrentMs(audio.currentTime * 1000);
    const onDuration = (): void => {
      setDurationMs(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
    };
    const onProgress = (): void => {
      if (audio.buffered.length > 0 && audio.duration > 0) {
        setBufferedRatio(audio.buffered.end(audio.buffered.length - 1) / audio.duration);
      }
    };
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("progress", onProgress);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("progress", onProgress);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [ready]);

  /** Applies the persisted volume/speed to the element. */
  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    audio.volume = settings.volume;
    audio.muted = settings.muted;
    audio.playbackRate = settings.speed;
  }, [settings.volume, settings.muted, settings.speed, ready]);

  /** Toggle play/pause. */
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  /** Seeks by a signed delta (seconds), clamped. */
  const skip = useCallback(
    (deltaSeconds: number) => {
      const audio = audioRef.current;
      if (audio === null) {
        return;
      }
      const target = Math.min(
        Math.max(0, audio.currentTime + deltaSeconds),
        Number.isFinite(audio.duration) ? audio.duration : Number.MAX_SAFE_INTEGER,
      );
      audio.currentTime = target;
      setCurrentMs(target * 1000);
    },
    [],
  );

  /** Seeks to an absolute ratio of the duration (the slider). */
  const seekToRatio = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (audio === null || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, ratio));
    audio.currentTime = clamped * audio.duration;
    setCurrentMs(clamped * audio.duration * 1000);
  }, []);

  /** Escape closes from ANYWHERE (document-level — the window may not
   * hold focus when the user re-enters the canvas mid-playback). */
  useEffect(() => {
    if (objectId === null) {
      return;
    }
    const onDocumentKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onDocumentKey, true);
    return () => {
      document.removeEventListener("keydown", onDocumentKey, true);
    };
  }, [objectId, close]);

  /** Keyboard while the window is focused (RM2.2 — RTL-correct). */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      switch (event.key) {
        case " ":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          event.preventDefault();
          // RTL-correct direction (A.2.8): in the RTL chrome LEFT moves
          // FORWARD on the (right-to-left) timeline.
          skip(rtl ? SKIP_SECONDS : -SKIP_SECONDS);
          break;
        case "ArrowRight":
          event.preventDefault();
          skip(rtl ? -SKIP_SECONDS : SKIP_SECONDS);
          break;
        case "ArrowUp":
          event.preventDefault();
          updateSettings({
            volume: Math.min(1, settings.volume + VOLUME_STEP),
          });
          break;
        case "ArrowDown":
          event.preventDefault();
          updateSettings({
            volume: Math.max(0, settings.volume - VOLUME_STEP),
          });
          break;
        case "m":
        case "M":
          updateSettings({ muted: !settings.muted });
          break;
        case "Escape":
          // The document-level listener owns the close (the window may
          // not hold focus); this branch is a no-op fallback.
          break;
        default:
          break;
      }
    },
    [rtl, togglePlay, skip, settings.volume, settings.muted, updateSettings],
  );

  /** Title-bar drag (the video window's pointer-capture mechanism, A.2.9). */
  const onTitlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return;
      }
      // FIX (exe bug report 1): a pointerdown starting on the bar's ×
      // close button must not capture the pointer on the bar — the
      // retargeted pointerup would move the click to the bar and the
      // button's onClick would never fire (titleBarDrag.ts).
      if (isInteractiveTitleBarTarget(event.target, event.currentTarget)) {
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      // FIX (fix round 1): while x/y are the 0/0 centre-sentinel the window
      // is DISPLAYED centred — the drag origin must be that displayed
      // position (the render's exact formula), not the sentinel (the first
      // drag used to teleport the window to the raw delta).
      const centred = settings.x === 0 && settings.y === 0;
      const originX = centred
        ? Math.max(16, (window.innerWidth - settings.width) / 2)
        : settings.x;
      const originY = centred
        ? Math.max(16, (window.innerHeight - settings.height) / 2)
        : settings.y;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const onMove = (moveEvent: PointerEvent): void => {
        updateSettings({
          x: originX + (moveEvent.clientX - startX),
          y: originY + (moveEvent.clientY - startY),
        });
      };
      const onUp = (): void => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [settings.x, settings.y, settings.width, settings.height, updateSettings],
  );

  /** Corner-handle resize (min 320×100, A.2.3). */
  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      const originW = settings.width;
      const originH = settings.height;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const onMove = (moveEvent: PointerEvent): void => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        updateSettings({
          width: Math.max(MINI_PLAYER_MIN_WIDTH, originW + dx),
          height: Math.max(MINI_PLAYER_MIN_HEIGHT, originH + dy),
        });
      };
      const onUp = (): void => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [settings.width, settings.height, updateSettings],
  );

  const volumeIcon = useMemo(() => {
    if (settings.muted || settings.volume === 0) {
      return VolumeX;
    }
    if (settings.volume < 0.5) {
      return Volume1;
    }
    return Volume2;
  }, [settings.muted, settings.volume]);

  if (objectId === null || typeof document === "undefined") {
    return null;
  }

  // The default position centres the window on the first open.
  const left =
    settings.x === 0 && settings.y === 0
      ? Math.max(16, (window.innerWidth - settings.width) / 2)
      : settings.x;
  const top =
    settings.x === 0 && settings.y === 0
      ? Math.max(16, (window.innerHeight - settings.height) / 2)
      : settings.y;

  return createPortal(
    <div
      dir={rtl ? "rtl" : "ltr"}
      role="dialog"
      aria-label={t("miniPlayer.title")}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        "fixed z-[70] flex flex-col overflow-hidden rounded-xl border bg-background/95",
        "text-foreground shadow-2xl shadow-black/50 backdrop-blur-md",
        "focus:outline-none",
      )}
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${settings.width}px`,
        minHeight: `${settings.height}px`,
      }}
    >
      {/* Title bar — the drag handle (A.2.9's reused mechanism). */}
      <div
        onPointerDown={onTitlePointerDown}
        className="flex cursor-move items-center gap-2 border-b bg-muted/60 px-3 py-2 select-none"
      >
        <Music className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {meta?.name ?? t("miniPlayer.title")}
        </span>
        <button
          type="button"
          onClick={close}
          aria-label={t("miniPlayer.close")}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* The audio element — exists ONLY while the window is open. */}
      <div className="relative min-h-0 flex-1 bg-muted/20">
        {ready ? (
          <audio
            ref={audioRef}
            src={src ?? undefined}
            // NO autoplay (A.2.3): opens paused at 0:00.
            autoPlay={false}
            preload="auto"
            className="size-full"
            aria-label={meta?.name ?? t("miniPlayer.title")}
          />
        ) : (
          <div className="grid size-full place-items-center px-3 text-xs text-muted-foreground">
            {t("miniPlayer.loading")}
          </div>
        )}
        {/* The waveform strip: a decorative live progress visual (NO
            equaliser animation — A.3's NON-GOAL; a static bar field
            whose fill mirrors the seek position). */}
        {ready ? (
          <div
            className="pointer-events-none absolute inset-x-3 bottom-2 top-2 overflow-hidden rounded-lg bg-black/70"
            aria-hidden="true"
          >
            <div
              className="absolute inset-y-0 start-0 bg-primary/25"
              style={{ width: `${Math.min(1, durationMs > 0 ? currentMs / durationMs : 0) * 100}%` }}
            />
            <div className="absolute inset-0 flex items-center gap-[2px] px-2 opacity-70">
              {Array.from({ length: 64 }).map((_, i) => (
                <span
                  key={i}
                  className="w-[3px] shrink-0 rounded-full bg-white/50"
                  style={{
                    height: `${18 + Math.abs(Math.sin(i * 1.7)) * 34}%`,
                    alignSelf: "center",
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* The chrome (custom, RTL, theme-aware — RM2.2; NO fullscreen). */}
      <div className="flex flex-col gap-1.5 border-t bg-background/90 px-3 py-2">
        {/* Seek: buffered bar + range. */}
        <div className="relative h-4">
          <div className="absolute top-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary/30"
              style={{ width: `${Math.min(1, bufferedRatio) * 100}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={durationMs > 0 ? currentMs / durationMs : 0}
            onChange={(event) => seekToRatio(Number(event.target.value))}
            aria-label={t("miniPlayer.seek")}
            className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!ready}
            aria-label={playing ? t("miniPlayer.pause") : t("miniPlayer.play")}
            className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {playing ? (
              <Pause className="size-4" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => skip(-SKIP_SECONDS)}
            disabled={!ready}
            aria-label={t("miniPlayer.back10")}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Rewind className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => skip(SKIP_SECONDS)}
            disabled={!ready}
            aria-label={t("miniPlayer.forward10")}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <FastForward className="size-4" aria-hidden="true" />
          </button>

          {/* Time readout — Persian digits per setting, LTR timecode. */}
          <span
            dir="ltr"
            className="ms-1 select-none font-mono text-[11px] tabular-nums text-muted-foreground"
          >
            {formatTimecode(currentMs, digitInput)} / {formatTimecode(durationMs, digitInput)}
          </span>

          <div className="flex-1" />

          {/* Volume + mute. */}
          <button
            type="button"
            onClick={() => updateSettings({ muted: !settings.muted })}
            aria-label={t("miniPlayer.mute")}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {(() => {
              const Icon = settings.muted ? VolumeX : volumeIcon;
              return <Icon className="size-4" aria-hidden="true" />;
            })()}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.muted ? 0 : settings.volume}
            onChange={(event) =>
              updateSettings({
                volume: Number(event.target.value),
                muted: false,
              })
            }
            aria-label={t("miniPlayer.volume")}
            className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-muted [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
          />

          {/* Speed menu (۰٫۵/۱/۱٫۵/۲). */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSpeedMenuOpen((open) => !open)}
              aria-label={t("miniPlayer.speed")}
              className="h-8 min-w-11 rounded-lg px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {settings.speed
                .toLocaleString(digitInput === "fa" ? "fa-IR" : "en-US")
                .replace("٫", ".")}×
            </button>
            {speedMenuOpen ? (
              <div className="absolute bottom-10 z-10 flex flex-col gap-0.5 rounded-lg border bg-popover p-1 shadow-xl">
                {MINI_PLAYER_SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => {
                      updateSettings({ speed });
                      setSpeedMenuOpen(false);
                    }}
                    className={cn(
                      "rounded-md px-3 py-1 text-[11px] transition-colors hover:bg-accent",
                      speed === settings.speed
                        ? "font-bold text-primary"
                        : "text-foreground",
                    )}
                  >
                    {speed
                      .toLocaleString(
                        digitInput === "fa" ? "fa-IR" : "en-US",
                      )
                      .replace("٫", ".")}×
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* The resize handle (corner). */}
      <div
        onPointerDown={onResizePointerDown}
        role="separator"
        aria-label={t("miniPlayer.resize")}
        className="absolute bottom-0 end-0 size-4 cursor-nwse-resize"
        style={{
          background:
            "linear-gradient(135deg, transparent 50%, hsl(var(--border)) 50%)",
        }}
      />
    </div>,
    document.body,
  );
}
