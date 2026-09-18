/**
 * Keyboard-event → shortcut-string mapping for the CommandDispatcher
 * (R3B5.2).
 *
 * Matching uses the PHYSICAL `event.code` (layout-independent — Persian
 * keyboards produce Persian `e.key` letters, so code-based matching keeps
 * shortcuts working for Persian users; the tool-switch convention of the
 * pre-refactor code, preserved exactly).
 *
 * Canonical notation: `Mod-Alt?-Shift?-key` where `Mod` unifies Ctrl and
 * Meta (⌘) and the key part is the lower-cased logical key
 * (`Mod-Shift-Z`, `Escape`, `Tab`, `v` …).
 */

/** Modifier applied by the platform's primary accelerator key. */
const MOD_KEYS = ["ControlLeft", "ControlRight", "MetaLeft", "MetaRight"];

/** `event.code` values that map to plain character keys. */
const CODE_PATTERNS: Array<{ pattern: RegExp; to: (code: string) => string }> =
  [
    { pattern: /^Key([A-Z])$/, to: (code) => code.slice(3).toLowerCase() },
    { pattern: /^Digit([0-9])$/, to: (code) => code.slice(5) },
  ];

/** Special-key code → canonical key part. */
const CODE_KEYS: Readonly<Record<string, string>> = {
  Space: "space",
  Enter: "enter",
  Escape: "escape",
  Tab: "tab",
  Backspace: "backspace",
  Delete: "delete",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  ArrowUp: "arrowup",
  ArrowDown: "arrowdown",
  ArrowLeft: "arrowleft",
  ArrowRight: "arrowright",
  F5: "f5",
  F11: "f11",
  Minus: "minus",
  Equal: "equal",
  BracketLeft: "bracketleft",
  BracketRight: "bracketright",
  Semicolon: "semicolon",
  Quote: "quote",
  Backquote: "backquote",
  Backslash: "backslash",
  Comma: "comma",
  Period: "period",
  Slash: "slash",
};

/**
 * Maps a keyboard event to the canonical shortcut notation.
 *
 * @param event - the physical keyboard event.
 * @returns the canonical shortcut string (e.g. "Mod-Shift-Z", "Escape").
 */
export function shortcutFromKeyboardEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey || MOD_KEYS.includes(event.code)) {
    parts.push("Mod");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(keyPartOf(event.code));
  return parts.join("-");
}

/**
 * @param code - a `KeyboardEvent.code` value.
 * @returns the canonical key part.
 */
function keyPartOf(code: string): string {
  for (const { pattern, to } of CODE_PATTERNS) {
    if (pattern.test(code)) {
      return to(code);
    }
  }
  return CODE_KEYS[code] ?? code.toLowerCase();
}
