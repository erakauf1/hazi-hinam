import type { z } from "zod";
import type { Context } from "../context.js";

export interface Operation<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  input: S;
  readOnly: boolean;
  destructive?: boolean;
  run(ctx: Context, args: z.infer<z.ZodObject<S>>): Promise<unknown>;
}

export function defineOperation<S extends z.ZodRawShape>(op: Operation<S>): Operation {
  return op as unknown as Operation;
}

export const unitName = (type: number) => (type === 2 ? "kg" : "unit");
export const unitType = (unit: "unit" | "kg") => (unit === "kg" ? 2 : 1);
