# NassaAPI 前端改动说明

本文档记录本轮围绕 `new-api-fork/web/default` 做过的前端改动，以及后续为了本地登录排查做的修复。

## 一、前面做过的首页改版

目标：把默认首页改成更接近 Apple 官网风格的 NassaAPI 首页。

主要改动文件：

- `new-api-fork/web/default/src/features/home/components/sections/hero.tsx`
- `new-api-fork/web/default/src/features/home/components/sections/features.tsx`
- `new-api-fork/web/default/src/features/home/index.tsx`
- `new-api-fork/web/default/src/styles/index.css`
- `new-api-fork/web/default/src/components/layout/components/public-header.tsx`
- `new-api-fork/web/default/src/features/home/api.ts`
- `new-api-fork/web/default/src/features/home/hooks/use-home-page-content.ts`
- `new-api-fork/web/default/src/lib/api.ts`
- `new-api-fork/web/default/src/styles/theme.css`

具体内容：

- 重写首页 Hero 区域。
- 使用纯黑背景 `#000000`、主文字 `#F5F5F7`、副文字 `#86868B`。
- 把主标题改成 `NassaAPI`。
- 增加文案 `让 AI 编程触手可及`。
- 使用 Apple 系统字体栈。
- 使用白色圆角主按钮和文字型次按钮。
- 移除旧的终端预览式 Hero 展示。
- 把特性区改成 Bento 网格。
- 使用 Lucide 单色线性图标。
- 增加玻璃拟态卡片样式。
- 增加入场动画，使用 `cubic-bezier(0.32, 0.72, 0, 1)`。
- 让首页公共头部在首页中显示 NassaAPI 品牌和黑色玻璃效果。
- 本地无后端时，首页可选接口 `/api/home_page_content`、`/api/status`、`/api/notice` 静默失败，避免 toast 挡住预览。

生成过的本地预览截图：

- `new-api-fork/web/default/nassaapi-preview-desktop.png`
- `new-api-fork/web/default/nassaapi-preview-bento.png`
- `new-api-fork/web/default/nassaapi-preview-mobile.png`
- `new-api-fork/web/default/nassaapi-local-home.png`
- `new-api-fork/web/default/nassaapi-local-home-desktop.png`

## 二、后面排查登录问题做的修复

问题表现：

- 前端能打开 `http://localhost:5174/sign-in`。
- 用户登录时提示“用户名或密码错误，或用户已被封禁”。
- 之前还存在一种隐患：登录成功后刷新或进入后台，可能因为缺少 `New-Api-User` 请求头导致 `/api/user/self` Unauthorized。

实际排查结果：

- `5174` 是前端 preview。
- 前端 API 代理到 `localhost:3000`。
- 一开始 `localhost:3000` 后端没有启动，所以登录链路不完整。
- 后端启动后，当前本地 SQLite 是新的本地库，不包含用户输入的 `Nassa11111`。
- 我初始化了本地 root 用户，并注册了本地测试用户 `Nassa11111`。

登录修复代码文件：

- `new-api-fork/web/default/src/stores/auth-store.ts`
- `new-api-fork/web/default/src/lib/api.ts`

修复内容：

- `auth-store.ts`
  - 保存 `user` 时同步保存 `uid`。
  - 退出登录时同步删除 `user` 和 `uid`。
  - 如果浏览器旧缓存里只有 `user`，没有 `uid`，初始化 auth store 时会从 `user.id` 自动恢复 `uid`。

- `lib/api.ts`
  - 所有 API 请求读取用户 id 时，优先读 `uid`。
  - 如果 `uid` 不存在，会尝试读取 localStorage 里的 `user.id`。
  - 如果成功读取到 `user.id`，会自动写回 `uid`，并用于 `New-Api-User` 请求头。
  - 这样可以避免旧登录态因为缺少 `uid` 而导致登录后接口 Unauthorized。

## 三、本地运行和本地数据操作

本地服务：

- 前端：`http://localhost:5174/`
- 后端：`http://localhost:3000/`

本地测试账号：

```text
用户名: root
密码: password123
```

```text
用户名: Nassa11111
密码: password123
```

这些账号只存在本地 SQLite 数据库里，不是代码改动，不会随着 Git 推送到 GitHub。

本地数据库文件：

```text
new-api-fork/one-api.db
```

## 四、本地后端启动补充

直接 `go run .` 时遇到过：

```text
pattern web/classic/dist: no matching files found
```

原因是 Go 后端 `main.go` 会 embed：

- `web/default/dist`
- `web/classic/dist`

而 `web/classic/dist` 当时不存在。

我按项目 `Dockerfile.dev` 的思路，在本地补了一个 classic 前端占位 dist 文件用于让后端本地启动：

```text
new-api-fork/web/classic/dist/index.html
```

注意：该文件当前可能被 `.gitignore` 忽略，不一定会出现在 `git status` 中。它只是本地运行后端用的占位文件。

## 五、已验证

已运行：

```bash
cd /Users/w/Desktop/newapi/new-api-fork/web/default
npm run typecheck
npm run build
```

结果：

- TypeScript 检查通过。
- 前端构建通过。
- 真实浏览器自动登录 `root / password123` 成功。
- 进入 `/dashboard/overview` 成功。
- 专门测试了“localStorage 有 `user` 但缺少 `uid`”的旧登录态场景，修复后可以自动恢复 `uid`，不再报 Unauthorized。

## 六、GitHub 推送建议

当前仓库工作区有很多其他文件改动，不应该直接执行：

```bash
git add .
git push
```

建议只提交本次登录修复相关文件：

```text
new-api-fork/web/default/src/stores/auth-store.ts
new-api-fork/web/default/src/lib/api.ts
```

如果要把首页 Apple 风格一起推送，再额外加入首页相关文件：

```text
new-api-fork/web/default/src/features/home/components/sections/hero.tsx
new-api-fork/web/default/src/features/home/components/sections/features.tsx
new-api-fork/web/default/src/features/home/index.tsx
new-api-fork/web/default/src/styles/index.css
new-api-fork/web/default/src/components/layout/components/public-header.tsx
new-api-fork/web/default/src/features/home/api.ts
new-api-fork/web/default/src/features/home/hooks/use-home-page-content.ts
new-api-fork/web/default/src/styles/theme.css
```

推荐新建分支：

```text
codex/fix-login-auth-uid
```

再提交、推送，避免污染 `main` 分支。

