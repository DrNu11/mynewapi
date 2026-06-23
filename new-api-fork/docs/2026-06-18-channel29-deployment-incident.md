# 2026-06-18 渠道 29 DeepSeek 伪装 GPT 部署事故文档

## 当前状态

- 事故状态：已缓解，生产已回滚。
- 当前生产容器：`newapi-prod-new-api-1`。
- 当前生产镜像 ID：`sha256:4b3c360e13f50fd851fcf5be80b8ede9d73920f4ffaaf9be9096a93f8cfb7e02`。
- 当前生产镜像已新增不可变基线标签：`nassa11111/new-api-hide-model:immutable-prod-baseline-20260618-162706`。
- 当前生产 `/new-api` binary sha256：`9a300e23d1c8ad091918b32d151b3abe35481b5817472a08259916386056f7aa`。
- 当前生产健康检查：`/api/status` 返回 HTTP 200。
- 当前渠道 29：已恢复到改动前配置。
- 后续禁止直接碰生产；必须先 staging 验证，再等明确确认。

## 一句话结论

这次事故不是因为“渠道 29 DeepSeek 伪装 GPT”这个目标本身不可行，而是因为我没有先证明生产镜像和源码分支的一致性，就把错误的源码分支当成生产基线去构建和部署，导致前端和已有生产定制被覆盖。

## 背景目标

原始目标是让 NewAPI 渠道 29 把 GPT 外显模型名路由到 DeepSeek，例如：

- `gpt-5.5` -> `deepseek-v4-pro`
- `gpt-5.4` -> `deepseek-v4-pro`

同时要兼容 Codex 可能调用的接口：

- `/v1/models`
- `/v1/chat/completions`
- `/v1/responses`
- 非流式返回
- 流式 SSE 返回
- tools / reasoning / Responses API 参数兼容

## 影响

- 生产首页一度不再是用户预期的 Apple 风格 NassaAPI 前端。
- 原生产镜像里已有的 MiniMax 伪装、前端改造和其他定制行为存在被覆盖风险。
- 用户看到的线上页面和原本产品状态不一致，造成实际生产回归。
- API 层的 DeepSeek 单点 smoke test 不能代表整站无回归，这个判断标准是错误的。

## 时间线

1. 先做了只读排查，确认 Codex 兼容重点在模型映射、`/v1/responses`、流式 SSE、渠道 29 权限和模型名伪装。
2. 创建了服务器源码备份分支：`backup/pre-channel29-deepseek-deploy-20260618-152147`，commit 为 `9dfbb5fc`。
3. 创建了计划文档分支：`codex/channel29-deepseek-gpt-verification-plan-20260618-202903`。
4. 后续实现了 DeepSeek Responses bridge 和模型名遮蔽逻辑，并做了 API smoke test。
5. 第一次错误：在未证明当前生产镜像来源的情况下，把实现镜像切到生产。
6. 用户要求回滚并给出计划分支链接。
7. 第二次错误：我把计划/验证分支误当作可回滚的生产镜像基线，构建并部署了错误分支。
8. 用户发现前端和已有生产定制丢失，要求立即回滚。
9. 最终恢复：把生产镜像回滚到原始镜像 ID `4b3c360e...`，并恢复渠道 29 数据库配置。
10. 当前已新增不可变生产基线标签，防止后续再拿错版本。

## 根因

根因是生产基线确认失败。

我没有先回答清楚这个问题：

> 当前线上正在跑的 Docker 镜像，究竟对应哪一个源码 commit？

在这个问题没有答案之前，任何从 Git 分支重新 build 的镜像都不能被视为生产等价物。尤其这个项目的生产镜像是单二进制形态，前端被编译或嵌入到 `/new-api` binary 里，无法通过容器内静态目录直接确认前端文件。

因此，正确基线应该先以“当前正在运行且用户确认正常的镜像”为准，而不是以某个 GitHub 分支名为准。

## 我犯的具体错误

1. 把 API smoke test 当成生产验收，忽略了前端和其他 provider 伪装也是生产合同的一部分。
2. 把计划分支、实现分支、生产镜像三者混为一谈。
3. 没有在部署前创建独立 staging 容器验证。
4. 没有先做首页截图和功能回归检查。
5. 没有先证明源码和生产镜像的对应关系。
6. 在用户说“回滚这个分支”时，没有澄清“回滚镜像还是回滚代码分支”，直接做了错误动作。
7. 复用生产 tag 增加了状态混乱。

## 当前已确认的事实

- 生产镜像历史显示最终产物是 `COPY /build/new-api /`，运行时只有 `/new-api` binary。
- 当前生产 binary sha256 是 `9a300e23d1c8ad091918b32d151b3abe35481b5817472a08259916386056f7aa`。
- `/root/new-api-temp` 当前分支是 `codex/channel29-deepseek-on-prod-base`，已经包含 DeepSeek 改动，不是干净生产基线。
- `/root/new-api-temp` 的备份分支 `backup/pre-channel29-deepseek-deploy-20260618-152147` 指向 commit `9dfbb5fc`，提交信息是 `fix: filter MiniMax XML tags from streaming responses`。
- 当前 DeepSeek 实现分支相对备份分支的主要 diff 只应限制在：
  - `relay/channel/deepseek/adaptor.go`
  - `relay/channel/deepseek/responses_bridge.go`
  - `relay/channel/deepseek/responses_bridge_test.go`
  - `relay/compatible_handler.go`
  - 文档文件

## 恢复动作

1. 生产容器已恢复到原始镜像：
   - `nassa11111/new-api-hide-model:rollback-before-channel29-deepseek-20260618-152402`
   - `sha256:4b3c360e13f50fd851fcf5be80b8ede9d73920f4ffaaf9be9096a93f8cfb7e02`
2. 生产镜像已补充不可变基线标签：
   - `nassa11111/new-api-hide-model:immutable-prod-baseline-20260618-162706`
3. 渠道 29 已恢复到改动前：
   - `type=1`
   - `status=1`
   - `priority=10`
   - `base_url=https://api.deepseek.com`
   - group 恢复为原 `测试` 组
4. 生产健康检查通过。

## 正确回滚原则

这个项目的紧急回滚必须优先按镜像回滚，而不是按分支回滚。

正确顺序：

1. 找到最后一个已知正常的生产镜像 ID。
2. 给它打不可变备份标签。
3. 用该镜像恢复生产容器。
4. 恢复被改过的数据库渠道配置。
5. 验证健康检查、首页、已有 provider 伪装、核心 API。
6. 服务恢复后再讨论源码分支。

错误做法：

1. 看到一个 GitHub 分支就认为它能代表生产。
2. 从未验证的分支 build 镜像。
3. 用 API 单点测试代替整站验收。
4. 在生产 tag 上反复覆盖。

## 后续修复计划

后续要继续做渠道 29 DeepSeek 伪装 GPT，必须按下面顺序执行：

1. 冻结生产，不再直接部署。
2. 以当前不可变镜像 `immutable-prod-baseline-20260618-162706` 作为运行时事实基线。
3. 尝试证明 `backup/pre-channel29-deepseek-deploy-20260618-152147` 是否能复现当前生产 binary。证明不了就不能把它当成完整生产基线。
4. 只把 DeepSeek 相关最小 diff 重新应用到正确基线。
5. 构建唯一 staging tag，不能覆盖生产 tag。
6. 在独立 staging 容器跑验证。
7. 验证首页和 Apple 风格前端。
8. 验证 MiniMax 相关已有伪装行为。
9. 验证渠道 29 的 `gpt-5.5`、`gpt-5.4` 到 `deepseek-v4-pro` 映射。
10. 验证 `/v1/chat/completions` 非流式和流式。
11. 验证 `/v1/responses` 非流式和流式。
12. 验证返回体不泄漏 `deepseek-v4-pro`，对外仍显示 GPT 模型名。
13. 出具验证报告。
14. 用户明确确认后，才允许生产切换。

## 上线前强制检查清单

- 当前生产镜像 ID 已记录。
- 当前生产镜像有不可变备份 tag。
- 渠道 29 数据库配置已做无密钥快照。
- 候选镜像 tag 唯一。
- 候选镜像没有覆盖生产 tag。
- staging 首页截图正常。
- staging API smoke test 正常。
- staging SSE 流式有 `data:` 和结束事件。
- Codex 目标模型名能返回。
- DeepSeek 上游模型名不会外泄。
- MiniMax 已有伪装未回归。
- 回滚命令已准备。
- 用户已明确同意生产切换。

## 安全要求

- 不打印完整 API Key。
- 不打印 GitHub token。
- 不打印渠道上游密钥。
- 不打印 `.env`。
- 所有日志和文档只能记录非敏感摘要。
- 已出现在聊天里的密钥和 token 都应视为已暴露，建议轮换。

## 责任说明

这次事故由我的部署判断错误造成。后续我必须先保护用户现有生产状态，再做最小增量修改。任何不能证明来源的分支，都不能再被当成生产基线。
