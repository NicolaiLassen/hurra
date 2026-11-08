import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'netlify/**/*.test.ts'],
      // Integration tests need the local Supabase stack; run them with `npm run test:integration`.
      exclude: [...configDefaults.exclude, ...(process.env.INTEGRATION ? [] : ['**/*.integration.test.ts'])],
    },
  }),
)
