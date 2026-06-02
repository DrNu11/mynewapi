"""
Status Page 配置

支持环境变量(都有合理默认):
  GATEWAYS_JSON     多网关 JSON 配置(数组),覆盖默认列表
  MYSQL_HOST/...    NewAPI MySQL 连接参数
  REALTIME_WINDOW   实时统计窗口(秒) 默认 300
  HISTORY_HOURS     历史展示小时数  默认 48
  BUCKET_SECONDS    历史桶宽度(秒)  默认 3600
  REFRESH_SECONDS   后台采集间隔(秒) 默认 30
  MOCK_MODE         为 1 时返回 mock 数据,不连数据库与 docker
  MINIMAX_TOKEN_PLANS_JSON
                    MiniMax Token Plan 账号配置:
                    [{"tag":"mm1","name":"MiniMax A","cookie":"...","group_id":"..."}]
  MINIMAX_REFRESH_SECONDS
                    MiniMax 额度刷新间隔(秒) 默认 30
  GPT_TOKEN_PLANS_JSON
                    GPT/Codex 账号配置:
                    [{"tag":"gpt-a","name":"GPT A","access_token":"...","plan_type":"pro"}]
  GPT_REFRESH_SECONDS
                    GPT 额度刷新间隔(秒) 默认 30
  GPT_USAGE_DB
                    cpa-usage-keeper SQLite 路径,配置后自动生成 GPT 状态卡
  ALERT_EMAIL_TO    告警收件人,为空则不发邮件
  ALERT_SMTP_*      SMTP 发件配置
  ALERT_USER_WARNING_EMAIL_THRESHOLD
                    同一异常累计发出几封邮件后写入客户侧弹窗提醒,默认 3
  ALERT_ABUSE_MAX_EMAILS
                    同一疑似异常使用对象最多发几封邮件,默认 3
  MINIMAX_CHANNEL_IDS
                    状态页可一键启停的 MiniMax 相关 NewAPI channel id
  MINIMAX_PLAN_CHANNELS_JSON
                    MiniMax Token Plan tag 到 NewAPI channel id 的映射
"""
from __future__ import annotations

import json
import os
from pathlib import Path


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _get_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# --- 数据源连接 ---
MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = _get_int("MYSQL_PORT", 3306)
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "new-api")

# --- 时间窗口 ---
REALTIME_WINDOW = _get_int("REALTIME_WINDOW", 300)
HISTORY_HOURS = _get_int("HISTORY_HOURS", 48)
BUCKET_SECONDS = _get_int("BUCKET_SECONDS", 3600)
REFRESH_SECONDS = _get_int("REFRESH_SECONDS", 30)
MINIMAX_REFRESH_SECONDS = _get_int("MINIMAX_REFRESH_SECONDS", 30)
MINIMAX_TIMEOUT_SECONDS = _get_int("MINIMAX_TIMEOUT_SECONDS", 10)
GPT_REFRESH_SECONDS = _get_int("GPT_REFRESH_SECONDS", 30)
GPT_TIMEOUT_SECONDS = _get_int("GPT_TIMEOUT_SECONDS", 10)
GPT_USAGE_DB = os.getenv("GPT_USAGE_DB", "").strip()

# --- 告警 ---
ALERT_EMAIL_TO = os.getenv("ALERT_EMAIL_TO", "").strip()
ALERT_EMAIL_FROM = os.getenv("ALERT_EMAIL_FROM", "").strip()
ALERT_SMTP_HOST = os.getenv("ALERT_SMTP_HOST", "").strip()
ALERT_SMTP_PORT = _get_int("ALERT_SMTP_PORT", 465)
ALERT_SMTP_USER = os.getenv("ALERT_SMTP_USER", "").strip()
ALERT_SMTP_PASSWORD = os.getenv("ALERT_SMTP_PASSWORD", "").strip()
ALERT_SMTP_SSL = _get_bool("ALERT_SMTP_SSL", True)
ALERT_SMTP_STARTTLS = _get_bool("ALERT_SMTP_STARTTLS", False)
ALERT_SMTP_AUTH_LOGIN = _get_bool("ALERT_SMTP_AUTH_LOGIN", False)
ALERT_INTERVAL_SECONDS = _get_int("ALERT_INTERVAL_SECONDS", 60)
ALERT_COOLDOWN_SECONDS = _get_int("ALERT_COOLDOWN_SECONDS", 1800)
ALERT_MINIMAX_WEEKLY_WARN_PERCENT = _get_int("ALERT_MINIMAX_WEEKLY_WARN_PERCENT", 85)
ALERT_MINIMAX_FIVE_HOUR_WARN_PERCENT = _get_int("ALERT_MINIMAX_FIVE_HOUR_WARN_PERCENT", 85)
ALERT_GPT_SUCCESS_RATE_WARN = _get_int("ALERT_GPT_SUCCESS_RATE_WARN", 80)
ALERT_SUCCESS_RATE_WARN = _get_int("ALERT_SUCCESS_RATE_WARN", 95)
ALERT_MIN_REQUESTS_FOR_RATE = _get_int("ALERT_MIN_REQUESTS_FOR_RATE", 20)
ALERT_ABUSE_MAX_EMAILS = _get_int("ALERT_ABUSE_MAX_EMAILS", 3)
ALERT_USER_WARNING_ENABLED = _get_bool("ALERT_USER_WARNING_ENABLED", True)
ALERT_USER_WARNING_EMAIL_THRESHOLD = _get_int("ALERT_USER_WARNING_EMAIL_THRESHOLD", 3)
ALERT_USER_WARNING_EXPIRE_HOURS = _get_int("ALERT_USER_WARNING_EXPIRE_HOURS", 168)
MINIMAX_CHANNEL_IDS_RAW = os.getenv("MINIMAX_CHANNEL_IDS", "49,56,59,71")
MINIMAX_PLAN_CHANNELS_JSON = os.getenv(
    "MINIMAX_PLAN_CHANNELS_JSON",
    '{"mm-a":[49],"mm-b":[59],"mm-c":[56],"mm-d":[71]}',
)
MINIMAX_AUTO_DISABLE_WEEKLY_PERCENT = _get_int("MINIMAX_AUTO_DISABLE_WEEKLY_PERCENT", 99)
MINIMAX_AUTO_REENABLE_WEEKLY_PERCENT = _get_int("MINIMAX_AUTO_REENABLE_WEEKLY_PERCENT", 95)

# --- 路径 ---
BASE_DIR = Path(__file__).resolve().parent
HISTORY_DB = os.getenv("HISTORY_DB", str(BASE_DIR / "data" / "history.db"))
ALERT_STATE_DB = os.getenv("ALERT_STATE_DB", str(BASE_DIR / "data" / "alert_state.json"))
MINIMAX_CHANNEL_STATE_DB = os.getenv(
    "MINIMAX_CHANNEL_STATE_DB",
    str(BASE_DIR / "data" / "minimax_channel_state.json"),
)
MINIMAX_PLAN_STATE_DB = os.getenv(
    "MINIMAX_PLAN_STATE_DB",
    str(BASE_DIR / "data" / "minimax_plan_state.json"),
)
STATIC_DIR = BASE_DIR / "static"

MOCK_MODE = os.getenv("MOCK_MODE", "0") == "1"


# --- 多网关配置 ---
# 每个网关字段:
#   tag             网关唯一标识(前端 React key)
#   name            网关显示名
#   container       要 tail 日志的 docker 容器名,空字符串表示不 tail
#   log_format      日志格式名,见 log_parser.PARSERS
#   show_system     是否在前端 "VPS 监控" 区显示这台主机的系统指标
#                   (多个 gateway 同主机时,只让一个显示即可)
#   use_mysql       是否从 NewAPI MySQL logs 拉 token 数据
#   health_url      健康探针 URL(空=不探)
DEFAULT_GATEWAYS = [
    {
        "tag": "newapi",
        "name": "NewAPI Gateway",
        "container": "newapi-prod-new-api-1",
        "log_format": "newapi_gin",
        "show_system": True,
        "use_mysql": True,
        "health_url": "http://newapi-prod-new-api-1:3000/api/status",
    },
    {
        "tag": "cpa",
        "name": "CPA Proxy",
        "container": "cli-proxy-api-v7",
        "log_format": "cpa_gin",
        "show_system": False,
        "use_mysql": False,
        "health_url": "http://host.docker.internal:8317/healthz",
    },
    {
        "tag": "cards",
        "name": "Nassa Cards",
        "container": "",
        "log_format": "",
        "show_system": False,
        "use_mysql": False,
        "health_url": "http://host.docker.internal:3100/",
    },
]


def get_gateways() -> list[dict]:
    raw = os.getenv("GATEWAYS_JSON", "").strip()
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
    return DEFAULT_GATEWAYS


def get_minimax_token_plans() -> list[dict]:
    raw = os.getenv("MINIMAX_TOKEN_PLANS_JSON", "").strip()
    if not raw:
        return []
    try:
        plans = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(plans, list):
        return []

    out: list[dict] = []
    for idx, plan in enumerate(plans, start=1):
        if not isinstance(plan, dict):
            continue
        cookie = str(plan.get("cookie") or "").strip()
        if not cookie:
            continue
        tag = str(plan.get("tag") or f"minimax-{idx}").strip()
        name = str(plan.get("name") or f"MiniMax Token Plan {idx}").strip()
        group_id = str(plan.get("group_id") or plan.get("groupId") or "").strip()
        out.append({"tag": tag, "name": name, "cookie": cookie, "group_id": group_id})
    return out


def get_gpt_token_plans() -> list[dict]:
    raw = os.getenv("GPT_TOKEN_PLANS_JSON", "").strip()
    if not raw:
        return []
    try:
        plans = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(plans, list):
        return []

    out: list[dict] = []
    for idx, plan in enumerate(plans, start=1):
        if not isinstance(plan, dict):
            continue
        token = str(plan.get("access_token") or plan.get("accessToken") or "").strip()
        session = plan.get("session")
        usage_url = str(plan.get("usage_url") or "").strip()
        health_url = str(plan.get("health_url") or "").strip()
        quotas = plan.get("quotas") or plan.get("quota")
        if not (token or session or usage_url or health_url or quotas):
            continue
        item = dict(plan)
        item["tag"] = str(plan.get("tag") or f"gpt-{idx}").strip()
        item["name"] = str(plan.get("name") or f"GPT {idx}").strip()
        out.append(item)
    return out


def get_minimax_channel_ids() -> list[int]:
    ids: list[int] = []
    for item in MINIMAX_CHANNEL_IDS_RAW.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            ids.append(int(item))
        except ValueError:
            continue
    return ids


def get_minimax_plan_channel_map() -> dict[str, list[int]]:
    try:
        raw = json.loads(MINIMAX_PLAN_CHANNELS_JSON)
    except json.JSONDecodeError:
        raw = {}
    if not isinstance(raw, dict):
        return {}

    out: dict[str, list[int]] = {}
    for tag, value in raw.items():
        tag_text = str(tag).strip()
        if not tag_text:
            continue
        values = value if isinstance(value, list) else [value]
        ids: list[int] = []
        for item in values:
            try:
                ids.append(int(item))
            except (TypeError, ValueError):
                continue
        if ids:
            out[tag_text] = ids
    return out
