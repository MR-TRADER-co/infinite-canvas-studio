import { describe, expect, it } from "vitest";
import {
  PermissionEngine,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_IDS,
  type PermissionId,
} from "@/plugins/host/PermissionEngine";

describe("Permission engine (R9.4)", () => {
  it("describes every permission in plain Persian (the consent dialog)", () => {
    expect(PERMISSION_DESCRIPTIONS).toHaveLength(PERMISSION_IDS.length);
    for (const description of PERMISSION_DESCRIPTIONS) {
      expect(description.title.length).toBeGreaterThan(1);
      expect(description.detail.length).toBeGreaterThan(10);
      expect(PERMISSION_IDS).toContain(description.id);
    }
  });

  it("maps SDK methods to required permissions", () => {
    expect(PermissionEngine.permissionForMethod("app.storage.get")).toBe(
      "storage",
    );
    expect(PermissionEngine.permissionForMethod("app.storage.sql")).toBe(
      "storage",
    );
    expect(PermissionEngine.permissionForMethod("app.network.fetch")).toBe(
      "network",
    );
    expect(PermissionEngine.permissionForMethod("app.project.read")).toBe(
      "projectRead",
    );
    expect(PermissionEngine.permissionForMethod("app.project.write")).toBe(
      "projectWrite",
    );
    // Permission-free surface.
    expect(PermissionEngine.permissionForMethod("app.objects.list")).toBeNull();
    expect(
      PermissionEngine.permissionForMethod("app.commands.register"),
    ).toBeNull();
  });

  it("fails CLOSED for a storage call without the storage permission (AC9.4)", () => {
    const engine = new PermissionEngine([]);
    const verdict = engine.checkMethod("app.storage.get");
    expect(verdict).not.toBeNull();
    expect(verdict?.code).toBe("permission-denied");
    expect(verdict?.message).toContain("مجوز");
    expect(verdict?.message).toContain("ذخیره‌سازی");
  });

  it("passes granted permissions and unknown methods", () => {
    const engine = new PermissionEngine(["storage", "network"]);
    expect(engine.checkMethod("app.storage.sql")).toBeNull();
    expect(engine.checkMethod("app.network.fetch")).toBeNull();
    expect(engine.checkMethod("app.panels.register")).toBeNull();
    expect(engine.has("storage")).toBe(true);
    expect(engine.has("projectRead")).toBe(false);
    expect([...engine.list()].sort()).toEqual(["network", "storage"]);
  });

  it("drops unknown permission ids at construction (validated manifests only)", () => {
    const engine = new PermissionEngine(["storage", "made-up" as PermissionId]);
    expect(engine.list()).toEqual(["storage"]);
  });
});
