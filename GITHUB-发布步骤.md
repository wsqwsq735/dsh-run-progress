# 把 dsh-run-progress 发布到 GitHub（详细步骤）

> 适用：Windows 11 + PowerShell。命令逐条复制执行即可，每条后面写了**期望看到什么**，
> 对不上就停下看待办清单最后一节「常见错误」。

- 要发布的目录：`D:\code\dsh-run-progress`
- **不要**在上一级目录里初始化 git（那里可能还有别的项目文件）

---

## 第 1 步：安装 Git（本机还没装）

先确认：

```powershell
git --version
```

- 输出 `git version 2.x.x` → 已装，跳到第 2 步
- 报「无法将 git 项识别为…」→ 继续下面

用 winget 安装（本机 winget 1.29 可用）：

```powershell
winget install --id Git.Git -e --source winget
```

装完**必须关掉当前 PowerShell 再开一个新的**（PATH 才会更新），然后：

```powershell
git --version
```

期望：`git version 2.5x.x.windows.1`

> 不想用 winget 就去 https://git-scm.com/download/win 下载安装包，一路 Next 即可
> （默认会勾选 Git Credential Manager，第 5 步推送时要用它）。

---

## 第 2 步：配置身份

```powershell
git config --global user.name "你的名字或昵称"
git config --global user.email "你的GitHub邮箱"
```

检查：

```powershell
git config --global --list
```

期望看到这两行。**邮箱建议用 GitHub 账号的主邮箱**（或 GitHub 提供的
`12345678+用户名@users.noreply.github.com`），否则提交不会关联到你的头像。

顺手统一换行（仓库里已带 `.gitattributes`，这条只是保险）：

```powershell
git config --global core.autocrlf false
```

---

## 第 3 步：在 GitHub 上建仓库

1. 打开 https://github.com ，登录（没账号先注册）。
2. 右上角 **+** → **New repository**。
3. 填写：
   - **Repository name**：`dsh-run-progress`
   - **Description**：`Run progress rail, token readout with RMB estimate, and per-turn run flow for the DSH Web GUI`
   - 选 **Public**（插件市场要能读到）
   - **不要**勾 *Add a README file*、*Add .gitignore*、*Choose a license*（本地已有，勾了会冲突）
4. 点 **Create repository**。

建好后页面会显示一段以 `git remote add origin ...` 开头的命令——第 5 步用得上。
地址形如：

```
https://github.com/你的用户名/dsh-run-progress.git
```

---

## 第 4 步：本地初始化并提交

```powershell
cd "D:\code\dsh-run-progress"
git init -b main
git status
```

期望：`No commits yet` + 一串 `Untracked files`，其中**不应出现** `dsh-run-progress-0.7.1.tgz`
和 `node_modules/`（`.gitignore` 已排除；若出现了说明你 cd 错目录）。

先跑一遍测试，确认要提交的是能用的版本：

```powershell
node test\smoke.cjs en     # 末行 all checks passed
node test\smoke.cjs zh     # 末行 all checks passed
```

加入暂存区并看清单：

```powershell
git add .
git status
```

期望的待提交文件（14 个，顺序无关）：

```
.gitattributes      .gitignore        LICENSE           PUBLISHING.md
README.md           client.js         cordis.patch.yml  icon.svg
index.js            package.json
locale/en.json      locale/zh.json
test/smoke.cjs      GITHUB-发布步骤.md
```

提交：

```powershell
git commit -m "feat: run progress rail, token readout with RMB estimate, per-turn run flow"
```

期望：`[main (root-commit) xxxxxxx] feat: ... 14 files changed, ...`

---

## 第 5 步：连接 GitHub 并推送（含认证）

```powershell
git remote add origin https://github.com/你的用户名/dsh-run-progress.git
git remote -v
```

期望：两行 origin（fetch / push），地址与第 3 步一致。

推送：

```powershell
git push -u origin main
```

**第一次推送会弹认证**，三种方式任选：

### 方式 A：浏览器登录（推荐，装 Git 时自带的 Git Credential Manager）

弹出窗口 → 选 **Sign in with your browser** → 浏览器里登录 GitHub → 点 **Authorize**。
成功后回到终端，等待 `Writing objects` 完成。凭证会存进 Windows 凭据管理器，
之后不用再登录。

### 方式 B：个人访问令牌（PAT，GCM 不可用时）

1. GitHub → 右上头像 → **Settings** → 左侧最下 **Developer settings**
   → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**
2. Note 填 `dsh-run-progress`，Expiration 选 90 days，
   **Scopes 勾 `repo`**（私有仓库还需要 `workflow`，公有仓库只要 `repo`）
3. 复制生成的 `ghp_...` 令牌（只显示一次）
4. 推送时：
   - Username：你的 GitHub 用户名
   - Password：**粘贴令牌**（不是登录密码，GitHub 早已不接受账号密码）

清掉错误凭证重试：

```powershell
cmdkey /list | findstr git
# 或在「控制面板 → 凭据管理器 → Windows 凭据」删掉 git:https://github.com
```

### 方式 C：SSH 密钥（长期最省事）

```powershell
ssh-keygen -t ed25519 -C "你的GitHub邮箱"     # 一路回车，可留空密码
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | Set-Clipboard   # 已复制公钥
```

把公钥粘到 GitHub → **Settings → SSH and GPG keys → New SSH key**，
然后改用 SSH 地址：

```powershell
git remote set-url origin git@github.com:你的用户名/dsh-run-progress.git
ssh -T git@github.com      # 首次问 yes，成功显示 Hi 用户名!
git push -u origin main
```

---

## 第 6 步：验证

```powershell
git log --oneline -1
git remote -v
git status
```

期望：一条提交、origin 地址、以及 `nothing to commit, working tree clean`。

浏览器刷新 `https://github.com/你的用户名/dsh-run-progress`，应能看到
`client.js`、`locale/`、`test/` 等文件，README 渲染在下方。

---

## 第 7 步：打版本标签 + 发 Release

标签（本机）：

```powershell
git tag -a v0.7.1 -m "dsh-run-progress 0.7.1"
git push origin v0.7.1
```

Release（网页，30 秒）：

1. 仓库页右侧 **Releases** → **Create a new release**
2. **Choose a tag** 选 `v0.7.1` → Title 填 `v0.7.1`
3. Describe this release 写三条：进度条与上下文细栏 / 胶囊可拖动、双击复位、token→RMB 估算 / 面板按轮展开（点击展开）
4. 可把 `dsh-run-progress-0.7.1.tgz` 拖进 *Attach binaries*，别人能直接下载安装
5. **Publish release**

> 插件市场会读 Release 标签说明当作「更新内容」，写清楚有助于用户理解升级。

---

## 第 8 步：发布后的收尾（让仓库看起来可信）

1. **`package.json` 补仓库链接**（npm 页面、市场卡片都会显示）：

```json
"repository": { "type": "git", "url": "git+https://github.com/你的用户名/dsh-run-progress.git" },
"homepage": "https://github.com/你的用户名/dsh-run-progress#readme"
```

改完再提交一次：

```powershell
git add package.json
git commit -m "chore: add repository and homepage"
git push
```

2. 仓库页 **About**（右侧齿轮）：Description 同上；Topics 填
   `deepseek` `harness` `dsh-plugin` `token-usage` `progress-bar`
3. README 顶部加徽章（可选）：

```markdown
![version](https://img.shields.io/github/v/tag/你的用户名/dsh-run-progress)
![license](https://img.shields.io/github/license/你的用户名/dsh-run-progress)
```

4. 确认 GitHub 识别到 License：仓库首页右侧应显示 `MIT license`（来自 `LICENSE` 文件）。

---

## 第 9 步：以后每次更新（固定四步）

```powershell
cd "D:\code\dsh-run-progress"
node test\smoke.cjs en ; node test\smoke.cjs zh     # 1. 自测
# 2. 改 package.json 版本号（0.7.1 -> 0.7.2），或 npm version patch
git add -A
git commit -m "fix: ..."                            # 3. 提交
git push                                            # 4. 推送
git tag v0.7.2 ; git push origin v0.7.2             # 5. 打标签（要发 Release 时）
```

发 npm 的版本号必须与 tag 一致（`npm publish` 见 PUBLISHING.md），市场靠版本对比判断「有更新」。

---

## 第 10 步：常见错误速查

| 现象 | 原因 | 处理 |
|---|---|---|
| `fatal: not a git repository` | 没 cd 到插件目录 | `cd "D:\code\dsh-run-progress"` |
| `remote origin already exists` | 重复添加 | `git remote set-url origin <正确地址>` |
| `Authentication failed` | 用了账号密码 | 改用第 5 步方式 A/B/C |
| `src refspec main does not match any` | 还没提交过 | 先 `git add .` + `git commit -m "..."` |
| `Updates were rejected … non-fast-forward` | 远程有本地没有的提交（比如建仓时勾了 README） | `git pull --rebase origin main` 后重推 |
| 仓库里出现 `node_modules/` | 用了 `git add -A -f` 或 .gitignore 被改 | `git rm -r --cached node_modules` 后重新提交 |
| 仓库里出现 `.tgz` | 同上 | `git rm --cached *.tgz`（`.gitignore` 已含 `*.tgz`） |
| 中文文件名/内容乱码 | 编辑器编码不是 UTF-8 | 用 UTF-8 保存；`.gitattributes` 已统一换行 |
| 视频/大文件推送被拒（>100MB） | GitHub 单文件上限 | Release 附件里上传，或改用 Git LFS |
| `warning: LF will be replaced by CRLF` | Windows 换行设置 | `git config --global core.autocrlf false` |
| 提交者不是自己/没头像 | 邮箱与 GitHub 不匹配 | `git config --global user.email` 改成账号邮箱，历史提交需 rebase 才改 |

---

## 一页速查（装好 Git 之后）

```powershell
cd "D:\code\dsh-run-progress"
git init -b main
git add .
git commit -m "feat: run progress rail, token readout with RMB estimate, per-turn run flow"
git remote add origin https://github.com/你的用户名/dsh-run-progress.git
git push -u origin main          # 首次会弹浏览器授权
git tag -a v0.7.1 -m "dsh-run-progress 0.7.1"
git push origin v0.7.1
```

推完去 GitHub 建一个 Release 挂上 `dsh-run-progress-0.7.1.tgz`，就完成了。
上架 DSH 插件市场另见 [PUBLISHING.md](PUBLISHING.md) 第 3 节（PR 到 awesome-dsh-plugin）。
