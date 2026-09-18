/**
 * Word/character counting utilities (R3B.6).
 *
 * Persian correctness rules:
 * - ZWNJ (U+200C, نیم‌فاصله) is PART OF A WORD, never a separator —
 *   "می‌خواهم" is exactly ONE word. The JS `\s` class does not match U+200C
 *   (nor U+200B), so splitting on whitespace keeps ZWNJ-joined compounds
 *   intact; this module pins that contract in tests.
 * - Word boundaries are Unicode whitespace runs (spaces, newlines, tabs).
 * - Character count is the plain length of the text projection (spaces
 *   included, block separators excluded by the caller).
 *
 * These helpers are pure and DOM-free; they back both the shared editor's
 * CharacterCount extension (custom counters) and the status-bar readout.
 */

/**
 * Counts whitespace-separated words (ZWNJ-safe: U+200C stays in-word).
 *
 * @param text - the text projection to count.
 * @returns the number of non-empty words.
 */
export function countWords(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Counts characters of the text projection (spaces included).
 *
 * @param text - the text projection to count.
 * @returns the number of characters.
 */
export function countCharacters(text: string): number {
  return [...text].length;
}

/**
 * Formats a "۱۲ کلمه · ۳۴ نویسه"-style pair through the caller's localiser.
 *
 * Kept here so the ZWNJ contract and the projection semantics live in one
 * place; the UI passes its digit-converting formatter.
 *
 * @param text - the text projection to count.
 * @param formatNumber - localised integer formatter (Persian digits etc.).
 * @returns the counts tuple: words first, characters second.
 */
export function countProjection(
  text: string,
  formatNumber: (value: number) => string,
): { words: string; characters: string } {
  return {
    words: formatNumber(countWords(text)),
    characters: formatNumber(countCharacters(text)),
  };
}
