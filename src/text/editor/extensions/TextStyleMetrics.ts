/**
 * Typography metric extensions (R3A.4/R3A.6): font size, line height and
 * letter spacing as `textStyle` mark attributes — the same pattern the
 * installed TipTap v2 Color/FontFamily extensions use (`Extension.create` +
 * `addGlobalAttributes` on the `textStyle` mark + `setMark` commands).
 *
 * Values are plain numbers in the object's WORLD units: the text layer's
 * root element carries the camera scale, so rendered CSS pixels map 1:1 to
 * world units — inline `font-size: 24px` inside a scaled text box means
 * 24 world units, exactly like the object-level base font size.
 */
import { Extension } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      /** Sets the selection's font size (world units). */
      setFontSize: (fontSize: number) => ReturnType;
      /** Clears the selection's font size (falls back to the object base). */
      unsetFontSize: () => ReturnType;
    };
    lineHeight: {
      /** Sets the selection's line height (unitless multiplier). */
      setLineHeight: (lineHeight: number) => ReturnType;
      /** Clears the selection's line height. */
      unsetLineHeight: () => ReturnType;
    };
    letterSpacing: {
      /** Sets the selection's letter spacing (world units). */
      setLetterSpacing: (letterSpacing: number) => ReturnType;
      /** Clears the selection's letter spacing. */
      unsetLetterSpacing: () => ReturnType;
    };
  }
}

/** Parses a CSS px length into a number (null for anything else). */
function parsePx(value: string): number | null {
  if (value === "" || value === "inherit" || value === "initial") {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parses a unitless CSS length into a number (null for anything else). */
function parseUnitless(value: string): number | null {
  if (
    value === "" ||
    value === "inherit" ||
    value === "initial" ||
    value === "normal"
  ) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Font size mark attribute (px == world units inside the scaled layer). */
export const FontSize = Extension.create({
  name: "fontSize",

  addOptions() {
    return { types: ["textStyle"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => parsePx(element.style.fontSize),
            renderHTML: (attributes) =>
              attributes.fontSize === null || attributes.fontSize === undefined
                ? {}
                : { style: `font-size: ${attributes.fontSize}px` },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain()
            .setMark("textStyle", { fontSize: null })
            .removeEmptyTextStyle()
            .run(),
    };
  },
});

/** Line height mark attribute (unitless multiplier, like CSS line-height). */
export const LineHeight = Extension.create({
  name: "lineHeight",

  addOptions() {
    return { types: ["textStyle"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => parseUnitless(element.style.lineHeight),
            renderHTML: (attributes) =>
              attributes.lineHeight === null ||
              attributes.lineHeight === undefined
                ? {}
                : { style: `line-height: ${attributes.lineHeight}` },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (lineHeight) =>
        ({ chain }) =>
          chain().setMark("textStyle", { lineHeight }).run(),
      unsetLineHeight:
        () =>
        ({ chain }) =>
          chain()
            .setMark("textStyle", { lineHeight: null })
            .removeEmptyTextStyle()
            .run(),
    };
  },
});

/** Letter spacing mark attribute (px == world units). */
export const LetterSpacing = Extension.create({
  name: "letterSpacing",

  addOptions() {
    return { types: ["textStyle"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          letterSpacing: {
            default: null,
            parseHTML: (element) => parsePx(element.style.letterSpacing),
            renderHTML: (attributes) =>
              attributes.letterSpacing === null ||
              attributes.letterSpacing === undefined
                ? {}
                : { style: `letter-spacing: ${attributes.letterSpacing}px` },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLetterSpacing:
        (letterSpacing) =>
        ({ chain }) =>
          chain().setMark("textStyle", { letterSpacing }).run(),
      unsetLetterSpacing:
        () =>
        ({ chain }) =>
          chain()
            .setMark("textStyle", { letterSpacing: null })
            .removeEmptyTextStyle()
            .run(),
    };
  },
});
