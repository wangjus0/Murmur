import { z } from "zod";

type BooleanEnvSchema = z.ZodEffects<
  z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodBoolean]>>,
  boolean,
  string | boolean | undefined
>;

export function booleanEnv(defaultValue: boolean): BooleanEnvSchema {
  return z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) {
        return defaultValue;
      }
      if (typeof value === "boolean") {
        return value;
      }

      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") {
        return true;
      }
      if (normalized === "false" || normalized === "0") {
        return false;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected one of: true, false, 1, 0.",
      });
      return z.NEVER;
    });
}
