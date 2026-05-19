# chatgpt2cpa

把 ChatGPT / Codex session JSON 转成可下载的 CPA `auth.json` 或 sub2api `sub2api-data` 的本地工具。

这个项目提供一个本地 Web UI，用来提取和整理 OpenAI/Codex 会话里的认证字段，并导出为兼容 CPA / sub2api 的 JSON。它默认面向本机使用，因为会处理高敏感度 token。

项目灵感参考自 [tocpa.pages.dev](https://tocpa.pages.dev)，但当前仓库是独立维护的 Python 实现，并额外补充了 `session -> sub2api` 导出能力。

本项目与 OpenAI 无官方关联，也不适合部署到公网。

## 能做什么

- 粘贴 ChatGPT / Codex session JSON
- 自动提取 `access_token`、`refresh_token`、`id_token`、`account_id`、`plan_type`
- 在缺少真实 `id_token` 时自动合成 CPA 占位 token
- 直接导出兼容 CPA 的 `auth.json`
- 直接导出兼容 sub2api 的 `sub2api-data`
- 在 sub2api 导出里，自动把当前项目生成的 CPA auth JSON 原样放进 `accounts[0].credentials`
- 在页面里显示摘要、告警，并自动触发下载

## 快速开始

如果你只是想本地跑起来，最短路径是：

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -e '.[dev]'
chatgpt2cpa --host 127.0.0.1 --port 8000
```

然后打开 `http://127.0.0.1:8000`。

要求：Python 3.10 或更高版本。

## 安装方式

### 1. 源码开发安装

适合本地开发、调试和跑测试。

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -e '.[dev]'
```

### 2. 从 GitHub tag 直接安装

适合希望直接按 tag 安装源码包的场景。

```bash
python -m pip install "chatgpt2cpa @ git+https://github.com/WTFGEDelphia/chatgpt2cpa.git@v0.1.0"
```

说明：

- `v0.1.0` 是示例版本标签；如果后续发了新 tag，替换成目标版本即可
- 这种方式会从 GitHub 拉取对应 tag 的源码并安装
- 如果你更偏好安装构建产物，见下面的 wheel 安装方式

### 3. 从 GitHub Release 的 wheel 安装

适合不想直接拉源码、只想安装发布产物的场景。

```bash
python -m pip install ./chatgpt2cpa-0.1.0-py3-none-any.whl
```

## 启动方式

### 1. 开发模式

```bash
source .venv/bin/activate
uvicorn chatgpt2cpa.app:app --app-dir src --reload
```

### 2. 安装包模式

```bash
chatgpt2cpa --host 127.0.0.1 --port 8000
```

也可以用模块方式启动：

```bash
python -m chatgpt2cpa --host 127.0.0.1 --port 8000
```

### 3. 显式对外监听

默认应该只绑定 `127.0.0.1`。如果你确实需要在局域网、容器或远程调试环境里暴露服务，才显式指定：

```bash
chatgpt2cpa --host 0.0.0.0 --port 8000
```

## 页面使用说明

- 点击 `生成下载（CPA）` 会执行 `session -> cpa`
- 点击 `生成下载（sub2api）` 会执行 `session -> sub2api`
- 默认文件名：
  - CPA: `codex-<email>-<plan_type>-cpa.json`
  - sub2api: `codex-<email>-<plan_type>-sub2api.json`
- 手动输入文件名时，后端会自动补上 `-cpa` 或 `-sub2api`
- 成功生成后，结果标题右侧的 `下载 JSON` / `复制文件名` 会启用
- 如果浏览器拦截自动下载，可以在结果标题右侧再次点击 `下载 JSON`

## 构建与发布

### 本地构建发布包

```bash
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -e '.[dev]'
python -m build
python -m twine check dist/*
```

### 发布前推荐做的完整校验

```bash
bash scripts/release_check.sh
```

当 `main` 上的代码已经准备好发布，并且你推送了和 `pyproject.toml` 版本一致的 `v*` tag 之后，GitHub Actions 会自动：

- 跑测试
- 执行打包校验
- 创建 GitHub Release
- 上传 `wheel` 和 `sdist` 到 Release 附件

例如当前版本是 `0.1.0`，对应 tag 应该是 `v0.1.0`。

这个脚本会做几件事：

- 清理旧的 `build/` 和 `dist/`
- 构建 `wheel` 和 `sdist`
- 执行 `twine check`
- 检查模板和静态资源是否真的被打进包里
- 在临时虚拟环境里安装 wheel，并验证 `chatgpt2cpa --help`

更完整的发版步骤，以及“旧 tag 不会自动补触发 release”的补救方式，见 [docs/release-runbook.md](docs/release-runbook.md)。

## 测试

```bash
source .venv/bin/activate
python -m pytest -v
```

## 安全说明

- 这个工具会处理高敏感度 token，只建议在本机运行
- 不要把它直接部署到公网
- 不要把真实 token 提交到 Git 仓库、Issue、日志或截图中
- 默认保持 `127.0.0.1` 绑定；只有确实需要时，才显式改成 `0.0.0.0`

如果你发现了安全问题，请先看 [SECURITY.md](SECURITY.md)，不要直接在公开 Issue 里贴真实 token 或可复用的敏感数据。

## 贡献

- 提交代码前先看 [CONTRIBUTING.md](CONTRIBUTING.md)
- 行为规范见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## 开源协议

本项目使用 [MIT License](LICENSE)。

## 发布边界

- 当前发布链路聚焦 GitHub Releases，不自动发布到公共 PyPI
- `build_payload.py` 只作为设计参考，不属于项目运行时依赖
