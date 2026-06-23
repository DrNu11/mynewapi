#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import time
import argparse
import requests

# 默认的 API Key（使用您提供的海螺/MiniMax密钥）
DEFAULT_API_KEY = "sk-cp-9sDncde20Tj5zRpc7eQgom5FWJLTyPKuhUQ-7XkKfwndCOWWLRwgyEIbOXWYd2Pe4y6KCA2YVKOC9K8Fm1pI3-8fd1UxQU7veUTWElhBReTwj6Ds_MyXK14"

# API 端点定义
CREATE_TASK_URL = "https://api.minimax.io/v1/video_generation"
QUERY_STATUS_URL = "https://api.minimax.io/v1/query/video_generation"
RETRIEVE_FILE_URL = "https://api.minimax.io/v1/files/retrieve"

# 颜色控制台输出
GREEN = "\033[92m"
BLUE = "\033[94m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
RESET = "\033[0m"

def log_info(msg):
    print(f"[{BLUE}INFO{RESET}] {msg}")

def log_success(msg):
    print(f"[{GREEN}SUCCESS{RESET}] {msg}")

def log_warn(msg):
    print(f"[{YELLOW}WARNING{RESET}] {msg}")

def log_error(msg):
    print(f"[{RED}ERROR{RESET}] {msg}")

def main():
    parser = argparse.ArgumentParser(description="MiniMax/海螺 AI 文生视频一键生成与下载工具")
    parser.add_argument("--prompt", type=str, default="A futuristic cybersecurity hub with glowing holographic data streams [Push in].", help="视频提示词")
    parser.add_argument("--model", type=str, default="MiniMax-Hailuo-2.3", choices=["MiniMax-Hailuo-2.3", "MiniMax-Hailuo-02", "T2V-01-Director", "T2V-01"], help="视频生成模型")
    parser.add_argument("--duration", type=int, default=6, choices=[6, 10], help="视频时长（秒）")
    parser.add_argument("--resolution", type=str, default="1080P", choices=["720P", "768P", "1080P"], help="视频分辨率")
    parser.add_argument("--key", type=str, default=DEFAULT_API_KEY, help="MiniMax API Key")
    parser.add_argument("--output", type=str, default="generated_video.mp4", help="下载保存的本地文件名")
    parser.add_argument("--no-download", action="store_true", help="只获取下载链接，不下载文件到本地")

    args = parser.parse_args()

    api_key = args.key or os.environ.get("MINIMAX_API_KEY")
    if not api_key:
        log_error("未提供 API Key！请使用 --key 参数或设置 MINIMAX_API_KEY 环境变量。")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # 第一步：提交文生视频任务
    log_info(f"正在向 MiniMax 提交视频生成任务...")
    log_info(f"模型: {BOLD}{args.model}{RESET}")
    log_info(f"提示词: {BOLD}\"{args.prompt}\"{RESET}")
    log_info(f"规格: {args.duration}秒 | {args.resolution}")

    payload = {
        "model": args.model,
        "prompt": args.prompt,
        "duration": args.duration,
        "resolution": args.resolution
    }

    try:
        response = requests.post(CREATE_TASK_URL, headers=headers, json=payload)
        response.raise_for_status()
        resp_data = response.json()
    except Exception as e:
        log_error(f"提交视频任务请求失败: {e}")
        if 'response' in locals() and response.text:
            log_error(f"服务器返回: {response.text}")
        sys.exit(1)

    base_resp = resp_data.get("base_resp", {})
    status_code = base_resp.get("status_code", -1)
    status_msg = base_resp.get("status_msg", "unknown")

    if status_code != 0:
        log_error(f"任务创建失败 (错误码 {status_code}): {status_msg}")
        sys.exit(1)

    task_id = resp_data.get("task_id")
    log_success(f"任务创建成功！任务 ID (task_id): {BOLD}{task_id}{RESET}")

    # 第二步：循环轮询任务状态
    log_info("进入状态轮询，等待视频生成（通常需要1-3分钟，请耐心等待）...")
    
    file_id = None
    start_time = time.time()
    
    while True:
        elapsed = int(time.time() - start_time)
        try:
            status_resp = requests.get(f"{QUERY_STATUS_URL}?task_id={task_id}", headers=headers)
            status_resp.raise_for_status()
            status_data = status_resp.json()
        except Exception as e:
            log_warn(f"轮询状态失败: {e}，将在 15 秒后重试...")
            time.sleep(15)
            continue

        status = status_data.get("status")
        
        # 打印当前状态和已用时间
        sys.stdout.write(f"\r[{BLUE}POLLING{RESET}] 已用时: {elapsed}s | 当前状态: {YELLOW}{status}{RESET}      ")
        sys.stdout.flush()

        if status == "Success":
            file_id = status_data.get("file_id")
            print() # 换行
            log_success(f"视频生成成功！File ID: {BOLD}{file_id}{RESET}")
            break
        elif status == "Fail":
            print()
            log_error("视频生成失败！")
            if "base_resp" in status_data:
                log_error(f"原因: {status_data['base_resp'].get('status_msg')}")
            sys.exit(1)
        
        # 等待 15 秒再次轮询
        time.sleep(15)

    # 第三步：获取下载链接
    log_info("正在获取视频下载 URL...")
    try:
        file_resp = requests.get(f"{RETRIEVE_FILE_URL}?file_id={file_id}", headers=headers)
        file_resp.raise_for_status()
        file_data = file_resp.json()
    except Exception as e:
        log_error(f"获取视频下载链接失败: {e}")
        sys.exit(1)

    file_info = file_data.get("file", {})
    download_url = file_info.get("download_url")

    if not download_url:
        log_error("未能获取到有效的 download_url！")
        sys.exit(1)

    log_success(f"获取成功！视频临时下载链接 (有效期9小时):\n{GREEN}{download_url}{RESET}")

    # 第四步：下载视频文件
    if args.no_download:
        log_info("由于使用了 --no-download 参数，已跳过文件下载。")
        sys.exit(0)

    log_info(f"正在下载视频，保存为 {BOLD}{args.output}{RESET}...")
    try:
        video_data = requests.get(download_url, stream=True)
        video_data.raise_for_status()
        
        total_size = int(video_data.headers.get('content-length', 0))
        downloaded = 0
        
        with open(args.output, "wb") as f:
            for chunk in video_data.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    if total_size:
                        downloaded += len(chunk)
                        percent = int(100 * downloaded / total_size)
                        sys.stdout.write(f"\r[{BLUE}DOWNLOADING{RESET}] 进度: {percent}% [{downloaded}/{total_size} 字节]")
                        sys.stdout.flush()
        print()
        log_success(f"视频文件已成功保存至本地: {BOLD}{os.path.abspath(args.output)}{RESET}")
    except Exception as e:
        log_error(f"下载文件到本地失败: {e}")
        log_warn("您可以复制上方绿色的临时下载链接，直接粘贴到浏览器中手动下载。")

if __name__ == "__main__":
    main()
