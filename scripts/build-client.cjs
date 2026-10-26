const { build } = require('@koishijs/client/lib')
const { resolve } = require('node:path')

build(resolve(__dirname, '..')).catch(() => {
  console.error('控制台客户端构建失败。')
  process.exitCode = 1
})
