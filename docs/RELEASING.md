# 发布与 CI

仓库：https://github.com/ClozyA/koishi-plugin-qq-github-bridge

npm：https://www.npmjs.com/package/koishi-plugin-qq-github-bridge

所有命令使用 PowerShell 7（`pwsh`）。首次初始化需要可发布此包的 npm 账号和可维护此仓库的 GitHub 账号。

## CI

`ci.yml` 在 main 推送、Pull Request 及手动触发时运行：

- Ubuntu / Node 22、Ubuntu / Node 24、Windows / Node 24。
- `npm ci`、后端与 Vue 类型检查、构建、125 项自动化测试。
- `npm run check:package` 检查真实 npm 文件列表，将 tarball 解压到临时目录，加载发布入口，并用 Koishi / HTTP / SQLite 启动和读写管理员表。宿主依赖来自已安装的开发环境；这项检查不代表真实 QQ 或外部 GitHub 验证。

GitHub Actions 使用固定 commit，检查作业仅有仓库读取权限。开发依赖的上游审计告警不被当作零风险；详情见 REVIEW 和 TESTING。

## 首次 npm 初始化

npm 官方要求包已存在才能配置可信发布。先通过本机已登录 npm 完成首版，再配置 OIDC：

```powershell
npm login --auth-type=web --registry=https://registry.npmjs.org
npm run check
npm run check:package
npm pack
npm publish ./koishi-plugin-qq-github-bridge-1.0.0.tgz --access public --ignore-scripts
npm trust github koishi-plugin-qq-github-bridge --repo ClozyA/koishi-plugin-qq-github-bridge --file release.yml --allow-publish --yes
npm trust list koishi-plugin-qq-github-bridge
gh variable set NPM_PUBLISH_ENABLED --repo ClozyA/koishi-plugin-qq-github-bridge --body true
```

`npm trust` 需要 npm >=11.15，且账户启用 2FA；安全密钥等本人验证需维护者完成。也可以在 npm 包 Settings → Trusted Publisher 配置同一仓库和 `release.yml`，允许 `npm publish`。发布工作流不保存长期 `NPM_TOKEN`。

首版本机发布不带 GitHub Actions provenance。后续 CI 发布使用短期 OIDC 身份并生成来源证明。

## 后续发布

确保 main 已提交且 CI 正常：

```powershell
npm version patch
git push origin main
git push origin --tags
```

需要 minor / major 升级时替换 `patch`。`npm version` 更新 manifest 和 lockfile，创建版本提交与同名标签。不要手工只改标签。

`release.yml` 会：

1. 检查标签恰为 `v` + package.json 版本、对应提交属于 main。
2. 完整检查、构建、验证 npm 包，再产出唯一 tarball 与 SHA256SUMS。
3. 创建 GitHub Release 并附安装包和校验值。
4. 当仓库变量 `NPM_PUBLISH_ENABLED=true` 时，通过 npm OIDC 发布该 tarball。稳定版用 `latest`；带预发布后缀的版本用 `next`，GitHub Release 也标记为预发布。
5. 发布后读取 npm registry，比对 tarball 的 SHA512 integrity。

NPM_PUBLISH_ENABLED 只控制 npm 作业；GitHub Release 不依赖 npm 凭据。未设置该变量时，npm 作业会跳过，不能将此描述为 npm 已发布。

## 失败与重试

在 Actions → Release → Run workflow 输入已有标签（例如 `v1.0.1`）可重新执行。版本已存在且内容完全相同才跳过 npm 发布；内容不同会失败并要求升级版本，不能覆盖现有 npm 版本。

GitHub Release 资产可重复上传；不要移动已经公开发布的标签。npm 首版应使用从同一标签的 GitHub Release 下载的 tarball，避免首版重试时因本机构建差异产生 integrity 不一致。

401 / EAUTH 先检查 npm 账户；CI 的 EOIDC / ENEEDAUTH 检查 npm Trusted Publisher 的账号、仓库、文件名、允许的动作以及是否使用 GitHub 托管 runner。首次可信发布关系需要在 npm 规定的时限内使用，过期时需维护者重新配置。

官方参考：[npm 可信发布](https://docs.npmjs.com/trusted-publishers/)、[npm trust](https://docs.npmjs.com/cli/v12/commands/npm-trust/)、[Koishi 发布规范](https://koishi.chat/zh-CN/guide/develop/publish.html)。
