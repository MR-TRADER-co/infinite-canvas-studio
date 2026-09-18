/** Unit tests for IdGenerator.next() and the persistence reseed() path. */
import { describe, expect, it } from "vitest";
import { IdGenerator } from "@/core/id/IdGenerator";

describe("IdGenerator", () => {
  it("generates a strictly monotonic sequence with the default prefix", () => {
    const generator = new IdGenerator();
    expect(generator.next()).toBe("obj-1");
    expect(generator.next()).toBe("obj-2");
    expect(generator.next()).toBe("obj-3");
  });

  it("honours a custom prefix", () => {
    const generator = new IdGenerator("sticky");
    expect(generator.next()).toBe("sticky-1");
    expect(generator.next()).toBe("sticky-2");
  });

  describe("reseed", () => {
    it("moves the counter past the max numeric suffix of its own prefix", () => {
      const generator = new IdGenerator("obj");
      generator.reseed(["obj-3", "obj-10"]);
      expect(generator.next()).toBe("obj-11");
    });

    it("reseeds the default prefix", () => {
      const generator = new IdGenerator();
      generator.reseed(["obj-7"]);
      expect(generator.next()).toBe("obj-8");
    });

    it("ignores foreign prefixes", () => {
      const generator = new IdGenerator("obj");
      generator.reseed(["other-99", "note-1000", "objx-42"]);
      expect(generator.next()).toBe("obj-1");
    });

    it("ignores ids that merely start with the prefix without a dash", () => {
      const generator = new IdGenerator("obj");
      generator.reseed(["object-99"]);
      expect(generator.next()).toBe("obj-1");
    });

    it("ignores non-numeric suffixes", () => {
      const generator = new IdGenerator("obj");
      generator.reseed(["obj-abc", "obj-1e3x"]);
      expect(generator.next()).toBe("obj-1");
    });

    it("ignores the bare prefix without a suffix", () => {
      const generator = new IdGenerator("obj");
      generator.reseed(["obj-"]);
      expect(generator.next()).toBe("obj-1");
    });

    it("truncates fractional suffixes to whole numbers", () => {
      const generator = new IdGenerator("obj");
      generator.reseed(["obj-2.9"]);
      expect(generator.next()).toBe("obj-3");
    });

    it("never moves the counter backwards", () => {
      const generator = new IdGenerator("obj");
      generator.next();
      generator.next();
      generator.next();
      generator.reseed(["obj-1"]);
      expect(generator.next()).toBe("obj-4");
    });

    it("ignores negative suffixes below the current counter", () => {
      const generator = new IdGenerator("obj");
      generator.reseed(["obj--5"]);
      expect(generator.next()).toBe("obj-1");
    });

    it("reseeding with an empty array is a no-op", () => {
      const generator = new IdGenerator("obj");
      generator.next();
      generator.next();
      expect(generator.next()).toBe("obj-3");
      generator.reseed([]);
      expect(generator.next()).toBe("obj-4");
    });

    it("reseeds a custom-prefix generator from its own ids only", () => {
      const generator = new IdGenerator("sticky");
      generator.reseed(["sticky-5", "obj-99", "other-7"]);
      expect(generator.next()).toBe("sticky-6");
    });

    it("allocates collision-free ids after a reseed", () => {
      const usedIds = ["obj-1", "obj-2", "obj-3"];
      const generator = new IdGenerator("obj");
      generator.reseed(usedIds);
      for (let index = 0; index < 10; index += 1) {
        expect(usedIds).not.toContain(generator.next());
      }
    });

    it("next() stays monotonic across a reseed", () => {
      const generator = new IdGenerator("obj");
      expect(generator.next()).toBe("obj-1");
      generator.reseed(["obj-5"]);
      expect(generator.next()).toBe("obj-6");
      expect(generator.next()).toBe("obj-7");
    });
  });
});
