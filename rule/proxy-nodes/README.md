# 🛡️ 科学上网节点 — 207.244.243.12 (Contabo)

> 生成时间:2026-05-15  
> 服务器:`207.244.243.12` (Contabo, Ubuntu 24.04, 6 核 / 11Gi RAM / 193G 磁盘)  
> 部署方式:3X-UI (Xray-core 26.4.25) + Hysteria2 (独立 systemd 服务)

---

## 📦 节点总览(3 个,协议互补)

| # | 协议 | 端口 | 用途 | 速度 | 隐蔽性 |
|---|---|---|---|---|---|
| 1 | **VLESS + Reality** | TCP 443 | 🥇 **主用** | ⚡⚡⚡ | 🥷🥷🥷 (最高,模拟 cloudflare.com) |
| 2 | **Hysteria2** | UDP 36713 | 🥈 **快速备用** | ⚡⚡⚡⚡ | 🥷🥷 (UDP/QUIC 易被 QoS) |
| 3 | **Shadowsocks-2022** | TCP 8388 | 🥉 **兜底** | ⚡⚡⚡ | 🥷🥷 (纯加密无握手特征) |

**使用策略**:平时用 Reality(主),网络好/需大带宽切 Hysteria2,Reality 被识别时切 SS2022。

---

## 🚀 一键 Share Links

### 1️⃣ VLESS + Reality(主用)

```
vless://a33f9fb8-51bb-46d0-8d3a-6b54fdc15943@207.244.243.12:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.cloudflare.com&fp=chrome&pbk=7pnL_m6XftDfRH5Lue-2zI1a0XWg-xcQd5F8m5lqChg&sid=d5f348390b201e86&type=tcp&headerType=none#Reality-CF-207
```

### 2️⃣ Hysteria2(快速备用)

```
hysteria2://QKBEoj0FhaXZzda9Xi7Qv1Nq@207.244.243.12:36713/?sni=www.bing.com&insecure=1#Hysteria2-207
```

### 3️⃣ Shadowsocks-2022(兜底)

```
ss://2022-blake3-aes-256-gcm:Y9V8K1K9HP8eal2uHOidOTYiCh8idIE1h%2F6E43KpAG4%3D@207.244.243.12:8388#SS2022-Boss-207
```

---

## 🔑 节点参数明细

### Reality 节点
| 字段 | 值 |
|---|---|
| Address | `207.244.243.12` |
| Port | `443` |
| Protocol | `vless` |
| UUID | `a33f9fb8-51bb-46d0-8d3a-6b54fdc15943` |
| Flow | `xtls-rprx-vision` |
| Network | `tcp` |
| Security | `reality` |
| SNI | `www.cloudflare.com` |
| Fingerprint | `chrome` |
| Public Key | `7pnL_m6XftDfRH5Lue-2zI1a0XWg-xcQd5F8m5lqChg` |
| Private Key (server) | `GLP7kq6o5xhvah560s2ZxLE5qfhDflF2ahzzEVkbnHo` |
| Short ID | `d5f348390b201e86` |
| SpiderX | `/` |

### Hysteria2 节点
| 字段 | 值 |
|---|---|
| Address | `207.244.243.12` |
| Port (UDP) | `36713` |
| Password | `QKBEoj0FhaXZzda9Xi7Qv1Nq` |
| SNI | `www.bing.com` |
| TLS Insecure | `true`(自签证书) |
| Up / Down | 1 gbps / 1 gbps |

### SS2022 节点
| 字段 | 值 |
|---|---|
| Address | `207.244.243.12` |
| Port (TCP+UDP) | `8388` |
| Method | `2022-blake3-aes-256-gcm` |
| Password | `Y9V8K1K9HP8eal2uHOidOTYiCh8idIE1h/6E43KpAG4=` |

---

## 📱 推荐客户端

| 平台 | 客户端 | 备注 |
|---|---|---|
| **iOS** | Shadowrocket / Streisand / V2Box | 都支持三种协议 |
| **Mac** | NekoBox / V2rayU / ClashX Pro / sing-box | NekoBox 最全 |
| **Windows** | NekoRay / v2rayN / Clash Verge Rev | NekoRay 推荐 |
| **Android** | NekoBox / V2RayNG | NekoBox 最全 |
| **路由器** | OpenClash / mihomo / sing-box | 需 Clash Meta 内核 |

---

## 🗂️ 配套文件

| 文件 | 用途 |
|---|---|
| `nodes.txt` | 一行一个 share link,适合 NekoBox / NekoRay 批量导入 |
| `clash.yaml` | Clash Meta / mihomo / Clash Verge 完整配置 |
| `sing-box.json` | sing-box / NekoBox 完整配置 |

---

## 🔧 服务器管理

### 3X-UI 面板

```
URL:      http://207.244.243.12:12245/7i8F0tEk4mlxsX2pxQ/
Username: sjTHnjhWTW
Password: RIbfe2gipa
```

### Hysteria2 配置文件
```
/etc/hysteria/config.yaml
```

### systemd 服务
```bash
systemctl status x-ui                  # 3X-UI 面板
systemctl status hysteria-server       # Hysteria2 后端
```

---

## ⚠️ 注意事项

1. **Reality 与 Hysteria2 用自签证书** — 客户端需要 `skip-cert-verify` / `insecure=1`
2. **Contabo 默认防火墙是关闭的**(`ufw inactive`)。如果连不上,登 Contabo panel 检查云端防火墙
3. **SS2022 password 含 `/` 和 `=`** — 导入到客户端时如果识别失败,用 base64 完整 URL 格式(见 `nodes.txt` 中 `ss://base64` 注释)
4. **Reality 公私钥安全**:私钥只在服务器,泄露会让人能伪造你的节点
5. **不要在 NewAPI 主站 (107.174.155.17) 装代理** — 干扰业务且会污染业务 IP

---

## 🔄 节点重建

如果哪天密钥泄露要重建,登 3X-UI 面板:
1. **Inbounds** → 点击节点右边铅笔图标
2. 改 UUID / 重新生成 Reality keypair / 改密码
3. 客户端重新导入新 share link
