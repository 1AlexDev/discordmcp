import type { ToolResult } from "../types/schemas.js";

/** Builds a successful MCP tool result payload. */
export function successResult<T>(data: T): ToolResult<T> {
  return { success: true, data };
}

/** Builds a failed MCP tool result payload with a machine-readable code. */
export function errorResult(
  code: Extract<ToolResult, { success: false }>["code"],
  message: string
): Extract<ToolResult, { success: false }> {
  return { success: false, code, message };
}

/** Serializes a ToolResult to JSON text for MCP content blocks. */
export function formatToolResult(result: ToolResult): string {
  return JSON.stringify(result, null, 2);
}

/** Maps discord.js / Discord API errors to structured tool errors. */
export function mapDiscordError(err: unknown): Extract<ToolResult, { success: false }> {
  if (err && typeof err === "object") {
    const code = "code" in err ? (err as { code: unknown }).code : undefined;
    const message =
      "message" in err && typeof (err as { message: unknown }).message === "string"
        ? (err as { message: string }).message
        : String(err);

    // discord.js REST error codes
    if (code === 50013) {
      return errorResult(
        "MISSING_PERMISSION",
        `Missing permissions: ${message}`
      );
    }
    if (code === 50001 || code === 10003 || code === 10007 || code === 10008) {
      return errorResult("NOT_FOUND", message);
    }
    if (code === 429 || code === 50035) {
      return errorResult(
        "RATE_LIMITED",
        `Discord rate limit or validation error: ${message}`
      );
    }
  }

  return errorResult("UNKNOWN", err instanceof Error ? err.message : String(err));
}
