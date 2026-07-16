import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL_DIRECT ??
      process.env.DATABASE_URL ??
      'postgresql://localhost/placeholder',
  },
} satisfies Config;
