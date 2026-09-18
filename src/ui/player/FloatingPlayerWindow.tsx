"use client";

/**
 * FloatingPlayerWindow (فاز M2 — RM2.1/RM2.2, A.2.3): the SCREEN-space
 * video player overlay.
 *
 * Binding contract:
 * - a React PORTAL above every panel, NO scrim — the canvas stays
 *   interactive (pan/zoom/select while watching: the window never moves
 *   with the camera);
 * - draggable by its title bar + resizable via the corner handle
 *   (min 320×240, default 640 wide) — hand-rolled pointer events, the
 *   InsertPanel card-drag pattern (A.2.9: NO new dependency);
 * - ONE instance at a time (opening B closes A — the store holds a
 *   single id); NO autoplay (opens paused at 0:00, first frame shown);
 * - the source is fetched ONCE into a blob URL (type from the object's
 *   MIME) and REVOKED on close; the `<video>` element exists ONLY
 *   while the window is open (ACM2.3 — zero leaked decoders);
 * - last position/size/volume/speed persist in APP data (the dedicated
 *   localStorage slot — never the project file) and survive restarts;
 * - custom Persian/RTL chrome (Vazirmatn, theme-aware tokens): play/
 *   pause, seek slider + buffered range, ±۱۰s skips, volume + mute,
 *   speed menu (۰٫۵/۱/۱٫۵/۲), fullscreen, close; the time readout
 *   follows the Persian-digits setting; keyboard: Space, ←/→ (±۱۰s in
 *   the RTL-correct direction), ↑/↓ volume, M mute, F fullscreen,
 *   Esc close.
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
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
  X,
  Rewind,
  FastForward,
} from "lucide-react";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import { formatTimecode } from "@/ui/i18n/numbers";
import { Application, Services } from "@/App";
import { isVideoObject } from "@/core/model/VideoObject";
import { assetUrlOf } from "@/media/AssetUrlResolver";
import { isInteractiveTitleBarTarget } from "@/ui/player/titleBarDrag";
import {
  PLAYER_SPEEDS,
  readPlayerSettings,
  writePlayerSettings,
  type PlayerSettings,
} from "@/ui/player/playerSettings";
import { cn } from "@/lib/utils";

/** Minimum window footprint (A.2.3). */
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

/** Skip step of the ±10s buttons (seconds, RM2.2). */
const SKIP_SECONDS = 10;

/** Volume step of the ↑/↓ keys. */
const VOLUME_STEP = 0.1;

/** The floating player window (portal; nothing renders while closed). */
export default function FloatingPlayerWindow(): ReactNode {
  const { t, language } = useTranslation();
  const objectId = useUiStore((state) => state.playerVideoId);
  const closePlayer = useUiStore((state) => state.closeVideoPlayer);
  const persianDigits = useUiStore((state) => state.persianDigits);

  const [settings, setSettings] = useState<PlayerSettings>(() =>
    readPlayerSettings(),
  );
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [bufferedRatio, setBufferedRatio] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [meta, setMeta] = useState<{ name: string } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
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

  /** Revokes the current clip's blob URL (close/cleanup — ACM2.3). */
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
   * window's state survives restarts, ACM2.7).
   */
  const updateSettings = useCallback((patch: Partial<PlayerSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      writePlayerSettings(next);
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
      if (object === undefined || !isVideoObject(object)) {
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
          const typed = blob.type.startsWith("video/")
            ? blob
            : new Blob([blob], { type: "video/mp4" });
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
      // Opening another video (or closing) releases THIS clip's blob
      // URL immediately — no leaked decoders between sessions (ACM2.3).
      revokeCurrentUrl();
    };
  }, [objectId, closePlayer, setSrcUrl, revokeCurrentUrl]);

  /**
   * Closes the player: stop playback, revoke the blob URL, destroy the
   * element (ACM2.3 — zero leaked decoders/listeners).
   */
  const close = useCallback(() => {
    const video = videoRef.current;
    if (video !== null) {
      video.pause();
    }
    revokeCurrentUrl();
    setSpeedMenuOpen(false);
    setFullscreen(false);
    closePlayer();
  }, [closePlayer, revokeCurrentUrl]);

  /** Revokes on unmount (HMR/StrictMode safety). */
  useEffect(() => {
    return () => {
      revokeCurrentUrl();
    };
  }, [revokeCurrentUrl]);

  /** The video element's live state → React (timeupdate/loadedmetadata). */
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || !ready) {
      return;
    }
    const onTime = (): void => setCurrentMs(video.currentTime * 1000);
    const onDuration = (): void => {
      setDurationMs(Number.isFinite(video.duration) ? video.duration * 1000 : 0);
    };
    const onProgress = (): void => {
      if (video.buffered.length > 0 && video.duration > 0) {
        setBufferedRatio(video.buffered.end(video.buffered.length - 1) / video.duration);
      }
    };
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onDuration);
    video.addEventListener("progress", onProgress);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onDuration);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [ready]);

  /** Applies the persisted volume/speed to the element. */
  useEffect(() => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }
    video.volume = settings.volume;
    video.muted = settings.muted;
    video.playbackRate = settings.speed;
  }, [settings.volume, settings.muted, settings.speed, ready]);

  /** Toggle play/pause. */
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (video === null) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, []);

  /** Seeks by a signed delta (seconds), clamped. */
  const skip = useCallback(
    (deltaSeconds: number) => {
      const video = videoRef.current;
      if (video === null) {
        return;
      }
      const target = Math.min(
        Math.max(0, video.currentTime + deltaSeconds),
        Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER,
      );
      video.currentTime = target;
      setCurrentMs(target * 1000);
    },
    [],
  );

  /** Seeks to an absolute ratio of the duration (the slider). */
  const seekToRatio = useCallback((ratio: number) => {
    const video = videoRef.current;
    if (video === null || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, ratio));
    video.currentTime = clamped * video.duration;
    setCurrentMs(clamped * video.duration * 1000);
  }, []);

  /** Fullscreen toggle on the window container. */
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    if (document.fullscreenElement === container) {
      void document.exitFullscreen();
    } else {
      void container.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = (): void => {
      setFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
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
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "Escape":
          // The document-level listener owns the close (the window may
          // not hold focus); this branch is a no-op fallback.
          break;
        default:
          break;
      }
    },
    [rtl, togglePlay, skip, settings.volume, settings.muted, updateSettings, toggleFullscreen],
  );

  /** Title-bar drag (the InsertPanel card-drag pattern, A.2.9). */
  const onTitlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return;
      }
      // FIX (exe bug report 1): interactive children of the bar (the ×
      // close button, any future control) must keep their CLICKS. With
      // the pointer captured on the TITLE BAR, the browser retargets the
      // following pointerup to the bar, so the click fires on the common
      // ancestor (the bar itself) and the button's onClick never runs —
      // the window could not be closed by its button. Skipping the
      // capture for pointerdowns that START on an interactive descendant
      // restores the click (dragging still works everywhere else).
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

  /** Corner-handle resize (min 320×240). */
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
          width: Math.max(MIN_WIDTH, originW + dx),
          height: Math.max(MIN_HEIGHT, originH + dy),
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
      ref={containerRef}
      dir={rtl ? "rtl" : "ltr"}
      role="dialog"
      aria-label={t("player.title")}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        "fixed z-[70] flex flex-col overflow-hidden rounded-xl border bg-background/95",
        "text-foreground shadow-2xl shadow-black/50 backdrop-blur-md",
        "focus:outline-none",
        fullscreen && "inset-0 h-full w-full rounded-none",
      )}
      style={
        fullscreen
          ? undefined
          : {
              left: `${left}px`,
              top: `${top}px`,
              width: `${settings.width}px`,
              minHeight: `${settings.height}px`,
            }
      }
    >
      {/* Title bar — the drag handle (A.2.9). */}
      <div
        onPointerDown={onTitlePointerDown}
        className="flex cursor-move items-center gap-2 border-b bg-muted/60 px-3 py-2 select-none"
      >
        <Play className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {meta?.name ?? t("player.title")}
        </span>
        <button
          type="button"
          onClick={close}
          aria-label={t("player.close")}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* The video surface — the ONLY <video> element in the app. */}
      <div className="relative min-h-0 flex-1 bg-black">
        {ready ? (
          <video
            ref={videoRef}
            src={src ?? undefined}
            // NO autoplay (A.2.3): opens paused at 0:00.
            autoPlay={false}
            preload="auto"
            playsInline
            className="size-full"
            onClick={togglePlay}
            aria-label={meta?.name ?? t("player.title")}
          />
        ) : (
          <div className="grid size-full place-items-center text-xs text-muted-foreground">
            {t("player.loading")}
          </div>
        )}
      </div>

      {/* The chrome (custom, RTL, theme-aware — RM2.2). */}
      <div className="flex flex-col gap-2 border-t bg-background/90 px-3 py-2">
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
            aria-label={t("player.seek")}
            className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!ready}
            aria-label={playing ? t("player.pause") : t("player.play")}
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
            aria-label={t("player.back10")}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Rewind className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => skip(SKIP_SECONDS)}
            disabled={!ready}
            aria-label={t("player.forward10")}
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
            aria-label={t("player.mute")}
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
            aria-label={t("player.volume")}
            className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-muted [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
          />

          {/* Speed menu (۰٫۵/۱/۱٫۵/۲). */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSpeedMenuOpen((open) => !open)}
              aria-label={t("player.speed")}
              className="h-8 min-w-11 rounded-lg px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {settings.speed
                .toLocaleString(digitInput === "fa" ? "fa-IR" : "en-US")
                .replace("٫", ".")}×
            </button>
            {speedMenuOpen ? (
              <div className="absolute bottom-10 z-10 flex flex-col gap-0.5 rounded-lg border bg-popover p-1 shadow-xl">
                {PLAYER_SPEEDS.map((speed) => (
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

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={t("player.fullscreen")}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {fullscreen ? (
              <Minimize className="size-4" aria-hidden="true" />
            ) : (
              <Maximize className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* The resize handle (corner; hidden while fullscreen). */}
      {!fullscreen ? (
        <div
          onPointerDown={onResizePointerDown}
          role="separator"
          aria-label={t("player.resize")}
          className="absolute bottom-0 end-0 size-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 50%, hsl(var(--border)) 50%)",
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
