// @koishijs/client publishes TS/Vue sources but no global.d.ts in 5.30.11.
// Emit declarations from the installed SDK, just as a library build would.
// Our client is then strictly checked against those real declarations, without
// re-typechecking third-party implementation files under our strict settings.
const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const result = spawnSync(process.execPath, [
  require.resolve('vue-tsc/bin/vue-tsc.js'), '-p', resolve(__dirname, 'tsconfig.client-sdk.json'),
], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
