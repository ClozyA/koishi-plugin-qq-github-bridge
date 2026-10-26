<template>
  <k-layout>
    <div class="qgh-page">
      <header class="qgh-heading">
        <div><h1>QQ GitHub Bridge</h1><p>管理跨群共享的管理员权限，查看操作记录。</p></div>
        <button :disabled="busy" @click="refresh">刷新数据</button>
      </header>
      <p v-if="notice" class="qgh-notice" role="status">{{ notice }}</p>
      <p v-if="error" class="qgh-error" role="alert">{{ error }}</p>
      <p v-if="!dashboard && !error">正在读取后台数据……</p>
      <template v-if="dashboard">
        <section class="qgh-card">
          <h2>超级管理员</h2>
          <p>{{ dashboard.superAdmins.join('、') }}</p>
          <p class="qgh-muted">超级管理员、仓库绑定、Token 和安全选项在插件配置页修改。此处的普通管理员与 QQ 指令使用同一份数据库。</p>
        </section>
        <section class="qgh-card">
          <h2>普通管理员</h2>
          <form class="qgh-actions" @submit.prevent="requestManage('add', qq)">
            <label for="qgh-qq">QQ 号</label>
            <input id="qgh-qq" v-model="qq" inputmode="numeric" pattern="[1-9][0-9]{4,19}" maxlength="20" placeholder="例如 123456789" required>
            <button :disabled="busy">新增管理员</button>
          </form>
          <div v-if="pending" class="qgh-confirm" role="group" aria-label="确认管理员变更">
            <p>确定{{ pending.action === 'add' ? '添加' : '撤销' }}管理员 <strong>{{ pending.qq }}</strong>？权限在所有绑定群中生效。</p>
            <div class="qgh-actions">
              <button :disabled="busy" @click="confirmManage">{{ pending.action === 'add' ? '确认新增' : '确认撤销' }}</button>
              <button :disabled="busy" @click="pending = undefined">取消</button>
            </div>
          </div>
          <div class="qgh-scroll"><table>
            <thead><tr><th>QQ 号</th><th>添加者</th><th>添加时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="admin in dashboard.admins" :key="admin.qq">
                <td>{{ admin.qq }}</td><td>{{ admin.addedBy }}</td><td>{{ time(admin.createdAt) }}</td>
                <td><button :disabled="busy || dashboard.superAdmins.includes(admin.qq)" @click="requestManage('remove', admin.qq)">撤销</button></td>
              </tr>
              <tr v-if="!dashboard.admins.length"><td colspan="4">本页暂无普通管理员。</td></tr>
            </tbody>
          </table></div>
          <div class="qgh-actions qgh-pagination">
            <button :disabled="busy || page <= 1" @click="changePage(-1)">上一页</button><span>第 {{ page }} 页</span>
            <button :disabled="busy || !dashboard.hasMoreAdmins" @click="changePage(1)">下一页</button>
          </div>
        </section>
        <section class="qgh-card">
          <h2>仓库绑定与 Token 检查</h2>
          <div class="qgh-scroll"><table>
            <thead><tr><th>QQ群</th><th>GitHub 仓库</th><th>状态</th></tr></thead>
            <tbody><tr v-for="binding in dashboard.bindings" :key="binding.groupId">
              <td>{{ binding.groupId }}</td><td>{{ binding.repository }}</td><td>{{ binding.enabled ? '已启用' : '已禁用' }}</td>
            </tr><tr v-if="!dashboard.bindings.length"><td colspan="3">请先在插件配置页添加群绑定。</td></tr></tbody>
          </table></div>
          <div class="qgh-actions qgh-pagination">
            <label for="qgh-repo">检查范围</label>
            <select id="qgh-repo" v-model="checkGroup">
              <option value="">仅验证 Token 身份</option>
              <option v-for="binding in dashboard.bindings.filter(b => b.enabled)" :key="binding.groupId" :value="binding.groupId">{{ binding.repository }}（{{ binding.groupId }}）</option>
            </select>
            <button :disabled="busy" @click="validate">检查连接</button>
          </div>
          <div v-if="tokenStatus" role="status">
            <p>执行 GitHub 操作的账号：{{ tokenStatus.login }}</p><p>{{ tokenStatus.message }}</p>
            <p v-for="repo in tokenStatus.repositories" :key="repo.repository">{{ repo.repository }}：{{ repo.accessible ? '✓' : '✗' }} {{ repo.message }}</p>
          </div>
        </section>
        <section class="qgh-card">
          <h2>最近操作</h2>
          <p class="qgh-muted">{{ dashboard.auditEnabled ? `审计已启用，保留 ${dashboard.auditRetentionDays} 天。` : '审计已关闭，以下为保留期内的历史记录。' }}显示最近 100 条，不包含 Token、昵称和评论正文。pending 表示结果尚未落库，unknown 表示 GitHub 写入结果不确定，请先核对再重试。</p>
          <div class="qgh-scroll"><table>
            <thead><tr><th>时间</th><th>操作者</th><th>操作 / 目标</th><th>群 / 仓库</th><th>结果</th></tr></thead>
            <tbody><tr v-for="audit in dashboard.audits" :key="audit.id">
              <td>{{ time(audit.createdAt) }}</td>
              <td>{{ audit.source }}:{{ audit.actorId }}<span v-if="audit.source === 'console' && audit.actorQQ">（QQ {{ audit.actorQQ }}）</span></td>
              <td>{{ audit.action }} {{ audit.target }}</td><td>{{ audit.groupId || '后台' }}<br>{{ audit.repository }}</td>
              <td>{{ audit.result }}<br><small>{{ audit.detail }}</small></td>
            </tr><tr v-if="!dashboard.audits.length"><td colspan="5">暂无审计记录。</td></tr></tbody>
          </table></div>
        </section>
      </template>
    </div>
  </k-layout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { send } from '@koishijs/client'
import type {} from '../src/rpc'
import type { Dashboard, TokenStatus } from '../src/types'

const dashboard = ref<Dashboard>()
const tokenStatus = ref<TokenStatus>()
const page = ref(1)
const qq = ref('')
const checkGroup = ref('')
const busy = ref(false)
const notice = ref('')
const error = ref('')
const pending = ref<{ action: 'add' | 'remove'; qq: string }>()
const time = (value: string) => new Date(value).toLocaleString()

async function run(task: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try { await task() } catch (reason) {
    error.value = typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '请求失败，请检查控制台连接并刷新。'
  } finally { busy.value = false }
}

async function load() {
  const data = await send('qq-github-bridge/dashboard', page.value)
  if (!data) throw new Error('控制台尚未连接，请连接后刷新。')
  dashboard.value = data
}

function refresh() { return run(load) }
function changePage(delta: number) { page.value += delta; return refresh() }
function requestManage(action: 'add' | 'remove', target: string) {
  if (!/^[1-9][0-9]{4,19}$/.test(target)) { error.value = '请输入有效的数字 QQ 号。'; return }
  pending.value = { action, qq: target }
}
function confirmManage() {
  if (!pending.value || busy.value) return
  const { action, qq: target } = pending.value
  pending.value = undefined
  return run(async () => {
    const result = await send('qq-github-bridge/admin', action, target)
    if (!result) throw new Error('控制台连接中断，结果未知，请刷新列表核对。')
    notice.value = result
    qq.value = ''
    await load()
  })
}
function validate() {
  return run(async () => {
    tokenStatus.value = await send('qq-github-bridge/validate', checkGroup.value || undefined)
    if (!tokenStatus.value) throw new Error('控制台尚未连接。')
  })
}
onMounted(refresh)
</script>

<style scoped>
.qgh-page { max-width: 1200px; margin: 0 auto; padding: 24px; color: var(--fg1); }
.qgh-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
h1 { margin: 0; font-size: 25px; } h2 { font-size: 18px; margin: 0 0 16px; }
p { line-height: 1.65; } .qgh-muted, .qgh-heading p { opacity: .72; }
.qgh-card { border: 1px solid var(--k-color-divider, #8885); border-radius: 10px; padding: 22px; margin-bottom: 20px; background: var(--bg1); }
.qgh-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
.qgh-pagination { margin-top: 18px; margin-bottom: 0; }
input, select, button { font: inherit; padding: 8px 12px; border: 1px solid #8887; border-radius: 6px; color: inherit; background: var(--bg2, transparent); }
button { cursor: pointer; } button:disabled { opacity: .45; cursor: not-allowed; }
button:hover:enabled { border-color: var(--k-color-primary, #777); }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--k-color-primary, #777); outline-offset: 2px; }
.qgh-scroll { overflow-x: auto; } table { border-collapse: collapse; width: 100%; text-align: left; }
th, td { padding: 11px 12px; border-bottom: 1px solid #8884; vertical-align: top; overflow-wrap: anywhere; }
th { white-space: nowrap; } .qgh-error, .qgh-notice { padding: 12px 16px; border-radius: 6px; white-space: pre-wrap; }
.qgh-error { background: #df3c3c18; border: 1px solid #df3c3c66; }
.qgh-notice { background: #3a957318; border: 1px solid #3a957366; }
.qgh-confirm { border: 1px solid #b38c36; background: #b38c3614; border-radius: 6px; padding: 0 16px; margin-bottom: 16px; }
@media (max-width: 650px) { .qgh-page { padding: 12px; } .qgh-card { padding: 16px; } .qgh-heading { align-items: flex-start; } select { max-width: 100%; } }
</style>
