# Nassa PPT 在线生成项目完整计划书

## 一、项目定位

项目名称建议：

```text
Nassa PPT
```

产品定位：

```text
基于 AI 的在线 PPT 生成工具，支持输入主题、文档、提纲或产品资料，自动生成可下载的 .pptx 文件。
```

与现有 nassa-cards 结合方式：

```text
使用同一套卡密 / API Key / 额度体系，为用户提供 PPT 生成次数。
```

不是单独做一个孤立网站，而是在现有 `card.nassaapi.xyz` 体系中增加：

```text
/ppt
```

作为新功能入口。

### 请求地址硬性规则

```text
请求地址必须锁死为：
https://card.nassaapi.xyz/
```

第一版不要让用户填写或修改请求地址。用户只需要填写 / 粘贴自己的 `sk-` API Key；如果从 result 页面进入 `/ppt`，API Key 可以自动带入。所有页面、发货文案、接口文档都统一使用这个固定请求地址。

---

## 二、为什么这个项目适合你现在做

你当前项目已有：

1. 卡密激活系统。
2. API Key 生成。
3. 套餐和额度限制。
4. 后台发卡。
5. result 页面。
6. 视频生成入口经验。
7. AI 模型调用能力。
8. NewAPI 多模型路由。
9. 文件生成 / 状态查询的后端经验。
10. 用户已经习惯“买卡密 -> 激活 -> 使用功能”。

PPT 生成刚好可以接到这套体系里：

```text
买 PPT 卡密
激活后获得 PPT 生成次数
进入 /ppt
填写主题
选择模板
生成 PPT
预览
下载 .pptx
```

这比单纯卖 API 更容易被普通用户理解。

---

## 三、商业模式设计

### 3.1 第一版商品

建议先做三个商品：

```text
PPT 体验卡
PPT 周卡
PPT 月卡
```

### 3.2 套餐建议

#### PPT 体验卡

```text
有效期：24 小时
生成次数：3 次
适合：试用
```

#### PPT 周卡

```text
有效期：7 天
生成次数：30 次
适合：学生、办公用户
```

#### PPT 月卡

```text
有效期：30 天
生成次数：150 次
适合：长期做汇报、方案、课程的人
```

### 3.3 计费方式

第一版不要按 token 计费，按“生成次数”计费。

```text
每成功生成 1 个 PPT = 消耗 1 次
生成失败不消耗
用户取消不消耗
任务超时不消耗
下载不重复消耗
预览不重复消耗
```

### 3.4 高级消耗规则，第二版再做

第二版可以细分：

```text
普通 PPT：1 次
复杂商务 PPT：2 次
长文档转 PPT：3 次
带图片生成：额外扣点
导出 PDF：免费或 0.2 次
```

第一版先不要复杂化。

---

## 四、和现有 nassa-cards 的结合方式

### 4.1 新增 category

新增：

```text
category = ppt
```

### 4.2 新增 plan

```text
plan = trial
plan = 7d
plan = 30d
```

### 4.3 新增卡密前缀

建议：

```text
PP-XXXX-XXXX-XXXX
```

### 4.4 result 页面展示

PPT 卡激活后，result 页面展示：

```text
Nassa PPT 已开通

功能：
AI 在线生成 PPT
支持下载 .pptx 文件
支持预览页面
支持选择模板

生成额度：
剩余 xx 次

入口：
https://card.nassaapi.xyz/ppt
```

### 4.5 现有 API Key 是否复用

建议复用现有 `sk-` API Key。

用户激活 PPT 卡后依然生成：

```text
sk-xxxx
```

但这个 API Key 主要用于：

```text
/ppt 页面鉴权
/api/ppt/* 接口鉴权
```

不一定开放给 `/v1` 调模型。

### 4.6 请求地址锁死规则

PPT 功能的请求地址是产品级固定值：

```text
https://card.nassaapi.xyz/
```

实现要求：

1. `/ppt` 页面只读展示固定请求地址，不提供可编辑输入框。
2. 用户侧只填写 API Key，或从 result 页面自动读取 API Key。
3. `/api/ppt/*` 后端接口不接受 `baseUrl`、`requestUrl`、`endpoint` 等自定义地址字段。
4. 即使客户端强行传入自定义请求地址，后端也必须忽略，只使用本站固定地址和内部配置。
5. 发货文案只告诉用户两件事：固定请求地址 + API Key。

---

## 五、核心用户流程

### 5.1 普通主题生成 PPT

用户输入：

```text
主题：介绍一家 AI API SaaS 平台
页数：10 页
风格：商务科技风
用途：融资路演
```

系统流程：

```text
1. 校验卡密 / API Key
2. 检查 PPT 生成次数
3. 生成 PPT 大纲
4. 生成每页内容 JSON
5. 匹配模板版式
6. 写入 edits.json
7. 调用 PPT worker 生成 .pptx
8. 用 LibreOffice 渲染 PDF
9. 用 Poppler 渲染预览图
10. 返回任务完成状态
11. 用户在线预览
12. 用户下载 .pptx
```

### 5.2 文档转 PPT

用户上传：

```text
.docx
.pdf
.txt
.md
```

系统流程：

```text
1. 提取文档文本
2. AI 总结结构
3. 生成 PPT 大纲
4. 生成 slides JSON
5. 生成 PPTX
```

第一版建议只支持：

```text
.txt
.md
.docx
```

PDF 解析容易出问题，第二版再做。

### 5.3 粘贴内容生成 PPT

用户直接粘贴一段文字：

```text
公司介绍、课程内容、产品文案、论文摘要
```

系统生成 PPT。

这是第一版最容易做好的一条路径。

---

## 六、MVP 功能范围

第一版必须做：

```text
/ppt 生成页面
/api/ppt/create 创建任务
/api/ppt/status 查询任务
/api/ppt/download 下载 PPTX
/api/ppt/preview 查看预览图
后台 PPT 卡密创建
PPT 额度扣减
PPT 任务记录
PPT 生成 worker
模板库
预览图生成
失败重试/错误展示
```

第一版不做：

```text
在线编辑 PPT
拖拽排版
多人协作
复杂动画
自动配图版权图库
PDF 精准解析
企业私有模板上传
PPT 在线播放
支付闭环
```

---

## 七、技术路线选择

### 7.1 推荐路线

第一版采用：

```text
Next.js 页面 + API 路由
SQLite 任务表
Python worker
python-pptx 生成 .pptx
LibreOffice headless 转 PDF
Poppler 转预览图
```

### 7.2 为什么不用纯前端生成

纯前端生成 PPT 虽然可以，但不好做：

```text
复杂模板
中文字体
预览图
批量任务
任务隔离
失败重试
```

你的项目是服务端 SaaS，更适合后端 worker。

### 7.3 为什么参考 GordenPPTSkill

GordenPPTSkill 的思路是：

```text
选择模板
生成 edits.json
用 python-pptx 非破坏式替换文本
保留模板原始布局
输出真实 .pptx
```

这个思路适合商业化。

但注意：

```text
不能直接商用它的内置模板
不能二次分发它的模板
不能把它原模板打包进你的商业服务
```

你只能参考技术思路，模板必须：

```text
自己做
购买授权
找设计师做
让用户上传企业模板
```

---

## 八、版权与模板策略

### 8.1 严禁直接商业使用第三方模板

不能直接把 GordenPPTSkill 的模板作为商业服务内置模板。

### 8.2 第一版模板来源

建议自己做 5 套基础模板：

```text
商务蓝
科技黑
简约白
教育培训
项目汇报
```

每套模板包含：

```text
封面页
目录页
章节页
图文页
三栏页
时间轴页
数据页
总结页
结尾页
```

### 8.3 模板结构

每个模板目录：

```text
templates/
  business-blue/
    template.pptx
    detail.json
    preview.png
    meta.json
```

### 8.4 meta.json

```json
{
  "id": "business-blue",
  "name": "商务蓝",
  "category": "business",
  "style": "稳重、商务、适合汇报",
  "slides": 10,
  "version": "1.0.0"
}
```

---

## 九、PPT 生成数据结构

### 9.1 用户请求

```json
{
  "title": "AI API SaaS 平台商业计划书",
  "scenario": "商业计划书",
  "audience": "投资人",
  "style": "商务科技风",
  "slideCount": 10,
  "language": "zh-CN",
  "inputText": "这里是用户输入内容",
  "templateId": "business-blue"
}
```

### 9.2 AI 生成大纲

```json
{
  "title": "AI API SaaS 平台商业计划书",
  "subtitle": "统一模型接入、计费与监控平台",
  "slides": [
    {
      "index": 1,
      "type": "cover",
      "title": "AI API SaaS 平台商业计划书",
      "subtitle": "统一模型接入、计费与监控平台"
    },
    {
      "index": 2,
      "type": "toc",
      "title": "目录",
      "items": ["市场机会", "产品方案", "商业模式", "增长计划"]
    }
  ]
}
```

### 9.3 edits.json

```json
{
  "templateId": "business-blue",
  "slides": [
    {
      "slideIndex": 0,
      "replacements": {
        "{{title}}": "AI API SaaS 平台商业计划书",
        "{{subtitle}}": "统一模型接入、计费与监控平台"
      }
    }
  ]
}
```

---

## 十、数据库设计

### 10.1 新增 ppt_tasks 表

```sql
CREATE TABLE IF NOT EXISTS ppt_tasks (
  id TEXT PRIMARY KEY,
  card_id INTEGER,
  api_key TEXT,
  status TEXT NOT NULL,
  title TEXT,
  scenario TEXT,
  template_id TEXT,
  slide_count INTEGER,
  input_text_preview TEXT,
  input_hash TEXT,
  output_pptx_path TEXT,
  output_pdf_path TEXT,
  preview_dir TEXT,
  error_message TEXT,
  quota_charged INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
```

### 10.2 status 枚举

```text
queued
planning
generating
rendering
success
failed
cancelled
```

### 10.3 新增 PPT 额度字段

如果 cards 表已有通用 quota 字段，优先复用。

如果没有，新增：

```sql
ALTER TABLE cards ADD COLUMN ppt_quota INTEGER DEFAULT NULL;
ALTER TABLE cards ADD COLUMN ppt_used INTEGER DEFAULT 0;
```

更推荐不直接在 cards 里累加 `ppt_used`，而是通过 `ppt_tasks` 中 `quota_charged=1` 统计已用次数。

第一版可以简单做：

```text
ppt_quota = 总生成次数
已用次数 = 成功任务数量
剩余次数 = ppt_quota - 成功任务数量
```

---

## 十一、后端接口设计

### 11.1 创建任务

```text
POST /api/ppt/create
```

请求：

```json
{
  "apiKey": "sk-xxx",
  "title": "AI API SaaS 平台商业计划书",
  "scenario": "商业计划书",
  "style": "商务科技风",
  "slideCount": 10,
  "templateId": "business-blue",
  "inputText": "用户输入内容"
}
```

请求体里不允许出现自定义请求地址。后端固定使用 `https://card.nassaapi.xyz/`，只校验 `apiKey` 和 PPT 生成参数。

返回：

```json
{
  "ok": true,
  "taskId": "ppt_abc123",
  "status": "queued"
}
```

### 11.2 查询任务

```text
GET /api/ppt/status?taskId=ppt_abc123
```

返回：

```json
{
  "taskId": "ppt_abc123",
  "status": "success",
  "progress": 100,
  "downloadUrl": "/api/ppt/download?taskId=ppt_abc123",
  "previews": [
    "/api/ppt/preview?taskId=ppt_abc123&page=1"
  ]
}
```

### 11.3 下载 PPTX

```text
GET /api/ppt/download?taskId=ppt_abc123
```

要求：

```text
只允许任务所属用户下载
不允许任意路径读取
Content-Type 使用 PPTX MIME
```

### 11.4 预览图片

```text
GET /api/ppt/preview?taskId=ppt_abc123&page=1
```

返回 PNG/JPEG。

### 11.5 查询额度

```text
GET /api/ppt/quota?apiKey=sk-xxx
```

返回：

```json
{
  "quota": 30,
  "used": 5,
  "remaining": 25
}
```

---

## 十二、页面设计

### 12.1 首页入口

在现有首页或 result 页面增加：

```text
AI PPT 生成
```

按钮：

```text
立即生成 PPT
```

跳转：

```text
/ppt
```

### 12.2 /ppt 页面

模块：

1. 固定请求地址展示：`https://card.nassaapi.xyz/`，只读，不可修改。
2. API Key 输入或自动从 result 带入。
3. 主题输入。
4. 场景选择。
5. 页数选择。
6. 模板选择。
7. 风格选择。
8. 生成按钮。
9. 任务进度。
10. 预览区。
11. 下载按钮。

### 12.3 场景选择

```text
商业计划书
课程课件
项目汇报
产品介绍
论文答辩
工作总结
营销方案
培训材料
```

### 12.4 页数限制

第一版限制：

```text
5 - 15 页
```

默认：

```text
10 页
```

防止用户一开始生成 50 页拖垮服务器。

### 12.5 输入限制

```text
标题最多 80 字
输入内容最多 20000 字
上传文件最大 5MB
```

---

## 十三、PPT Worker 设计

### 13.1 Worker 路径

新增：

```text
scripts/ppt_worker.py
scripts/build_pptx.py
scripts/render_ppt_preview.py
```

或者统一：

```text
scripts/ppt_worker.py
```

### 13.2 Worker 输入

```json
{
  "taskId": "ppt_abc123",
  "templatePath": "templates/business-blue/template.pptx",
  "detailPath": "templates/business-blue/detail.json",
  "editsPath": "data/ppt/tasks/ppt_abc123/edits.json",
  "outputPptx": "data/ppt/tasks/ppt_abc123/final.pptx",
  "outputPdf": "data/ppt/tasks/ppt_abc123/final.pdf",
  "previewDir": "data/ppt/tasks/ppt_abc123/preview"
}
```

### 13.3 Worker 输出

```json
{
  "ok": true,
  "pptx": "data/ppt/tasks/ppt_abc123/final.pptx",
  "pdf": "data/ppt/tasks/ppt_abc123/final.pdf",
  "previews": [
    "data/ppt/tasks/ppt_abc123/preview/page-1.png"
  ]
}
```

### 13.4 执行方式

Next.js API 创建任务后，不要在请求里长时间阻塞生成。

第一版可以简单用：

```text
后台 child_process 启动 worker
```

更稳的方式：

```text
任务入库
worker loop 定时扫描 queued
```

推荐第一版：

```text
单独 npm script 启动 worker
```

例如：

```json
{
  "scripts": {
    "ppt-worker": "tsx scripts/ppt-worker.ts"
  }
}
```

或者 Python：

```bash
python3 scripts/ppt_worker.py
```

---

## 十四、AI 生成流程

### 14.1 第一步：生成结构化大纲

模型输入：

```text
你是专业 PPT 策划师，请根据用户主题生成 10 页 PPT 大纲，输出严格 JSON。
```

输出必须是 JSON，不允许自然语言混入。

### 14.2 第二步：生成每页文案

针对每页生成：

```text
title
subtitle
bullets
chart_data
speaker_notes
```

### 14.3 第三步：模板映射

把页面类型映射到模板 layout：

```text
cover -> cover layout
toc -> toc layout
section -> section layout
content -> text layout
comparison -> table layout
timeline -> timeline layout
summary -> summary layout
```

### 14.4 第四步：生成 edits.json

只替换占位符，不破坏模板布局。

### 14.5 第五步：生成 pptx

使用 python-pptx 写入。

### 14.6 第六步：渲染预览

使用 LibreOffice headless 转 PDF，再用 Poppler 转图片。

---

## 十五、模型选择

第一版建议使用：

```text
deepseek-v4-pro
glm-5.2
gpt-5.5-high
```

优先级：

```text
1. deepseek-v4-pro：便宜，适合结构化内容生成
2. glm-5.2：适合智能体/长文本/工程类内容
3. gpt 系列：用于高质量商业文案
```

用户不需要选择模型，系统内部根据套餐决定。

### 15.1 内部 prompt 生成要求

必须要求模型输出：

```text
严格 JSON
不允许 Markdown
不允许解释
不允许代码块
```

### 15.2 JSON 修复

模型输出 JSON 失败时：

```text
自动尝试修复一次
仍失败则任务 failed
不扣除额度
```

---

## 十六、额度扣减规则

### 16.1 什么时候扣额度

仅当任务达到：

```text
success
```

并生成可下载 `.pptx` 时，扣除 1 次。

### 16.2 什么时候不扣

```text
AI JSON 失败
PPTX 生成失败
预览生成失败但 PPTX 成功
用户取消
任务超时
服务器错误
```

如果 PPTX 成功但预览失败：

```text
可以扣额度
但页面提示预览暂不可用，可下载 PPTX
```

### 16.3 防重复扣费

`ppt_tasks.quota_charged` 必须防重复。

```sql
quota_charged INTEGER DEFAULT 0
```

只有从非 success 到 success 第一次时扣。

---

## 十七、安全设计

### 17.1 文件安全

禁止：

```text
用户控制输出路径
用户读取任意文件
用户上传可执行文件
用户上传超大文件
```

所有任务文件必须放在：

```text
data/ppt/tasks/<taskId>/
```

### 17.2 路径安全

taskId 必须生成，不接受用户传任意路径。

只允许格式：

```regex
^ppt_[a-zA-Z0-9_-]+$
```

### 17.3 上传限制

第一版支持：

```text
.txt
.md
.docx
```

最大：

```text
5MB
```

不支持：

```text
.exe
.js
.py
.zip
.html
.svg
```

### 17.4 隐私

不要把用户上传内容写入公开日志。

数据库只存：

```text
input_text_preview
input_hash
```

完整输入可以存在任务目录，定期清理。

### 17.5 清理任务

定时清理：

```text
7 天前任务文件
失败任务临时文件
超过 100MB 的异常目录
```

---

## 十八、模板版权规则

严禁直接商用第三方未授权模板。

如果参考 GordenPPTSkill：

```text
只参考工作流
不复制内置模板
不打包它的 templates/
不二次分发它的模板
```

商业版本必须使用：

```text
自制模板
购买授权模板
用户自有模板
设计师定制模板
```

---

## 十九、后台管理

新增后台页面：

```text
/admin/ppt
```

展示：

```text
任务总数
成功任务
失败任务
今日生成次数
用户消耗排行
最近失败原因
模板使用排行
```

### 19.1 任务列表字段

```text
taskId
card code
status
title
template
slideCount
createdAt
finishedAt
errorMessage
download
```

### 19.2 后台操作

第一版支持：

```text
查看任务
下载 PPTX
删除任务文件
重试 failed 任务
```

不要第一版做复杂编辑。

---

## 二十、result 页面结合

PPT 卡激活后 result 页面必须显示：

```text
AI PPT 生成已开通
剩余生成次数：xx
入口：/ppt
```

如果是其它卡，比如 DeepSeek / GPT / Claude，也可以展示一个轻量入口：

```text
图生视频工作台
AI PPT 生成
```

但如果当前卡没有 PPT 权益，点击后提示：

```text
当前卡密暂未包含 PPT 生成次数，请购买 PPT 套餐。
```

---

## 二十一、发货文案

PPT 体验卡：

```text
卡密：PP-XXXX-XXXX-XXXX

激活地址：
https://card.nassaapi.xyz

激活后会自动生成 sk- 开头的 API Key。

请求地址：
https://card.nassaapi.xyz/

PPT 生成入口：
https://card.nassaapi.xyz/ppt

套餐说明：
AI PPT 体验卡，24 小时有效。
可生成 3 份 PPT。
支持输入主题、粘贴内容、选择模板后自动生成 .pptx 文件。

请先进入激活地址输入卡密，激活成功后复制生成的 API Key 使用即可。
```

PPT 周卡：

```text
AI PPT 周卡，7 天有效。
可生成 30 份 PPT。
```

PPT 月卡：

```text
AI PPT 月卡，30 天有效。
可生成 150 份 PPT。
```

---

## 二十二、商品页文案

商品标题：

```text
AI PPT 生成卡｜在线生成PPT｜支持下载PPTX｜适合汇报课件方案
```

商品详情：

```text
AI PPT 在线生成工具，支持输入主题、粘贴文档内容、选择模板后自动生成可下载的 .pptx 文件。

适合场景：
工作汇报
商业计划书
课程课件
论文答辩
产品介绍
营销方案
培训材料

使用方式：
购买后获得卡密，进入激活地址激活，系统自动生成 API Key。
进入 PPT 生成页面，输入主题或内容，选择模板，即可生成 PPT。

注意：
生成效果和输入内容质量有关。复杂排版、特殊行业模板可能需要人工微调。
```

---

## 二十三、项目目录建议

新增：

```text
app/ppt/page.tsx
app/api/ppt/create/route.ts
app/api/ppt/status/route.ts
app/api/ppt/download/route.ts
app/api/ppt/preview/route.ts
app/api/ppt/quota/route.ts
app/admin/ppt/page.tsx

lib/ppt/types.ts
lib/ppt/quota.ts
lib/ppt/tasks.ts
lib/ppt/prompt.ts
lib/ppt/templates.ts
lib/ppt/worker-client.ts

scripts/ppt_worker.py
scripts/build_pptx.py
scripts/render_ppt_preview.py

templates/ppt/business-blue/
templates/ppt/tech-dark/
templates/ppt/simple-white/
templates/ppt/education/
templates/ppt/product-intro/

data/ppt/tasks/
```

如果当前项目不适合这些目录，按实际结构调整。

---

## 二十四、测试计划

### 24.1 单元测试

新增：

```text
lib/ppt/quota.test.ts
lib/ppt/templates.test.ts
lib/ppt/tasks.test.ts
```

覆盖：

```text
PPT 额度计算
成功任务扣额度
失败任务不扣额度
重复 success 不重复扣
taskId 路径校验
模板 ID 校验
下载权限校验
```

### 24.2 集成测试

覆盖：

```text
创建任务
查询任务
任务失败
任务成功
下载权限
预览权限
```

### 24.3 Worker 测试

准备一个测试模板和 edits.json。

测试：

```bash
python3 scripts/build_pptx.py templates/ppt/simple-white/template.pptx test-edits.json out/test.pptx
```

---

## 二十五、部署要求

生产服务器需要安装：

```text
python3
python-pptx
LibreOffice
Poppler
中文字体
```

建议字体：

```text
Noto Sans CJK
WenQuanYi Micro Hei
Source Han Sans
```

部署前检查：

```bash
python3 -c "import pptx; print(pptx.__version__)"
soffice --version
which pdftoppm
fc-list | grep -i "Noto Sans CJK" | head
```

---

## 二十六、分阶段实施

### Phase 0：只读分析

检查当前 nassa-cards 架构、卡密系统、文件生成目录、服务器依赖。

### Phase 1：PPT 卡密与额度

新增 `category=ppt`，支持创建 PPT 卡，显示剩余额度。

### Phase 2：PPT 任务系统

新增 `ppt_tasks` 表和 API。

### Phase 3：PPT 生成 worker

实现模板填充、PPTX 输出、预览图生成。

### Phase 4：/ppt 页面

实现前端生成页面、任务进度、预览、下载。

### Phase 5：后台管理

实现 `/admin/ppt` 和任务列表。

### Phase 6：商品化文案和 result 入口

补齐 result、发货文案、商品文案。

### Phase 7：上线测试

本地测试、服务器依赖检查、生产灰度。

---

## 二十七、第一版验收标准

1. 后台可以创建 PPT 卡。
2. 用户激活 PPT 卡后看到 PPT 入口。
3. 用户可进入 `/ppt`。
4. 用户输入主题可以创建任务。
5. 任务可生成 `.pptx`。
6. 可以下载 `.pptx`。
7. 可以查看预览图。
8. 成功任务扣 1 次。
9. 失败任务不扣次数。
10. 非本人任务不能下载。
11. 模板不丢布局。
12. 中文字体显示正常。
13. `npm test` 通过。
14. `npm run build` 通过。
15. worker 在服务器可运行。
16. 不泄露用户输入内容。
17. 不使用未授权商业模板。

---

## 二十八、明确禁止

不要直接商用 GordenPPTSkill 内置模板。
不要复制它的 templates 目录上线。
不要把未授权模板打包进商业服务。
不要让用户传任意路径。
不要执行用户上传的代码。
不要输出 API Key。
不要输出 sk_key。
不要输出 .env。
不要让 PPT 生成任务阻塞 API 请求太久。
不要在失败任务扣额度。
不要把 PPT 功能影响现有 DeepSeek / GPT / Claude / GLM 卡。
不要部署前跳过 worker 依赖检查。

---

## 二十九、给 Codex 的执行要求

开始前输出：

```text
当前工作目录
当前 Git 分支
git status --short
Node.js 版本
npm 版本
Python 版本
是否安装 LibreOffice
是否安装 pdftoppm
即将修改/新增文件清单
```

如果工作区有无关脏文件，必须先隔离任务，只允许触碰本任务文件。

完成每阶段后输出：

```text
1. 本阶段目标
2. 修改文件
3. 新增文件
4. 数据库变化
5. 是否影响现有卡密/API功能
```
