/**
 * Generates the shipped template resources (R8.4): serialises every
 * template builder's `ProjectData` into the `.icb` v2 envelope and
 * writes `public/templates/<id>.icb`. The gallery fetches these files
 * at runtime (web + desktop shells); the builders remain the single
 * source of truth — re-run after editing them:
 *
 *   bun scripts/generateTemplates.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VersionedSerializer } from "../src/persistence/VersionedSerializer";
import { registerCoreObjectTypes } from "../src/persistence/objectTypes";
import { ObjectRegistry } from "../src/core/registry/ObjectRegistry";
import { TEMPLATES, __resetTemplateIds } from "../src/core/templates/templates";

const OUT_DIR = join(process.cwd(), "public", "templates");

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const registry = registerCoreObjectTypes(new ObjectRegistry());
  const serializer = new VersionedSerializer(registry);
  for (const template of TEMPLATES) {
    __resetTemplateIds();
    const raw = serializer.serialize(template.build());
    const target = join(OUT_DIR, `${template.id}.icb`);
    await writeFile(target, raw, "utf-8");
    const payload = JSON.parse(raw) as { scene?: { objects?: unknown[] } };
    console.log(
      `ok ${template.id}.icb — ${(raw.length / 1024).toFixed(1)} KB, ` +
        `${payload.scene?.objects?.length ?? 0} objects`,
    );
  }
  console.log(`\n${TEMPLATES.length} templates written to ${OUT_DIR}`);
}

void main();
