import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_ADMIN_IDS: z
    .string()
    .min(1)
    .transform((v) => v.split(',').map((id) => id.trim())),
  INTERNAL_TOKEN: z.string().min(1),
  ADMIN_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  PAYMENT_PROVIDER_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Missing or invalid environment variables: ${missing}`);
  }
  return result.data;
}

// Lazy singleton — evaluated on first access at runtime, not at build time.
let _env: Env | undefined;
export function getEnv(): Env {
  if (!_env) _env = parseEnv();
  return _env;
}

// Convenience proxy for destructuring in server code.
export const env = new Proxy({} as Env, {
  get(_target, key: string) {
    return getEnv()[key as keyof Env];
  },
});
