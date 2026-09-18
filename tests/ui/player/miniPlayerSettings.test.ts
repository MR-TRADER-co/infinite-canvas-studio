// @vitest-environment jsdom
/**
 * miniPlayerSettings unit tests (فاز A2 — RA2.1): persistence round-trip,
 * defensive normalisation and the 400×120/320×100 defaults (A.2.3).
 */
import { describe, expect, it } from "vitest";
import {
  MINI_PLAYER_DEFAULTS,
  MINI_PLAYER_MIN_HEIGHT,
  MINI_PLAYER_MIN_WIDTH,
  MINI_PLAYER_SPEEDS,
  readMiniPlayerSettings,
  writeMiniPlayerSettings,
} from "@/ui/player/miniPlayerSettings";

const SLOT = "infinite-canvas-studio/mini-player/v1";

describe("miniPlayerSettings (فاز A2 — RA2.1)", () => {
  it("defaults to 400×120 (A.2.3) and reads back the slot", () => {
    window.localStorage.removeItem(SLOT);
    const settings = readMiniPlayerSettings();
    expect(settings).toEqual(MINI_PLAYER_DEFAULTS);
    expect(MINI_PLAYER_DEFAULTS.width).toBe(400);
    expect(MINI_PLAYER_DEFAULTS.height).toBe(120);
    expect(MINI_PLAYER_MIN_WIDTH).toBe(320);
    expect(MINI_PLAYER_MIN_HEIGHT).toBe(100);

    writeMiniPlayerSettings({
      ...settings,
      x: 120,
      y: 80,
      width: 520,
      volume: 0.4,
      speed: 1.5,
    });
    const restored = readMiniPlayerSettings();
    expect(restored.x).toBe(120);
    expect(restored.width).toBe(520);
    expect(restored.volume).toBe(0.4);
    expect(restored.speed).toBe(1.5);
  });

  it("normalises corrupt/partial slots onto the defaults (clamped)", () => {
    window.localStorage.setItem(
      SLOT,
      JSON.stringify({ x: 99999, width: 5, height: -3, volume: 9, speed: 7, muted: "yes" }),
    );
    const settings = readMiniPlayerSettings();
    expect(settings.x).toBe(8192);
    expect(settings.width).toBe(MINI_PLAYER_MIN_WIDTH);
    expect(settings.height).toBe(MINI_PLAYER_MIN_HEIGHT);
    expect(settings.volume).toBe(1);
    expect(settings.speed).toBe(1);
    expect(settings.muted).toBe(false);
  });

  it("survives a corrupt JSON slot", () => {
    window.localStorage.setItem(SLOT, "{not json");
    expect(readMiniPlayerSettings()).toEqual(MINI_PLAYER_DEFAULTS);
  });

  it("allows exactly the 0.5/1/1.5/2 speeds", () => {
    expect([...MINI_PLAYER_SPEEDS]).toEqual([0.5, 1, 1.5, 2]);
  });
});
