---
name: newapi-error-report
description: 当用户发送“报错”时，只读查询 NewAPI 最近 60 分钟错误日志，返回脱敏报错报告，并识别疑似恶意并发/刷请求
---

# newapi-error-report

当且仅当用户消息**完全等于** `报错` 时，执行固定只读命令：

```bash
cd /opt/nassa-cards && bash scripts/newapi-error-report.sh --minutes 60
```

## 严格规则

1. 只有用户消息完全等于 `报错` 时才执行。
2. 只允许执行：

   ```bash
   cd /opt/nassa-cards && bash scripts/newapi-error-report.sh --minutes 60
   ```

3. 不允许执行其他命令。
4. 不允许修改 NewAPI。
5. 不允许修改渠道。
6. 不允许禁用/启用渠道。
7. 不允许重启服务。
8. 不允许部署。
9. 不允许输出密钥。
10. 如果消息不是 `报错`，回复：

    ```
    格式不匹配，未执行任何操作。
    ```

11. 如果脚本输出为空，回复：

    ```
    最近 60 分钟未发现明显 NewAPI 报错。
    ```

## 报告目标

脚本返回的报告应优先覆盖：

- 最近 60 分钟错误总览
- 错误渠道排行
- HTTP 状态码排行
- 模型分布（能提取则展示）
- 高频来源（优先卡密+用户名，其次 userId+用户名）/ 高频接口
- 超长请求摘要
- 疑似恶意并发 / 刷请求来源（优先卡密+用户名，其次 userId+用户名）
- 最近 30 条关键错误摘要
- 初步建议

## 执行边界

- 只读：仅允许读取 Docker 日志和容器状态等只读信息。
- 不得输出完整 prompt、完整请求体、完整响应体、完整密钥。
- 应对密钥、Authorization、cookie、password、secret 等敏感字段做脱敏。
- 报告中的异常来源优先显示 `token_name（username）`；若无卡密则退回显示 `userId=xxx（username）`；确实都拿不到时才显示 IP。
- 为了保留卡密映射，脚本允许在本地内存中读取未脱敏原始日志中的 `token_name`，但对外输出时仍必须继续脱敏敏感字段，且不得输出完整请求体、响应体、密钥或其他敏感认证信息。
- 允许脚本只读查询 NewAPI MySQL 的 `users` 表，用于 `userId -> username` 映射；不得修改数据库。
- 如果未找到目标容器，直接返回脚本输出，不做额外操作。
