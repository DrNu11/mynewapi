# 贡献指南

感谢你愿意为 `chatgpt2cpa` 贡献代码。

## 开始之前

- 这个项目会处理高敏感度 token；请不要在任何提交、Issue、测试样例、截图或日志里放入真实凭证
- 默认只支持本机使用；除非有明确理由，不要把默认监听地址改成 `0.0.0.0`
- 本项目当前要求 Python 3.10+

## 本地开发

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -e '.[dev]'
```

启动本地 Web UI：

```bash
chatgpt2cpa --host 127.0.0.1 --port 8000
```

## 提交前检查

至少运行下面两项：

```bash
pytest -q
bash scripts/release_check.sh
```

如果你的改动不涉及打包链路，第二项可以在发版前统一执行，但新增依赖、调整资源文件、修改 CLI 或发布文档时建议一起跑。

## Pull Request 建议

- 说明改动的背景、范围和验证方式
- 如果改动会影响导出 JSON 结构，请补测试
- 如果改动会影响公开使用方式，请同步更新 README 或相关文档
- 尽量把重构和行为修改拆开，方便审阅

## 讨论与安全

- 普通功能建议或缺陷报告可以直接提 Issue
- 涉及泄漏、鉴权或敏感数据处理的问题，请先看 [SECURITY.md](SECURITY.md)
