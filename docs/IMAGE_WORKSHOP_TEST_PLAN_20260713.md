# NassaAPI 图片创作工作台设计与测试计划（2026-07-13）

## 1. 目标与边界

在 NewAPI 默认控制台增加登录后可访问的“图片创作”工作台，支持：

- `gpt-image-2`；
- `gpt-image-2-4k`；
- 从当前用户已启用的 API 令牌中选择调用令牌；
- 文生图与带单张参考图的编辑；
- 比例、数量、质量选择；
- 同页临时展示、预览和下载生成结果。

本任务只实现源码、自动化检查和独立测试容器验证。明确禁止：

- 不替换正式生产 NewAPI 镜像；
- 不重启生产 NewAPI、MySQL 或 Redis；
- 不修改生产 channel、模型映射、令牌或数据库；
- 不把用户完整 API Key 写入 localStorage、URL 或日志；
- 不为图片结果新增生产数据库表或持久化存储。

## 2. 当前能力确认

NewAPI 已提供：

- `POST /v1/images/generations`；
- `POST /v1/images/edits`；
- `GET /api/token/`；
- `POST /api/token/:id/key`。

生产只读检查确认：

- `gpt-image-2` 已在公开模型列表中；
- 已存在启用的 `gpt-image-2-4k` 独立渠道，映射至上游
  `gpt-image-2`；
- 当前测试用户密钥的模型列表尚未包含 `gpt-image-2-4k`，本任务不得修改该限制。

## 3. 视觉设计

页面服务对象：已经拥有 NassaAPI 令牌、希望不写代码就能生成或编辑图片的用户。
页面唯一任务：在一个视图中完成参数配置、生成和下载。

### 3.1 设计令牌

- `Canvas`: 继承应用 `background`；
- `Surface`: 继承 `card`；
- `Ink`: 继承 `foreground`；
- `Muted`: 继承 `muted` / `muted-foreground`；
- `Studio Blue`: 继承 `primary`，只用于当前选择和主操作；
- `Proof Amber`: `amber-500/10`，只用于临时结果提示。

字体完全继承控制台的 Public Sans/系统回退，避免出现与现有产品割裂的新品牌层。

### 3.2 布局

```text
┌──────────────────────────────────────────────────────────────┐
│ 图片创作 · 两个模型状态 · 临时结果提示                       │
├──────────────────────┬───────────────────────────────────────┤
│ 令牌 / 模型          │                                       │
│ 提示词               │              生成画布                 │
│ 比例                  │       空状态 / 加载态 / 图片网格       │
│ 数量 / 质量          │                                       │
│ 参考图                │                                       │
│ [开始生成]           │            本次胶片信息               │
└──────────────────────┴───────────────────────────────────────┘
```

窄屏下改为上下布局。唯一的视觉签名是结果图片下方的“本次胶片”元数据条，显示模型、
比例、质量与序号；其余区域保持克制，避免模板化装饰。

## 4. 请求契约

### 4.1 文生图

```http
POST /v1/images/generations
Authorization: Bearer sk-...
Content-Type: application/json
```

```json
{
  "model": "gpt-image-2",
  "prompt": "...",
  "size": "1024x1024",
  "n": 1,
  "quality": "auto",
  "response_format": "b64_json"
}
```

### 4.2 参考图编辑

使用 `multipart/form-data` 调用 `/v1/images/edits`，字段为 `model`、`prompt`、
`size`、`n`、`quality`、`response_format=b64_json` 与 `image`。

### 4.3 结果兼容

同时接受：

- `data[].b64_json`；
- `data[].url`（包括普通 URL 与 data URL）；
- `data[].revised_prompt`。

完整令牌仅在点击生成时按令牌 ID 获取并保存在当前函数作用域，不持久化。

## 5. 模型与尺寸

工作台展示八种比例：Auto、1:1、16:9、9:16、4:5、3:2、2:3、4:3。

- `gpt-image-2` 使用约 1K/1.5K 长边尺寸；
- `gpt-image-2-4k` 使用同一比例的 4K 长边尺寸；
- Auto 不发送 `size`，由上游决定；
- 切换模型时保留比例选择并重新计算实际尺寸。

令牌有模型限制时，令牌选择器标出不支持当前模型的条目并禁止选择；无限制令牌可用于
两个模型。令牌状态非启用、过期或额度耗尽时不允许选择。

## 6. 验证门槛

### 6.1 代码级

- 前端 typecheck 通过；
- ESLint 对新增/修改文件通过；
- Prettier check 通过；
- 完整前端 build 通过并生成新路由；
- `git diff --check` 通过；
- 不出现完整 `sk-` 密钥日志或持久化代码。

### 6.2 独立测试容器

- 使用独立 SQLite 数据卷，不设置生产 `SQL_DSN`；
- 只使用测试端口和测试容器名；
- 页面可登录并显示“图片创作”菜单；
- `/image-workshop` 可打开；
- 两个模型均出现在选择器；
- 令牌加载、无令牌、无权限、生成中、成功和失败状态均验证；
- 文生图请求字段正确；
- 上传参考图后切换至 `/v1/images/edits`；
- base64 和 URL 两种结果均能显示；
- 下载按钮可用；
- 桌面和窄屏布局无横向溢出。

若无法在完全隔离的测试环境取得真实上游凭证，则真实图片生成只对已授权模型进行
最小次数验证，其余使用请求契约和模拟响应测试。任何情况下不得为测试修改生产 channel。

## 7. 验证结果（2026-07-13）

- 新增纯逻辑单元测试：4 项通过，0 项失败；
- 新增功能及路由 ESLint：通过；
- 默认前端生产构建：通过；
- `git diff --check`：通过；
- 隔离测试镜像：`mynewapi:image-workshop-test-20260713`；
- 隔离镜像 ID：
  `sha256:c0e76fb6e8dde1a3d5081f3a89fa5708114893de2778d13b995dd118ecab7d30`；
- 隔离 SQLite 容器登录、侧栏入口和 `/image-workshop`：通过；
- `gpt-image-2` 文生图请求：`/v1/images/generations`，16:9 尺寸
  `1536x864`，通过；
- `gpt-image-2-4k` 参考图请求：`/v1/images/edits`，9:16 尺寸
  `2304x4096`，multipart 图片上传通过；
- base64 结果显示：通过；
- 浏览器控制台错误：0；
- 390px 窄屏：`scrollWidth=390`、`innerWidth=390`，无横向溢出；
- 测试结束后已删除隔离容器和隔离数据卷；
- 未部署、未重启或修改生产环境。

全仓 TypeScript 检查仍被基线已有问题阻断：使用日志模块缺少
`features/usage-logs/data/schema`，以及旧 `/console/deployment` 路由目标未登记。
新增图片创作文件在路由生成后不再产生 TypeScript 错误；完整 Rsbuild 生产构建成功。

## 8. 视频生成扩展（2026-07-14）

- 同一隔离测试版本新增 `/video-workshop`，仍未部署生产；
- 复用 NewAPI 原生 `POST /v1/videos`、`GET /v1/videos/:task_id` 与视频内容代理；
- 只读核对生产已启用视频模型后，使用 `MiniMax-Hailuo-2.3` 和
  `MiniMax-Hailuo-2.3-Fast`；
- 支持 6/10 秒、768P/1080P、文生视频、首帧图生视频、任务进度轮询、在线播放与下载；
- `MiniMax-Hailuo-2.3-Fast` 的上游约束为必须提供首帧参考图，界面已在提交前阻止
  不带参考图的 Fast 请求，并给出明确提示；
- 图片与视频辅助逻辑共 7 项测试通过，新增视频文件 ESLint 与完整前端构建通过；
- 修复视频任务查询链路：GET 查询不再进入新任务渠道分配，并显式使用
  `RelayModeVideoFetchByID`；无效查询模式会直接返回错误，不再触发空指针；
- 服务端隔离测试镜像：`mynewapi:image-video-workshop-test-20260714`；
- 隔离镜像 ID：
  `sha256:c7caab257e2a7a180919654645cde195e50d0eb3908a62d5b449aa5f60a9c21f`；
- 真实上游最小测试：`MiniMax-Hailuo-2.3`、6 秒、768P，任务成功到达
  `completed / 100%`；
- 使用同一受限测试令牌查询任务返回 HTTP 200，且结果包含可用视频 URL；
- 视频内容代理返回 HTTP 200、`video/mp4`，文件大小 1,640,206 字节；
- 测试使用独立 SQLite 数据卷；仅在隔离数据库中创建测试令牌和测试渠道副本，生产
  channel、模型映射、令牌和数据库均未修改；
- 正式生产容器未替换、未重启，本扩展仍只运行于服务器本机
  `127.0.0.1:13000`。
