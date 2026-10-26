import type { Context } from '@koishijs/client'
import Page from './page.vue'

export default (ctx: Context) => {
  ctx.page({ name: 'QQ GitHub Bridge', path: '/qq-github-bridge', authority: 5, component: Page })
}
