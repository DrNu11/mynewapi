# NassaAPI Pricing Admin

一个独立的小控制台，用 NewAPI 已有的 root option API 管理模型价格和分组倍率。

## 功能

- 查看启用模型、已定价模型、未定价模型。
- 给模型添加倍率价格或固定价格。
- 删除某个模型在价格配置里的所有条目。
- 调整 `GroupRatio` 分组倍率。
- 每次写入前自动保存价格相关 option 快照。
- 从快照回滚价格配置。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3102` | 控制台监听端口 |
| `HOST` | `0.0.0.0` | 控制台监听地址 |
| `AUTH_USER` | `admin` | 控制台 Basic Auth 用户名 |
| `AUTH_PASS` | 空 | 控制台 Basic Auth 密码，必须设置 |
| `NEWAPI_BASE_URL` | `http://127.0.0.1:3000` | NewAPI 内网地址 |
| `NEWAPI_USER_ID` | `1` | root 用户 ID |
| `NEWAPI_ACCESS_TOKEN` | 空 | root 用户 access token |
| `DATA_DIR` | `./data` | 备份和审计日志目录 |
| `MYSQL_HOST` | 空 | MySQL 地址，用于真正下架模型 |
| `MYSQL_PORT` | `3306` | MySQL 端口 |
| `MYSQL_USER` | `root` | MySQL 用户 |
| `MYSQL_PASSWORD` | 空 | MySQL 密码 |
| `MYSQL_DATABASE` | `new-api` | NewAPI 数据库 |

## 写入的 NewAPI option

模型相关：

- `ModelRatio`
- `ModelPrice`
- `CompletionRatio`
- `CacheRatio`
- `CreateCacheRatio`
- `ImageRatio`
- `AudioRatio`
- `AudioCompletionRatio`
- `billing_setting.billing_mode`
- `billing_setting.billing_expr`

分组相关：

- `GroupRatio`
- `TopupGroupRatio`
- `GroupGroupRatio`

第一版的分组编辑默认只改 `GroupRatio`。模型删除会清理该模型在上述模型相关 option 里的配置项。

## 禁用模型

“禁用模型”不是只删除价格配置。它会：

- 从所有匹配渠道的 `channels.models` 中移除该模型。
- 清理该模型在 `abilities` 中的记录。
- 调用 NewAPI 的 `/api/channel/fix` 重建 abilities 和 channel cache。
- 同时清理该模型的价格配置。

执行前会保存价格 option 和受影响渠道的 `models/status` 快照，备份页可以回滚。
