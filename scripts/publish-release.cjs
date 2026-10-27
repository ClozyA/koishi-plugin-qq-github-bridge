// Publish the same tarball checked by the package job. On reruns, only skip a
// published version if its integrity matches exactly; never swallow auth errors.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { readFileSync, readdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { name, version } = require('../package.json')

function readVersion(packageName, packageVersion) {
  const url = new URL(`https://registry.npmjs.org/${packageName}/${packageVersion}`)
  // Avoid retaining a negative CDN response from the pre-publish lookup.
  url.searchParams.set('verification', String(Date.now()))
  return fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(10000) })
}

async function waitForPublishedVersion(packageName, packageVersion) {
  // npm explicitly reports that a successful upload may need several minutes
  // of processing before it becomes publicly readable. Only retry safe reads.
  for (let attempt = 0; attempt < 20; attempt++) {
    let response
    try { response = await readVersion(packageName, packageVersion) } catch (error) {
      if (attempt === 19) throw error
    }
    if (response?.ok) return response.json()
    if (response && response.status !== 404 && response.status < 500) {
      throw new Error(`Registry verification failed: HTTP ${response.status}`)
    }
    if (attempt < 19) {
      console.log(`npm accepted the upload; waiting for registry processing (${attempt + 1}/20).`)
      await new Promise(resolve => setTimeout(resolve, 15000))
    }
  }
  throw new Error('npm accepted the upload, but the version is still not readable. Check npm processing status and rerun this workflow; do not republish a different tarball.')
}

async function main() {
  const cli = process.env.npm_execpath
  assert.ok(cli, 'Run this script through npm run release:publish.')
  const files = readdirSync(resolve('release')).filter(file => file.endsWith('.tgz'))
  assert.equal(files.length, 1, 'Expected exactly one release tarball.')
  const file = resolve('release', files[0])
  const digest = createHash('sha512').update(readFileSync(file)).digest('base64')
  const response = await readVersion(name, version)
  if (response.ok) {
    const published = await response.json()
    assert.equal(published.dist?.integrity, `sha512-${digest}`, 'This version already exists with different content. Bump the package version.')
    console.log(`${name}@${version} is already published with matching integrity.`)
    return
  }
  assert.equal(response.status, 404, `Registry lookup failed: HTTP ${response.status}`)
  const result = spawnSync(process.execPath, [cli, 'publish', file, '--access', 'public', '--provenance', '--ignore-scripts', '--tag', version.includes('-') ? 'next' : 'latest'], { stdio: 'inherit' })
  assert.equal(result.status, 0, 'npm publish failed.')
  const published = await waitForPublishedVersion(name, version)
  assert.equal(published.dist?.integrity, `sha512-${digest}`, 'Published tarball integrity does not match.')
  console.log(`Verified registry integrity for ${name}@${version}.`)
}
module.exports = { waitForPublishedVersion }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
