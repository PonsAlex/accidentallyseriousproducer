import { isPromotionPublic } from "./affiliate-core.mjs";
import {
  CONTENT_BLOCK_SCHEMA_VERSION,
  migrateEditorialState,
  validateEditorialState
} from "./content-blocks.mjs";

export const CONSOLE_EXPORT_FORMAT = "asp-console-export";
export const CONSOLE_EXPORT_FORMAT_VERSION = 1;
export const CONSOLE_EXPORT_APPLICATION = "asp-editorial-console";

export class ConsoleImportApplyError extends Error {
  constructor(cause) {
    super("Editorial state was saved, but applying it to the Console view failed.", { cause });
    this.name = "ConsoleImportApplyError";
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUtcIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match) return false;

  const [, year, month, day, hour, minute, second] = match;
  const numbers = [year, month, day, hour, minute, second].map(Number);
  if (
    numbers.some((part) => !Number.isInteger(part)) ||
    numbers[1] < 1 ||
    numbers[1] > 12 ||
    numbers[3] > 23 ||
    numbers[4] > 59 ||
    numbers[5] > 59
  ) {
    return false;
  }

  const daysInMonth = new Date(`${year}-${month}-01T00:00:00.000Z`);
  daysInMonth.setUTCMonth(daysInMonth.getUTCMonth() + 1, 0);
  if (numbers[2] < 1 || numbers[2] > daysInMonth.getUTCDate()) return false;
  return Number.isFinite(Date.parse(value));
}

export function createConsoleExportEnvelope(state, exportedAt = new Date().toISOString()) {
  validateEditorialState(state);
  if (!isUtcIsoTimestamp(exportedAt)) {
    throw new TypeError("Export timestamp must be a valid ISO 8601 UTC timestamp.");
  }

  const snapshot = JSON.parse(JSON.stringify(state));
  return {
    format: CONSOLE_EXPORT_FORMAT,
    formatVersion: CONSOLE_EXPORT_FORMAT_VERSION,
    exportedAt,
    source: {
      application: CONSOLE_EXPORT_APPLICATION,
      contentSchemaVersion: snapshot.schemaVersion,
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt
    },
    state: snapshot
  };
}

function prepareEnvelope(envelope) {
  if (envelope.format !== CONSOLE_EXPORT_FORMAT) {
    throw new TypeError(`Unsupported export format: ${envelope.format ?? "(missing)"}.`);
  }
  if (envelope.formatVersion !== CONSOLE_EXPORT_FORMAT_VERSION) {
    throw new TypeError(`Unsupported export format version: ${envelope.formatVersion ?? "(missing)"}.`);
  }
  if (!isUtcIsoTimestamp(envelope.exportedAt)) {
    throw new TypeError("Export envelope has an invalid ISO 8601 UTC exportedAt timestamp.");
  }
  if (!isRecord(envelope.source)) {
    throw new TypeError("Export envelope must contain source metadata.");
  }
  if (envelope.source.application !== CONSOLE_EXPORT_APPLICATION) {
    throw new TypeError(`Unsupported export source application: ${envelope.source.application ?? "(missing)"}.`);
  }
  if (!isRecord(envelope.state)) {
    throw new TypeError("Export envelope must contain an editorial state object.");
  }

  const { source, state } = envelope;
  if (
    source.contentSchemaVersion !== state.schemaVersion ||
    source.revision !== state.revision ||
    source.updatedAt !== state.updatedAt
  ) {
    throw new TypeError("Export source metadata does not match the enclosed editorial state.");
  }
  if (source.contentSchemaVersion !== CONTENT_BLOCK_SCHEMA_VERSION) {
    throw new TypeError(
      `Unsupported envelope content schema version: ${source.contentSchemaVersion ?? "(missing)"}.`
    );
  }

  return validateEditorialState(state);
}

export function prepareConsoleImport(value) {
  if (!isRecord(value)) {
    throw new TypeError("Imported file must contain an editorial state or export envelope object.");
  }

  if (Object.hasOwn(value, "format") || Object.hasOwn(value, "formatVersion")) {
    return prepareEnvelope(value);
  }

  return validateEditorialState(migrateEditorialState(value));
}

export function validateConsoleEditorialState(value, { promotionsById, hasTemplate }) {
  validateEditorialState(value);
  for (const block of value.blocks) {
    if (block.type === "deal") {
      if (!block.content.promotionId) {
        if (block.status === "draft" && block.metadata.publication.state === "unpublished") continue;
        throw new TypeError(`Deal block ${block.id} needs an approved public promotion.`);
      }
      const promotion = promotionsById.get(block.content.promotionId);
      if (!promotion || !isPromotionPublic(promotion)) {
        throw new TypeError(`Deal block ${block.id} does not reference an approved public promotion.`);
      }
      continue;
    }
    if (!hasTemplate(block.id, block.type)) {
      throw new TypeError(`Content block ${block.id} does not match an existing public component.`);
    }
  }
  return value;
}

export function importConsoleState(json, { validateState, persist, apply }) {
  if (typeof validateState !== "function" || typeof persist !== "function" || typeof apply !== "function") {
    throw new TypeError("Console import requires validation, persistence, and apply handlers.");
  }

  const candidate = prepareConsoleImport(JSON.parse(json));
  validateState(candidate);
  persist(candidate);
  try {
    apply(candidate);
  } catch (error) {
    throw new ConsoleImportApplyError(error);
  }
  return candidate;
}
