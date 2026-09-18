/**
 * Unit tests for the ZWNJ-aware word/character counters (R3B.6 / AC3B.6).
 *
 * The contract: ZWNJ (U+200C, نیم‌فاصله) is PART OF A WORD — "می‌خواهم" is
 * one word; whitespace runs are the only separators.
 */
import { describe, expect, it } from "vitest";
import { countCharacters, countWords } from "@/text/editor/wordCount";

describe("countWords (ZWNJ-aware)", () => {
  it("counts a ZWNJ-joined compound as ONE word", () => {
    expect(countWords("می‌خواهم")).toBe(1);
  });

  it("counts plain Persian words separated by spaces", () => {
    expect(countWords("سلام دنیا")).toBe(2);
  });

  it("keeps multiple ZWNJ compounds intact in a sentence", () => {
    expect(countWords("می‌خواهم به‌ترتیب کار کنیم")).toBe(4);
  });

  it("treats mixed Persian/Latin words with ZWNJ correctly", () => {
    expect(countWords("hello می‌خواهم world")).toBe(3);
  });

  it("splits on newlines and tabs, not on ZWNJ", () => {
    expect(countWords("می‌خواهم\nمیز")).toBe(2);
    expect(countWords("می‌خواهم\tمیز")).toBe(2);
  });

  it("ignores pure whitespace and empty strings", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
  });

  it("collapses multi-space runs into one separator", () => {
    expect(countWords("سلام    دنیا")).toBe(2);
  });

  it("does NOT split on zero-width space or BOM-like format chars", () => {
    // U+200B (ZWSP) is not whitespace in JS \s either — same contract.
    expect(countWords("a\u200Bb")).toBe(1);
  });
});

describe("countCharacters", () => {
  it("counts ZWNJ characters as characters", () => {
    // م ی ZWNJ خ و ا ه م = 8 characters
    expect(countCharacters("می‌خواهم")).toBe(8);
  });

  it("counts spaces and newlines as characters", () => {
    expect(countCharacters("ab c\nd")).toBe(6);
  });

  it("returns 0 for the empty string", () => {
    expect(countCharacters("")).toBe(0);
  });
});
