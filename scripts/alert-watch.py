#!/usr/bin/env python3
"""NassaAPI 主动告警 — MiniMax 配额 / 网关错误 / 渠道状态

通过 ilinkai API 直连推送微信告警, 同条目有冷却去抖.
"""
import base64
import json
import random
import re
import ssl
import subprocess
import time
import urllib.request
import uuid
from pathlib import Path

# ---- 配置 ----
# MiniMax keys (key -> label)
MINIMAX_KEYS = {
    "sk-cp-9sDncde20Tj5zRpc7eQgom5FWJLTyPKuhUQ-7XkKfwndCOWWLRwgyEIbOXWYd2Pe4y6KCA2YVKOC9K8Fm1pI3-8fd1UxQU7veUTWElhBReTwj6Ds_MyXK14": "mm-a",
    "sk-cp-zAzbKaMsmr5qbZj_SHdA6Xq6H9CGPi3hdZJ7NFHTQ3RwdIAHMsYxNrAa0l73EIKyW_btXqZ1JjLKRFzt-t-C46oOVEWh7SDfnPr8QwAM9e5aMuPW9fwF_pQ": "mm-b",
    "sk-cp-qhY9TV8qK6oUpVL2jtJVl9AGez_LD-mhJ2Fq126jy490oftS1x1QFFAZpOzPxwyglY1dkD5rDlctZZ1CrbCreOgDOacUDnyWl_2MdYH_boPaip0sZ7ry9Vc": "mm-c",
    "sk-cp-wrve02h6F8mImbU7TkMruV3ObbtBp-ocPyk3Matx7UDgcAMl9Td_u7Mg5uBLE70lGEb7-aI5keHd3OaZCe5juOWi7wZvkxwfuwdBHDoKNP5va2Iwvd6wH5I": "mm-d",
}

# ilinkai WeChat API
WECHAT_TOKEN = "50fba5ebddcd@im.bot:060000ca0421500ac5800c2ba0075870c51d7d"
WECHAT_TARGET = "o9cq801jOCWZ6DM3DHhZnM0GUMO0@im.wechat"
WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com"
WECHAT_CTX_FILE = Path("/root/.openclaw/openclaw-weixin/accounts/50fba5ebddcd-im-bot.context-tokens.json")
WECHAT_CLIENT_VERSION = str((2 << 16) | (4 << 8) | 3)  # "2.4.3" -> 132099

STATE_FILE = Path("/root/minimax-monitor/alert_state.json")
LOG_FILE = Path("/root/minimax-monitor/alert.log")

# 阈值
MM_INTERVAL_REMAIN_PCT = 20    # 5h 剩余 < 20% 告警
MM_WEEKLY_REMAIN_PCT = 30      # 周剩余 < 30% 告警
GATEWAY_ERROR_THRESH = 50      # 2000 行日志错误 > 50 告警
COOLDOWN_S = 3600              # 同条 1h 冷却
# --------------


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = "[" + ts + "] " + msg + "\n"
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a") as f:
        f.write(line)


def fetch_json(url, headers, timeout=15):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _load_context_token():
    """从 OpenClaw gateway 存储中读取当前 context token"""
    try:
        data = json.loads(WECHAT_CTX_FILE.read_text())
        return data.get(WECHAT_TARGET, "")
    except Exception:
        return ""


def send_wechat(text):
    """通过 ilinkai API 直接发送微信消息。成功返回 msg_id, 失败 raise Exception"""
    ctx_token = _load_context_token()

    body = {
        "msg": {
            "from_user_id": "",
            "to_user_id": WECHAT_TARGET,
            "client_id": "alert-watch-" + uuid.uuid4().hex[:12],
            "message_type": 2,
            "message_state": 2,
            "context_token": ctx_token,
            "item_list": [
                {"type": 1, "text_item": {"text": text}}
            ],
        },
        "base_info": {
            "channel_version": "2.4.3",
            "bot_agent": "OpenClaw",
        },
    }

    x_wechat_uin = base64.b64encode(
        str(random.randint(0, 2**32 - 1)).encode()
    ).decode()

    data = json.dumps(body).encode()
    req = urllib.request.Request(
        WECHAT_BASE_URL + "/ilink/bot/sendmessage",
        data=data,
        headers={
            "Content-Type": "application/json",
            "AuthorizationType": "ilink_bot_token",
            "Authorization": "Bearer " + WECHAT_TOKEN,
            "X-WECHAT-UIN": x_wechat_uin,
            "iLink-App-Id": "bot",
            "iLink-App-ClientVersion": WECHAT_CLIENT_VERSION,
        },
    )

    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
        resp = json.loads(r.read())

    if isinstance(resp, dict) and resp.get("ret", 0) != 0:
        raise Exception("ilinkai sendMessage ret=" + str(resp.get("ret")))

    msg_id = body["msg"]["client_id"]
    log("wechat send ok msg_id=" + msg_id)
    return msg_id


def shell(cmd, timeout=15):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() + "\n" + r.stderr.strip()
    except Exception as e:
        return str(e)


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(s):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(s, indent=2))


def check_minimax_quota(state, now):
    """检查所有 MiniMax key 的配额, 返回告警列表"""
    alerts = []
    for key, label in MINIMAX_KEYS.items():
        try:
            data = fetch_json(
                "https://www.minimaxi.com/v1/token_plan/remains",
                {"Authorization": "Bearer " + key},
            )
        except Exception as e:
            ak = "mm_down:" + label
            if now - state.get(ak, 0) >= COOLDOWN_S:
                alerts.append("{} ({}) API 不可达: {}".format(label, key[:12] + "...", e))
                state[ak] = now
            continue

        for m in data.get("model_remains", []):
            name = m.get("model_name", "?")
            ipct = m.get("current_interval_remaining_percent", 100)
            wpct = m.get("current_weekly_remaining_percent", 100)

            if ipct is not None and ipct <= MM_INTERVAL_REMAIN_PCT:
                ak = "mm:{}:{}:5h".format(label, name)
                if now - state.get(ak, 0) >= COOLDOWN_S:
                    alerts.append("{} {} 5h 剩余仅 {}%".format(label, name, ipct))
                    state[ak] = now

            if wpct is not None and wpct <= MM_WEEKLY_REMAIN_PCT:
                ak = "mm:{}:{}:week".format(label, name)
                if now - state.get(ak, 0) >= COOLDOWN_S:
                    alerts.append("{} {} 周剩余仅 {}%".format(label, name, wpct))
                    state[ak] = now

    return alerts


def check_gateway_errors(state, now):
    """检查网关错误数, 返回告警列表"""
    alerts = []
    out = shell(
        "docker logs --tail 2000 newapi-prod-new-api-1 2>&1 | grep -cE '(relay error|channel error|重试|502|524)' || true",
        timeout=15,
    )
    try:
        count = int(out.strip().split('\n')[0])
    except ValueError:
        return alerts

    if count > GATEWAY_ERROR_THRESH:
        ak = "gw_errors"
        if now - state.get(ak, 0) >= COOLDOWN_S:
            alerts.append("网关错误偏高: 最近 2000 行日志 {} 条错误 (阈值 {})".format(count, GATEWAY_ERROR_THRESH))
            state[ak] = now

    # 检查余额不足 (403 Insufficient account balance)
    insufficient = shell(
        "docker logs --tail 2000 newapi-prod-new-api-1 2>&1 | grep -c 'Insufficient account balance' || true",
        timeout=15,
    )
    try:
        bal_count = int(insufficient.strip().split('\n')[0])
    except ValueError:
        bal_count = 0
    if bal_count > 0:
        ak = "gw_balance"
        if now - state.get(ak, 0) >= COOLDOWN_S:
            alerts.append("检测到余额不足: {} 次 (403 Insufficient account balance)".format(bal_count))
            state[ak] = now

    return alerts


def check_channels(state, now):
    """检查渠道状态变化, 返回告警列表"""
    # 使用 mysql 直连查询
    dsn = shell("grep NEWAPI_SQL_DSN /opt/nassa-cards/.env.local | head -1 | cut -d= -f2", timeout=5).strip()
    if not dsn:
        return []

    m = re.match(r'^([^:]+):([^@]+)@tcp\(([^)]+)\)/([^?]+)', dsn)
    if not m:
        return []
    user, passwd, host_port, db = m.groups()
    idx = host_port.rfind(':')
    host = host_port[:idx] if idx >= 0 else host_port
    port = host_port[idx+1:] if idx >= 0 else '3306'

    # 查询启用但 auto_ban 的渠道
    out = shell(
        "docker exec newapi-prod-mysql-1 mysql -h{} -P{} -u{} -p'{}' {} -N -e \"SELECT id, name FROM channels WHERE status=1 AND auto_ban=1 ORDER BY id\" 2>/dev/null || true".format(
            host, port, user, passwd, db
        ),
        timeout=10,
    )

    alerts = []
    if out.strip():
        lines = out.strip().split('\n')
        ids = []
        for line in lines:
            cols = line.split('\t')
            if cols:
                ids.append(cols[0])
        ak = "ch:auto_ban"
        prev = state.get(ak, "")
        curr = ",".join(ids)
        if curr != prev:
            alerts.append("渠道 auto_ban 仍启用: {} 个 (id: {})".format(len(ids), curr))
            state[ak] = curr

    return alerts


def main():
    log("check start")
    state = load_state()
    now = time.time()
    all_alerts = []

    try:
        all_alerts += check_minimax_quota(state, now)
    except Exception as e:
        log("minimax check FAIL: " + str(e))

    try:
        all_alerts += check_gateway_errors(state, now)
    except Exception as e:
        log("gateway check FAIL: " + str(e))

    try:
        all_alerts += check_channels(state, now)
    except Exception as e:
        log("channel check FAIL: " + str(e))

    log("check done, alerts=" + str(len(all_alerts)))

    if all_alerts:
        text = "🚨 NassaAPI 告警\n" + "\n".join("- " + a for a in all_alerts)
        if len(text) > 1900:
            text = text[:1900] + "\n...(截断)"
        try:
            send_wechat(text)
        except Exception as e:
            log("wechat send FAIL: " + str(e))

    save_state(state)


if __name__ == "__main__":
    main()
