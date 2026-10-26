import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const require = createRequire(import.meta.url)
export default defineConfig({
  plugins: [vue()],
  // Match the plugin's published CommonJS entry and Koishi's loader. Koishi's
  // current dual exports pull incompatible loader defaults into a pure ESM test.
  resolve: { alias: [
    { find: /^koishi$/, replacement: require.resolve('koishi') },
    { find: /^@koishijs\/plugin-console$/, replacement: require.resolve('@koishijs/plugin-console') },
  ] },
  test: { testTimeout: 15000, hookTimeout: 15000, maxWorkers: 2, silent: 'passed-only' },
})
