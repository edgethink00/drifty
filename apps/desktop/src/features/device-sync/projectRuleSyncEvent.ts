/**
 * Sent after device sync wrote projects or app & site rules from another
 * device (Project and rule sync), so the views that list them reload. Rules
 * arrive already applied to this device's records.
 */
export const PROJECT_RULE_DEFINITIONS_SYNCED_EVENT = "drifty:project-rule-definitions-synced";

export type ProjectRuleDefinitionsSyncedDetail = { readonly projects: boolean; readonly rules: boolean };

/** The tracker sync-state key holding what device sync last sent or took for each project and rule. */
export const SYNC_DEFINITION_LEDGER_KEY = "sync_definition_ledger";
