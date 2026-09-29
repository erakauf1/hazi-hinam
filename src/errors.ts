import { z } from "zod";

export class HaziHinamError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthRequired extends HaziHinamError {
  constructor(message = "Not signed in, or the 48-hour login expired. Run `hazi-hinam login`.") {
    super("AUTH_REQUIRED", message);
  }
}

export class UpstreamError extends HaziHinamError {
  constructor(message: string, readonly status?: number) {
    super("UPSTREAM_ERROR", message);
  }
}

export class ForbiddenOperation extends HaziHinamError {
  constructor(path: string) {
    super("FORBIDDEN_OPERATION", `Refusing to call ${path}: placing and paying for orders is done on the website only.`);
  }
}

export function formatError(error: unknown): string {
  if (error instanceof HaziHinamError) return `${error.code}: ${error.message}`;
  if (error instanceof z.ZodError) {
    return "BAD_ARGS: " + error.issues.map(i => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  }
  return `UNEXPECTED: ${error instanceof Error ? error.message : String(error)}`;
}
