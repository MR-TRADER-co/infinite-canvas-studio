/**
 * Regression tests for the sticker glyph paint contract (فاز ۳۳ QA):
 * canvas composites COLOUR emoji bitmaps against the fill ALPHA, so a
 * fillStyle with an alpha channel leaking into the glyph fillText
 * renders the sticker ghosted (the 6%-alpha backing plate made every
 * sticker near-invisible until the فاز-۳۳ fix reset the paint to an
 * opaque colour first). These tests pin the CONTRACT through the full
 * render() pass with a recording fake context — no real canvas needed.
 */
import { describe, expect, it, vi } from "vitest";
import { Canvas2DRenderer } from "@/rendering/Canvas2DRenderer";
import { makeStickerObject } from "@/core/model/StickerObject";
import { Scene } from "@/core/model/Scene";
import { Camera } from "@/core/camera/Camera";
import { vec2 } from "@/core/geometry/Vec2";

/** One recorded context call: the method, its args and the paint state. */
interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
  readonly fillStyle: string;
}

/**
 * A recording 2D-context stand-in: every method call is logged with the
 * fillStyle active at the moment (the assertion surface — the SEQUENCE
 * of paints is the contract, not the pixels).
 */
function makeRecordingContext(): {
  readonly log: RecordedCall[];
  readonly context: CanvasRenderingContext2D;
} {
  const log: RecordedCall[] = [];
  const state = { fillStyle: "#000000" };
  const context = new Proxy(
    {},
    {
      get:
        (_target, prop: string) =>
        (...args: unknown[]) => {
          log.push({
            method: prop,
            args,
            fillStyle: state.fillStyle,
          });
          return undefined;
        },
      set: (_target, prop: string, value) => {
        if (prop === "fillStyle") {
          state.fillStyle = String(value);
        }
        return true;
      },
      getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
    },
  ) as unknown as CanvasRenderingContext2D;
  return { log, context };
}

/** A canvas element stand-in bound to the recording context. */
function makeFakeCanvas(context: CanvasRenderingContext2D): HTMLCanvasElement {
  return {
    width: 1280,
    height: 537,
    clientWidth: 1280,
    clientHeight: 537,
    getContext: () => context,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLCanvasElement;
}

describe("sticker glyph paint contract (فاز ۳۳)", () => {
  it("the emoji fillText runs with an OPAQUE fillStyle — the plate's 6% alpha must not leak into the glyph", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { log, context } = makeRecordingContext();
    const renderer = new Canvas2DRenderer();
    renderer.initialize(makeFakeCanvas(context));

    const scene = new Scene(new Camera(0, 0, 1, 0));
    scene.add(makeStickerObject("st-1", "🔥", vec2(592, 220)));
    renderer.render(scene, new Camera(0, 0, 1, 0));
    vi.unstubAllGlobals();

    const glyphCalls = log.filter(
      (call) => call.method === "fillText" && call.args[0] === "🔥",
    );
    expect(glyphCalls.length).toBe(1);
    // The fix: the active paint at glyph time is the opaque palette
    // stroke — no alpha component rides along into the colour-emoji
    // composite.
    const glyph = glyphCalls[0];
    if (glyph === undefined) {
      throw new Error("the emoji fillText call went missing");
    }
    expect(glyph.fillStyle).not.toMatch(/\//);
    expect(glyph.fillStyle.length).toBeGreaterThan(0);
  });

  it("the soft backing plate still paints BEFORE the glyph with its 6% tint", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { log, context } = makeRecordingContext();
    const renderer = new Canvas2DRenderer();
    renderer.initialize(makeFakeCanvas(context));

    const scene = new Scene(new Camera(0, 0, 1, 0));
    scene.add(makeStickerObject("st-1", "⭐", vec2(100, 100)));
    renderer.render(scene, new Camera(0, 0, 1, 0));
    vi.unstubAllGlobals();

    const plateFill = log.find(
      (call) => call.method === "fill" && call.fillStyle.includes("6%"),
    );
    const glyphIndex = log.findIndex(
      (call) => call.method === "fillText" && call.args[0] === "⭐",
    );
    expect(plateFill).toBeDefined();
    expect(glyphIndex).toBeGreaterThan(-1);
    expect(log.indexOf(plateFill as RecordedCall)).toBeLessThan(glyphIndex);
  });

  it("no fillText anywhere in the frame carries an alpha-tagged fillStyle", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const { log, context } = makeRecordingContext();
    const renderer = new Canvas2DRenderer();
    renderer.initialize(makeFakeCanvas(context));

    const scene = new Scene(new Camera(0, 0, 1, 0));
    scene.add(makeStickerObject("st-1", "😀", vec2(40, 40)));
    renderer.render(scene, new Camera(0, 0, 1, 0));
    vi.unstubAllGlobals();

    const alphaTagged = log.filter(
      (call) =>
        call.method === "fillText" && /\/\s*(?:0\.\d+|\d+%)/.test(call.fillStyle),
    );
    expect(alphaTagged).toEqual([]);
  });
});
