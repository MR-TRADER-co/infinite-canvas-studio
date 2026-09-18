/**
 * Extension seams barrel (R3B5.1/R3B5.5): the registry base, the command
 * registry and the command dispatcher. Future seams (PanelRegistry,
 * InspectorSectionRegistry, ObjectRegistry) re-export from here so plugin
 * code (Phases 9–10) has ONE import point — see docs/SEAMS.md.
 */
export { Registry } from "@/core/registry/Registry";
export type {
  OnRegisteredHandler,
  RegistryEntryMeta,
  RegistryUnsubscribe,
} from "@/core/registry/Registry";
export {
  CommandRegistry,
  CORE_OWNER,
  normaliseShortcut,
} from "@/core/registry/CommandRegistry";
export type {
  CommandContext,
  CommandEntry,
  CommandGroup,
  CommandShortcut,
} from "@/core/registry/CommandRegistry";
