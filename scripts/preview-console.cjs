// Local development fixture only. Uses in-memory SQLite and mock GitHub.
// Nothing in this script sends requests to github.com or a real QQ account.
const { createServer } = require('node:http')
const { Context } = require('koishi')
const { HTTP } = require('@koishijs/plugin-http')
const { Server } = require('@koishijs/plugin-server')
const Sqlite = require('@koishijs/plugin-database-sqlite').default
const Console = require('@koishijs/plugin-console').default
const Auth = require('@koishijs/plugin-auth').default
const bridge = require(process.env.BRIDGE_PREVIEW_PACKAGE || '../lib')

async function main() {
  const api = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return }
    res.end(JSON.stringify(req.url === '/user' ? { login: 'local-preview' } : { full_name: 'example/project' }))
  })
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  const app = new Context()
  app.plugin(HTTP)
  app.plugin(Server, { host: '127.0.0.1', port: 5147, maxPort: 5167 })
  app.plugin(Sqlite, { path: ':memory:' })
  app.plugin(Console, { open: false, devMode: !process.env.BRIDGE_PREVIEW_PACKAGE })
  app.plugin(Auth, { admin: { enabled: true, username: 'bridge-preview', password: 'local-preview-only' } })
  app.plugin(bridge, {
    token: 'preview-dummy-token', apiBaseUrl: `http://127.0.0.1:${api.address().port}`,
    superAdmins: ['123456789'],
    bindings: [{ groupId: '345678901', owner: 'example', repo: 'project', enabled: true }],
  })
  await app.start()
  console.log(`Preview: http://127.0.0.1:${app.server.port}/qq-github-bridge`)
  console.log('Local fixture account: bridge-preview / local-preview-only')
  const stop = async () => { await app.stop(); api.closeAllConnections(); api.close(); process.exit(0) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
