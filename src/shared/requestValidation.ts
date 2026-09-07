import type { ExtensionRequest } from "./protocol";

const NO_PAYLOAD_REQUESTS = new Set(["GET_STATE", "IMPORT_BOOKMARKS", "UPLOAD_NOW", "COMPARE_REMOTE", "OPEN_BOOKMARK_MANAGER"]);
const DIFF_REQUESTS = new Set(["USE_LOCAL", "USE_REMOTE", "CLEAR_DIFF"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExtensionRequest(value: unknown): ExtensionRequest {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Extension request must be an object with a type.");
  }
  if (NO_PAYLOAD_REQUESTS.has(value.type)) return value as unknown as ExtensionRequest;
  if (DIFF_REQUESTS.has(value.type) && typeof value.diffId === "string" && value.diffId.length > 0) {
    return value as unknown as ExtensionRequest;
  }
  if (value.type === "SAVE_TOKEN" && typeof value.token === "string" && (value.rememberToken === undefined || typeof value.rememberToken === "boolean"))
    return value as unknown as ExtensionRequest;
  if (value.type === "SAVE_SETTINGS" && isRecord(value.settings)) return value as unknown as ExtensionRequest;
  if (value.type === "SAVE_NOTES" && Array.isArray(value.notes)) return value as unknown as ExtensionRequest;
  throw new Error(`Invalid extension request: ${value.type}`);
}
