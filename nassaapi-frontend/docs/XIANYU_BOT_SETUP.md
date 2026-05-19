# 闲鱼机器人 × NassaAPI 发码集成指南

让 xianyu-auto-reply 机器人在买家付款后自动调用本站发码。

## 架构

```text
闲鱼买家付款
    ↓
xianyu-auto-reply 容器 (http://localhost:9000)
    ↓ POST JSON + X-Bot-Secret header
nassaapi-frontend (http://localhost:3000)
  /api/bot/redeem
    ↓ 调 New API 创建兑换码 + 写 SQLite
api.nassaapi.xyz
    ↓ 返回 {"content": "<兑换链接 + 使用说明>"}
机器人把 content 作为消息发给买家
```

## 网络：容器内怎么调 Mac 本机的服务

因为 nassaapi-frontend 跑在你 **Mac 本机**（不在 Docker 里），
而 xianyu 机器人跑在 **Docker 容器**里，
所以机器人访问 `localhost:3000` 会找到容器自己，**不是你的 Mac**。

Docker Desktop 已经帮我们预留了一个域名：

**`host.docker.internal`** — 在容器内指向你的 Mac 主机。

所以机器人填的 API URL 必须是：

```text
http://host.docker.internal:3000/api/bot/redeem
```

**不是** `http://localhost:3000/api/bot/redeem`。

（未来如果 nassaapi-frontend 部署到 VPS，就改成公网 URL：
`https://nassaapi.xyz/api/bot/redeem`）

---

## 配置步骤（登录机器人后台后做）

### 1. 打开机器人后台

浏览器访问：`http://localhost:9000`

首次登录：
- 用户名：`admin`
- 密码：`admin123`

**立即去「个人设置」改密码！**

### 2. 添加闲鱼账号

- 菜单：**账号管理 → 添加账号**
- 方式：**Cookie 登录**（推荐）或扫码
- 获取 Cookie 方法：Chrome 打开 goofish.com 登录 → F12 → Network → 刷新 → 找任意请求 → 复制 Cookie 字段整串

### 3. 配置「API 发货」规则

- 菜单：**卡券管理 → 新建卡券**（或者"发货规则"，UI 叫法可能不同）
- **卡券类型**：选 `API` / `接口类型`
- **API 配置**（JSON）：

```json
{
  "url": "http://host.docker.internal:3000/api/bot/redeem",
  "method": "POST",
  "timeout": 15,
  "headers": {
    "Content-Type": "application/json",
    "X-Bot-Secret": "填你 .env.local 里的 BOT_SHARED_SECRET"
  },
  "params": {
    "amount_usd": 0.7,
    "order_id": "{order_id}",
    "item_id": "{item_id}",
    "buyer_id": "{buyer_id}",
    "spec_name": "{spec_name}",
    "spec_value": "{spec_value}",
    "platform": "xianyu"
  }
}
```

关键点：

- **`amount_usd`**：这个商品对应多少美元额度。如果你按闲鱼 ¥5 卖 → 填 `0.7` 美元左右（¥5 × 7% 汇率系数，给客户优惠 10 倍于 $0.5 进价）
- **`{order_id}`、`{item_id}` 等**是闲鱼机器人的**动态占位符**，它会在发货时自动替换成真实值
- **`X-Bot-Secret`**：从 `/Users/w/Desktop/newapi/nassaapi-frontend/.env.local` 里复制 `BOT_SHARED_SECRET=` 那一长串

### 4. 把规则绑定到闲鱼商品

- **商品管理** 里找到你的 AI API 售卖商品
- 设置"发货规则"= 上面创建的那条 API 规则
- 如果有多个规格（¥5 / ¥10 / ¥30），每个规格一条规则，`amount_usd` 填不同值

### 5. 测试（自己当买家拍一单试试）

- 用另一个闲鱼号小号拍你自己的商品（或让朋友帮忙）
- 付款后 10 秒内，买家应该收到：

```text
感谢购买 NassaAPI 中转站额度 ✨

您的兑换链接（点击查看兑换码和使用教程）：
http://host.docker.internal:3000/r/abc12345

快速使用：
1. 打开链接复制兑换码
2. 登录 api.nassaapi.xyz（支持邮箱/密码注册）
3. 进入「钱包」-「兑换码」粘贴即可到账

有任何问题请联系 support@nassaapi.xyz ❤️
```

**注意**：测试完成后，短链会是 `http://host.docker.internal:3000/r/xxx` — 这是因为 dev 模式下接口无法知道外部真实域名。上线后请把 nassaapi-frontend 部署到公网，短链会自动变成 `https://nassaapi.xyz/r/xxx`。

---

## 排错

### 机器人调用 API 失败（Timeout）

```bash
# 从容器里测连通
docker exec -it xianyu-auto-reply-fix curl http://host.docker.internal:3000/api/bot/redeem
```

如果 curl 也超时 → nassaapi-frontend 没跑 / 被防火墙挡了 / host.docker.internal 解析不对。

### 机器人调用 API 返回 401

Secret 填错。检查机器人规则里 `X-Bot-Secret` 和 `.env.local` 里 `BOT_SHARED_SECRET` 是不是**完全一致**（注意复制时别多/少换行和空格）。

### 机器人调用 API 返回 502

表示 nassaapi-frontend 调 New API 失败了。常见原因：

- `NEWAPI_ADMIN_TOKEN` 过期或错了 → 去 `api.nassaapi.xyz/profile` 重新生成
- `NEWAPI_ADMIN_USER_ID` 不对
- New API 后端下线了 → 检查 `api.nassaapi.xyz` 是不是能访问

### 短链访问后 "链接不存在"

- 检查 `data/redemptions.db` 里是不是有这条记录：

```bash
cd /Users/w/Desktop/newapi/nassaapi-frontend
sqlite3 data/redemptions.db "SELECT short_id, customer_label, amount_usd FROM redemption_links ORDER BY id DESC LIMIT 10;"
```

## 从 Dev 切换到生产

当机器人稳定跑起来要上生产时：

1. **把 nassaapi-frontend 部署到 VPS**（PM2 + nginx 反代，绑定 `nassaapi.xyz` 域名）
2. 机器人规则里的 URL 改成 `https://nassaapi.xyz/api/bot/redeem`
3. 短链域名自动变成真实公网地址
4. 机器人就可以从任意地方访问发货接口

---

## 安全提示

- **BOT_SHARED_SECRET 是你整个自动发货流的钥匙**。泄漏了任何人都能调接口免费刷码
- 不要 commit 到 git、不要在聊天里贴出来
- 发生泄漏 → `openssl rand -hex 32` 生成新的，更新 `.env.local` 和机器人规则两边，重启 dev server
