/**
 * Bookmark tests (R7.9/AC7.9): the service's add/remove/rename/capture
 * semantics, the defensive payload reader, and the save/load round-trip
 * through the versioned serializer (old files keep working).
 */
import { describe, expect, it } from "vitest";
import {
  BookmarkService,
  readBookmarks,
} from "@/core/bookmarks/BookmarkService";
import { VersionedSerializer } from "@/persistence/VersionedSerializer";
import { buildProjectData, type ProjectData } from "@/persistence/ProjectFile";
import { Scene } from "@/core/model/Scene";
import type { Camera } from "@/core/camera/Camera";

/** A minimal mutable camera stub. */
function cameraStub(x = 10, y = 20, zoom = 1.5, rotation = 0.2): Camera {
  return { x, y, zoom, rotation } as unknown as Camera;
}

describe("BookmarkService (R7.9)", () => {
  it("captures the current camera under a given name", () => {
    const service = new BookmarkService({
      getCamera: () => cameraStub(5, 6, 2, 0.1),
    });
    const bookmark = service.add("نمای کلی");
    expect(bookmark).not.toBeNull();
    expect(bookmark?.name).toBe("نمای کلی");
    expect(bookmark?.camera).toEqual({ x: 5, y: 6, zoom: 2, rotation: 0.1 });
    expect(service.list()).toHaveLength(1);
  });

  it("rejects empty names and missing camera providers", () => {
    const withCamera = new BookmarkService({ getCamera: () => cameraStub() });
    expect(withCamera.add("   ")).toBeNull();
    const withoutCamera = new BookmarkService();
    expect(withoutCamera.add("نام")).toBeNull();
  });

  it("removes and renames", () => {
    const service = new BookmarkService({ getCamera: () => cameraStub() });
    const first = service.add("یک");
    service.add("دو");
    expect(service.remove(first?.id ?? "")).toBe(true);
    expect(service.list()).toHaveLength(1);
    expect(service.rename("missing", "x")).toBe(false);
    expect(service.rename(service.list()[0]?.id ?? "", "نام تازه")).toBe(true);
    expect(service.list()[0]?.name).toBe("نام تازه");
  });

  it("notifies on every mutation", () => {
    let changes = 0;
    const service = new BookmarkService({
      getCamera: () => cameraStub(),
      onChange: () => {
        changes += 1;
      },
    });
    service.add("a");
    service.rename(service.list()[0]?.id ?? "", "b");
    service.remove(service.list()[0]?.id ?? "");
    expect(changes).toBe(3);
  });

  it("replaceAll restores a document's list", () => {
    const service = new BookmarkService({ getCamera: () => cameraStub() });
    service.replaceAll([
      { id: "bm-9", name: "دور", camera: { x: 1, y: 2, zoom: 1, rotation: 0 } },
    ]);
    expect(service.list()[0]?.name).toBe("دور");
  });
});

describe("readBookmarks (defensive load)", () => {
  it("validates entries and drops malformed ones", () => {
    const bookmarks = readBookmarks([
      { id: "ok", name: "نشانک", camera: { x: 0, y: 0, zoom: 1, rotation: 0 } },
      {
        id: "bad-zoom",
        name: "x",
        camera: { x: 0, y: 0, zoom: 0, rotation: 0 },
      },
      { id: "no-camera", name: "y" },
      "not-an-object",
    ]);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.id).toBe("ok");
  });

  it("non-arrays read as empty", () => {
    expect(readBookmarks(undefined)).toHaveLength(0);
    expect(readBookmarks(null)).toHaveLength(0);
    expect(readBookmarks("nope")).toHaveLength(0);
  });
});

describe("bookmark persistence round-trip (AC7.9)", () => {
  it("bookmarks survive serialize → deserialize", () => {
    const serializer = new VersionedSerializer();
    const scene = new Scene();
    const bookmarks = [
      {
        id: "bm-1",
        name: "نمای آغاز",
        camera: { x: -40, y: 100, zoom: 0.8, rotation: 0 },
      },
      {
        id: "bm-2",
        name: "بخش جداول",
        camera: { x: 500, y: -300, zoom: 2.5, rotation: 1.2 },
      },
    ];
    const data: ProjectData = {
      ...buildProjectData(scene),
      bookmarks,
    };
    const payload = serializer.serialize(data, 12345);
    const outcome = serializer.deserialize(payload);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") {
      return;
    }
    expect(outcome.data.bookmarks).toEqual(bookmarks);
  });

  it("older files without bookmarks load cleanly (empty list)", () => {
    const serializer = new VersionedSerializer();
    const scene = new Scene();
    const payload = serializer.serialize(buildProjectData(scene), 1);
    const outcome = serializer.deserialize(payload);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") {
      return;
    }
    expect(outcome.data.bookmarks ?? []).toHaveLength(0);
  });

  it("a corrupt bookmarks field never crashes the load", () => {
    const serializer = new VersionedSerializer();
    const scene = new Scene();
    const good = JSON.parse(serializer.serialize(buildProjectData(scene)));
    const corrupt = {
      ...good,
      bookmarks: [{ id: 42 }, { camera: "nope" }, "junk"],
    };
    const outcome = serializer.deserialize(JSON.stringify(corrupt));
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") {
      return;
    }
    expect(outcome.data.bookmarks ?? []).toHaveLength(0);
  });
});
