# 发布指南：npm、GitHub 与 DSH 插件市场

这个目录本身就是一个可发布的 DSH 插件包（bundle）：`package.json` 里的 `dsh.bundle.patch` 让
它既能被 `dsh plugin add` 安装，也能被插件市场识别。

发布分三步，互不强制依赖，但市场收录通常要求 **npm 包 + GitHub 仓库** 都在。

---

## 0. 打包前检查

```powershell
cd dsh-run-progress
node test\smoke.cjs            # 退出码 0，末行 all checks passed
```

清单：

- [ ] `package.json` 版本号（当前 `0.8.0`）—— 每次发布 npm 必须递增，同版本不能重复发布
- [ ] `name`：`dsh-run-progress` 这个无作用域名很可能已被占用，发布前先 `npm view` 确认，
      被占用就改成 `@你的npm用户名/dsh-run-progress`
- [ ] `description` 一句话说明（市场卡片会用它）
- [ ] `keywords` 含 `dsh-plugin`（便于检索）
- [ ] `repository` / `homepage` 填上你的 GitHub 地址（没有也发得出去，只是 npm 页面缺链接）
- [ ] `engines.dsh` **故意留空**：声明过窄会在 prerelease 宿主上把安装拦住。确认只在某些版本
      可用时再加，例如 `"engines": { "dsh": ">=0.2.2-rc.3" }`
- [ ] `files` 白名单覆盖运行所需文件（`index.js`、`client.js`、`cordis.patch.yml`、
      `locale/*.json`、`icon.svg`、`README.md`）；`test/` 与 `PUBLISHING.md` 不会被打进包里
- [ ] `LICENSE`、`.gitignore` 就位
- [ ] `npm test`（= `node test/smoke.cjs en`）与 `npm run test:zh` 均为 `all checks passed`

本地打一个 tarball 试装（不会发布任何东西）：

```powershell
pnpm pack
# or, when pnpm is not on PATH: node "<your pnpm.mjs path>" pack
```

产物 `dsh-run-progress-<version>.tgz` 可直接拖进 DSH：**Plugins → Add plugin** 选这个文件，
或在会话里让 agent 执行 `install_bundle` 并指向该路径。

---

## 1. 发布到 npm（市场收录的基础）

```powershell
# 1) 先看名字是否可用（返回 404 表示可用）
npm view dsh-run-progress version

# 2) 登录（浏览器或 OTP）
npm login
npm whoami

# 3) 发布
npm publish
```

要点：

- 名字被占用时用作用域：把 `package.json` 的 `name` 改成 `@你的npm用户名/dsh-run-progress`，
  然后 `npm publish --access public`（作用域包默认私有，必须带这个参数）。
- 有 2FA 的账号发布会要一次性验证码（`--otp=123456`）。
- `package.json` 里的 `publishConfig.registry` 已指向官方源 `https://registry.npmjs.org/`。
- 发布后自检：

```powershell
npm view @你的用户名/dsh-run-progress version dist.tarball
```

- **不要**把 `private: true` 加回去，它会让 npm 拒绝发布（本包已去掉）。

---

## 2. 上传到 GitHub

逐步图文流程见 **[GITHUB-发布步骤.md](GITHUB-发布步骤.md)**（含安装 Git、认证方式、
标签与 Release、常见错误速查）。这里是命令速览：

```powershell
cd dsh-run-progress
git init -b main
git add .
git commit -m "feat: run progress rail, token readout with RMB estimate, per-turn run flow"
```

在 GitHub 上新建空仓库（不要勾选 README / .gitignore），然后：

```powershell
git remote add origin https://github.com/你的用户名/dsh-run-progress.git
git push -u origin main
```

打版本标签，方便市场读取「更新内容」：

```powershell
git tag v0.8.0
git push origin v0.8.0
```

建议在 GitHub 仓库里补齐这几项，市场与 DSH 安装页都会读：

- `package.json` 的 `repository`（`git+https://github.com/你的用户名/dsh-run-progress.git`）与 `homepage`
- 仓库 About 里填一句话简介 + topics：`deepseek`、`harness`、`dsh-plugin`
- README 里写清：装法、界面在哪、限制（本包的 README 已覆盖）

---

## 3. 上架 DSH 插件市场

市场（dshmarket）的插件列表**不从这个市场仓库提交**，而是来自精选目录
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
官方说明：在那边提 PR 加一条，站点与市场会自动收录，通常一天内生效。

步骤：

1. Fork `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`
2. 按仓库里现有条目的**同样格式**加一条（一般包含：插件名、一句话说明、GitHub 仓库地址、
   npm 包名或安装来源）。照抄相邻条目再替换内容即可，别自创字段。
3. 提 PR，标题例：`Add dsh-run-progress`
4. 合并后约一天内，dshmarket 与 awesome-dsh-plugin.com 同步；DSH 里
   **插件 → 发现** 即可搜到。

补充：

- 市场按 `engines.dsh` 或 `@deepseek-ai/dsh-*` peer 依赖判断兼容性；未声明会显示「未知」。
- 只有 GitHub、没有 npm 的条目也能收录（市场会读仓库里的 `package.json`，支持子目录）。
- 想让自己的**发现页索引源**先跑起来（不经过精选列表），可以把一份 format 1 的
  `index.json` 发到 npm（例如 `dsh-plugin-catalog`），在
  **插件 → 发现 → 索引源** 里填 `https://cdn.jsdelivr.net/npm/你的索引包/index.json`。

---

## 4. 从各处安装这个插件

| 来源 | 操作 |
|---|---|
| npm | 会话里让 agent 执行 `install_bundle`，target 填 `dsh-run-progress` 或 `@scope/dsh-run-progress`；或 **Plugins → Add plugin** 填包名 |
| GitHub | **Plugins → Add plugin** 粘贴仓库地址（或市场卡片上的安装按钮） |
| 本地目录 | `install_bundle` 的 target 指向本目录绝对路径（Junction 软链，改代码即时生效，刷新页面加载） |
| 本地 tarball | **Plugins → Add plugin** 选 `dsh-run-progress-<版本>.tgz` |

安装后在 **Plugins** 页面确认行状态为已启用；客户端改动没有 `pnpm run dev:web` 时需 `Ctrl+R` 刷新一次。

---

## 5. 后续版本

```powershell
# 1) 改代码并自测
node test\smoke.cjs

# 2) 升版本（手动改 package.json 或）
npm version patch   # / minor / major

# 3) 发布
npm publish

# 4) 同步 git
git push --follow-tags
```

市场会在下次刷新时看到新版本；DSH 里对已安装插件会显示「更新」。