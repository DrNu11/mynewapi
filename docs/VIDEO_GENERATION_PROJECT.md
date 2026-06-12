# NassaAPI 在线图生视频项目文档

## 目标

在现有卡密激活站 `nassa-cards` 内新增一个在线图生视频页面，让已激活用户用自己的 NassaAPI `sk-...` 进入页面，上传首帧图或填写图片 URL，输入提示词后调用 MiniMax 图生视频接口生成视频。

首版做本地可运行 MVP，先覆盖完整链路：

- 浏览器页面：`/video`
- 服务端创建任务：`POST /api/video/create`
- 服务端查询任务：`POST /api/video/status`
- MiniMax 调用：`/v1/video_generation`、`/v1/query/video_generation`、`/v1/files/retrieve`
- 本地 SQLite 记录任务归属和状态，避免用户查询不属于自己的任务

## 接入方式

用户侧继续使用现有卡密体系，不直接接触 MiniMax API Key。

1. 用户先在首页激活卡密，拿到 `sk-...`
2. 用户进入 `/video`
3. 页面把 `sk-...`、首帧图、提示词、模型参数提交给本项目后端
4. 后端用 `getCardByTokenKey` 校验 `sk-...` 是否属于有效卡密
5. 后端使用环境变量 `MINIMAX_API_KEY` 调 MiniMax 创建视频任务
6. 页面轮询 `/api/video/status`，任务成功后展示下载地址和视频预览

## MiniMax API 摘要

图生视频创建任务：

```http
POST https://api.minimaxi.com/v1/video_generation
Authorization: Bearer <MINIMAX_API_KEY>
Content-Type: application/json
```

请求体首版使用：

```json
{
  "model": "MiniMax-Hailuo-2.3",
  "prompt": "A mouse runs toward the camera...",
  "first_frame_image": "https://example.com/image.jpg",
  "duration": 6,
  "resolution": "1080P"
}
```

任务查询：

```http
GET https://api.minimaxi.com/v1/query/video_generation?task_id=<task_id>
Authorization: Bearer <MINIMAX_API_KEY>
```

任务成功后会返回 `file_id`，再换取下载地址：

```http
GET https://api.minimaxi.com/v1/files/retrieve?file_id=<file_id>
Authorization: Bearer <MINIMAX_API_KEY>
```

## 环境变量

在 `.env.local` 添加：

```bash
MINIMAX_API_KEY=
MINIMAX_API_BASE=https://api.minimaxi.com
```

`MINIMAX_API_BASE` 可选，默认使用 `https://api.minimaxi.com`。

## 数据表

新增 `video_tasks` 表：

| 字段 | 说明 |
| --- | --- |
| `id` | 本地自增 ID |
| `task_id` | MiniMax 任务 ID |
| `card_id` | 归属卡密 ID |
| `sk_key` | 用户提交的 NassaAPI key |
| `model` | MiniMax 模型 |
| `prompt` | 提示词 |
| `duration` | 视频时长 |
| `resolution` | 分辨率 |
| `status` | 本地状态 |
| `file_id` | MiniMax 文件 ID |
| `download_url` | 最终下载地址 |
| `error_message` | 失败原因 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

## 页面设计

`/video` 是工作台页面，不做营销落地页。

主要区域：

- API Key 输入框：支持从 `localStorage.nc_cache` 自动读取
- 首帧图片：支持图片 URL 或本地文件转 Data URL
- 提示词输入：必填
- 参数：模型、时长、分辨率
- 任务状态：等待、处理中、成功、失败
- 结果：视频预览和下载按钮

## 首版边界

- 首版不做计费扣减，只用卡密有效性鉴权。
- 首版不做任务列表，只展示当前会话创建的任务。
- 首版不把 MiniMax API Key 下发到浏览器。
- 首版不处理大量并发队列，生成能力受 MiniMax 控制台限额影响。

后续可以扩展：

- 每张卡视频生成次数限制
- 管理后台视频任务列表
- Webhook 或后台队列替代浏览器轮询
- 支持尾帧图、文生视频、主体参考生视频等更多 MiniMax 视频能力
