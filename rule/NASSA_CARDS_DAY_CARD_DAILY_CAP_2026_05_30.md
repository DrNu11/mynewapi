# nassa-cards:日卡每日 250 美元保护

日期:2026-05-30

## 背景

发现 GPT 日卡/续费日卡存在“无限额度 token 只靠到期时间约束”的套利风险。客户如果开并发,可以在 24 小时有效期内把 NewAPI root 池额度快速打穿。已有真实样本显示单 token 历史单日使用超过 250 美元。

## 规则

- 适用对象:`cards.plan = '1d'` 且已绑定 `newapi_token_id` 的卡密。
- 统计口径:NewAPI MySQL `logs` 表中该 `token_id` 从北京时间当天 00:00 起的正向 `quota` 总和。
- 换算:NewAPI `500000 quota = 1 USD`。
- 阈值:今日用量 `>= $250` 时直接返回 429。
- 提示文案:

```text
日卡今日使用额度已达 $250 上限,为防止异常并发爆刷已暂停请求,明天 00:00 后自动恢复。当前统计: $xxx.xx
```

## 代码位置

- `nassa-cards/lib/newapi-db.ts`
  - 新增 `NEWAPI_QUOTA_PER_USD = 500000`
  - 新增 `getTokenUsageQuotaSince(tokenId, sinceTs)`,从 NewAPI `logs` 汇总真实消耗。
- `nassa-cards/app/v1/[...path]/route.ts`
  - 在模型白名单之后、RPH 预占之前执行日卡保护。
  - 超额时不写 `request_logs`,不调用上游,因此不占 RPH,也不会产生新成本。
  - 如果额度校验 SQL 失败,对日卡 fail-closed 返回 503,避免 MySQL 异常时被绕过。

## 生产验证

207 主机已完成端到端测试:

1. 插入临时测试卡 `plan=1d/category=gpt/status=activated`,绑定临时 fake sk 和 fake token_id。
2. 在 NewAPI `logs` 插入同 token 今日 `$252` 的测试日志。
3. 请求 `POST http://127.0.0.1:3100/v1/chat/completions`。
4. 返回 `HTTP 429`,body 为日卡 250 美元上限提示。
5. `request_logs=0`,证明未进入 RPH 预占和上游。
6. 再插入今日 `$249` 的测试日志,请求不被日卡保护拦截,进入上游后因 fake sk 返回 `HTTP 401 Invalid token`,且 `request_logs=1`。
7. 测试卡、测试 `request_logs`、测试 NewAPI `logs` 已清理,残留计数均为 0。

## 部署注意

- `/opt/nassa-cards/data` 当前很大,不要在部署脚本里完整压缩备份 `data/`,会拖住生产部署。
- 推荐部署动作:本地 build/tar,远端仅临时 `mv data/.env.local` 到 `/tmp`,替换代码目录后移回,再 `npm install --omit=dev` 和 `pm2 restart nassa-cards --update-env`。
- 上传到 207 时优先使用 `ssh -F /dev/null 'cat > /tmp/nassa-cards-deploy.tar.gz' < tarball`,避开本机 SSH 配置导致的 scp/ssh 卡顿。
