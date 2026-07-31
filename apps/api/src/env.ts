import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: new URL("../../../.env", import.meta.url) });

const optionalSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

export const env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    DATABASE_URL: z.string().min(1),
    APP_URL: z.string().url().default("http://localhost:5173"),
    BOT_TOKEN: optionalSecret,
    BOT_USERNAME: optionalSecret,
    TELEGRAM_APP_SHORT_NAME: optionalSecret,
    WEBHOOK_SECRET: optionalSecret,
    AUTH_MAX_AGE: z.coerce.number().int().positive().default(86_400),
    ALLOW_DEMO_AUTH: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && value.ALLOW_DEMO_AUTH) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ALLOW_DEMO_AUTH"],
        message: "Demo authentication cannot be enabled in production.",
      });
    }
  })
  .parse(process.env);
