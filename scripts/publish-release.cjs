// Publish the same tarball checked by the package job. On reruns, only skip a
// published version if its integrity matches exactly; never swallow auth errors.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { readFileSync, readdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { name, version } = require('../package.json')

async function main() {
  const cli = process.env.npm_execpath
  assert.ok(cli, 'Run this script through npm run release:publish.')
  const files = readdirSync(resolve('release')).filter(file => file.endsWith('.tgz'))
  assert.equal(files.length, 1, 'Expected exactly one release tarball.')
  const file = resolve('release', files[0])
  const digest = createHash('sha512').update(readFileSync(file)).digest('base64')
  const response = await fetch(`https://registry.npmjs.org/${name}/${version}`)
  if (response.ok) {
    const published = await response.json()
    assert.equal(published.dist?.integrity, `sha512-${digest}`, 'This version already exists with different content. Bump the package version.')
    console.log(`${name}@${version} is already published with matching integrity.`)
    return
  }
  assert.equal(response.status, 404, `Registry lookup failed: HTTP ${response.status}`)
  const result = spawnSync(process.execPath, [cli, 'publish', file, '--access', 'public', '--provenance', '--ignore-scripts', '--tag', version.includes('-') ? 'next' : 'latest'], { stdio: 'inherit' })
  assert.equal(result.status, 0, 'npm publish failed.')
  // A newly published version can take a moment to become visible at the edge.
  let check
  for (let attempt = 0; attempt < 6; attempt++) {
    check = await fetch(`https://registry.npmjs.org/${name}/${version}`, { headers: { 'Cache-Control': 'no-cache' } })
    if (check.ok || (check.status !== 404 && check.status < 500)) break
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt))
  }
  assert.ok(check.ok, 'Published package could not be read back from the registry.')
  const published = await check.json()
  assert.equal(published.dist?.integrity, `sha512-${digest}`, 'Published tarball integrity does not match.')
  console.log(`Verified registry integrity for ${name}@${version}.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
