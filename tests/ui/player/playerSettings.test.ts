// @vitest-environment jsdom
/**
 * Unit tests for the player settings persistence (فاز M2 — A.2.3):
 * defaults on a fresh slot, round-trips, and the defensive clamping of
 * hostile/corrupt payloads.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  PLAYER_DEFAULTS,
  PLAYER_SPEEDS,
  readPlayerSettings,
  writePlayerSettings,
} from "@/ui/player/playerSettings";

beforeEach(() => {
  window.localStorage.clear();
});

describe("playerSettings (فاز M2 — A.2.3 / ACM2.7)", () => {
  it("returns the defaults on a fresh slot (640 wide, volume 1, speed 1)", () => {
    expect(readPlayerSettings()).toEqual(PLAYER_DEFAULTS);
    expect(PLAYER_DEFAULTS.width).toBe(640);
    expect(PLAYER_DEFAULTS.volume).toBe(1);
    expect(PLAYER_DEFAULTS.speed).toBe(1);
  });

  it("round-trips the last position/size/volume/speed", () => {
    writePlayerSettings({
      x: 120,
      y: 80,
      width: 800,
      height: 500,
      volume: 0.4,
      muted: true,
      speed: 1.5,
    });
    expect(readPlayerSettings()).toEqual({
      x: 120,
      y: 80,
      width: 800,
      height: 500,
      volume: 0.4,
      muted: true,
      speed: 1.5,
    });
  });

  it("clamps hostile payloads onto sane values", () => {
    window.localStorage.setItem(
      "infinite-canvas-studio/player/v1",
      JSON.stringify({
        x: 1e9,
        y: Number.NaN,
        width: 10,
        height: -50,
        volume: 5,
        speed: 3.25,
        muted: "yes",
      }),
    );
    const settings = readPlayerSettings();
    expect(settings.width).toBe(320);
    expect(settings.height).toBe(240);
    expect(settings.volume).toBe(1);
    expect(settings.speed).toBe(1);
    expect(PLAYER_SPEEDS.includes(settings.speed)).toBe(true);
    expect(settings.muted).toBe(false);
    // The NaN'd y falls back to the default (400 is the width default;
    // y's default is 0) — non-finite values never leak through.
    expect(Number.isFinite(settings.y)).toBe(true);
  });

  it("degrades a corrupt JSON slot to the defaults", () => {
    window.localStorage.setItem("infinite-canvas-studio/player/v1", "{oops");
    expect(readPlayerSettings()).toEqual(PLAYER_DEFAULTS);
  });
});
