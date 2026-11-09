import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'netlify/**/*.test.ts', 'scripts/**/*.test.ts'],
      // Integration tests need the local Supabase stack; run them with `npm run test:integration`.
      exclude: [...configDefaults.exclude, ...(process.env.INTEGRATION ? [] : ['**/*.integration.test.ts'])],
      // The local stack answers in milliseconds, but a test may make dozens of calls.
      ...(process.env.INTEGRATION ? { testTimeout: 30_000, hookTimeout: 60_000 } : {}),
    },
  }),
)
