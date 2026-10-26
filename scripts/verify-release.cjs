const assert = require('node:assert/strict')
const { name, version, repository } = require('../package.json')

const tag = process.argv[2]
assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Package version must be semantic versioning.')
assert.equal(tag, `v${version}`, 'Release tag must match package.json version.')
assert.equal(name, 'koishi-plugin-qq-github-bridge')
assert.equal(repository.url, 'git+https://github.com/ClozyA/koishi-plugin-qq-github-bridge.git')
console.log(`Verified ${name}@${version} (${tag})`)
