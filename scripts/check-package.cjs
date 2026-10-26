// Inspect the actual npm file list, then load an extracted package in isolation
// from its build tree. It uses the installed host dependencies, never a PAT.
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, readFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, join, sep } = require('node:path')
const { execFileSync } = require('node:child_process')
const tar = require('tar')

async function main() {
  const root = resolve(__dirname, '..')
  const directory = mkdtempSync(join(tmpdir(), 'qgh-package-'))
  try {
    const output = execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, encoding: 'utf8' })
    const packed = JSON.parse(output)
    const pack = Array.isArray(packed) ? packed[0] : packed['koishi-plugin-qq-github-bridge']
    assert.ok(pack?.filename, 'npm pack returned no package metadata.')
    const files = pack.files.map(file => file.path)
    for (const path of ['lib/index.js', 'lib/index.d.ts', 'dist/index.js', 'dist/style.css', 'client/index.ts', 'src/index.ts', 'README.md', 'LICENSE']) {
      assert.ok(files.includes(path), `Missing published file: ${path}`)
    }
    assert.ok(!files.some(path => /(^|\/)(node_modules|\.git|\.env|\.npmrc|test)(\/|$)/.test(path)), 'Package contains private or test files.')
    await tar.x({ file: join(directory, pack.filename), cwd: directory, strict: true })
    const manifest = JSON.parse(readFileSync(join(directory, 'package/package.json'), 'utf8'))
    assert.ok(manifest.peerDependencies.koishi)
    assert.equal(manifest.private, undefined)
    assert.ok(existsSync(join(directory, 'package', manifest.main)))
    // Resolve host dependencies from this workspace, but load the shipped entry.
    const probe = `
      const assert = require('node:assert/strict');
      const { createRequire } = require('node:module');
      const host = createRequire(${JSON.stringify(join(root, 'package.json'))});
      const { Context } = host('koishi');
      const { HTTP } = host('@koishijs/plugin-http');
      const Sqlite = host('@koishijs/plugin-database-sqlite').default;
      const bridge = require(${JSON.stringify(join(directory, 'package', manifest.main))});
      (async () => {
        assert.equal(bridge.name, 'qq-github-bridge');
        const app = new Context();
        app.plugin(HTTP);
        app.plugin(Sqlite, { path: ':memory:' });
        app.plugin(bridge, { token: 'packaging-fixture', superAdmins: ['123456789'] });
        try {
          await app.start();
          assert.ok(app.model.tables.qgh_admin);
          await app.database.create('qgh_admin', { qq: '234567890', addedBy: '123456789', createdAt: new Date() });
          assert.equal((await app.database.get('qgh_admin', '234567890')).length, 1);
        } finally { await app.stop(); }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `
    execFileSync(process.execPath, ['-e', probe], {
      cwd: directory, stdio: 'inherit',
      env: { ...process.env, NODE_PATH: join(root, 'node_modules') },
    })
    console.log(`Package smoke check passed: ${pack.filename} (${files.length} files)`)
  } finally {
    assert.ok(directory.startsWith(resolve(tmpdir()) + sep) && directory.includes('qgh-package-'))
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
