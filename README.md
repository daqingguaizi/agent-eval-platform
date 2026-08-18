# Agent Eval Platform

面向画布 Agent 的评测与人工评分平台。仓库包含用例规范、确定性评分、模型辅助评审任务、人工评分工作台，以及本地 Viewer。

## 包含内容

- `golden-set-runner/`：运行编排、评分、人工评分 API 与 Viewer。
- `specs/`：Golden Set 与 30 条创作者试点评测规格、评分与归因 Spec。
- `standards/`：画布 Agent 质量契约。
- `datasets/`、`docs/`、`skills/`：评测数据索引、方法论与辅助资产。
- `targets/`：被测产品的**外部**目标声明，不包含产品源码。

## 明确不包含

为了安全、体积和职责边界，以下内容不会提交到 GitHub：

- 被测画布产品与 Canvas Agent 源码副本；
- 本机账号、密钥、Cookie、浏览器 Profile 与运行时目录；
- 真实 Run 的 Trace、原始请求/响应、截图、生成图片/视频/音频与人工评分结果；
- 第三方媒体资源与参考项目。

真实运行需要将被测产品和受控媒体作为外部依赖配置；详见 [Runner 说明](./golden-set-runner/README.md)。

## 快速查看 Viewer

```bash
cd golden-set-runner
npm ci
npm run view-run
# 浏览器打开 http://127.0.0.1:4179/viewer/
```

Viewer 用于读取本地已生成且未提交的 Run。通过 `?run=<run-id>` 指定要查看的运行批次。公开仓库默认不携带真实运行证据；请使用自行生成或经脱敏许可的演示 Run。

## 本地配置

```bash
cp .env.example .env.local
```

至少按需配置：

- `ECHO_TARGET_WEB_ROOT`：被测产品的 `web` 目录；
- `PILOT_RESOURCE_DIR`：受控媒体资源目录；
- 真实浏览器评测、模型辅助评分所需的账号和服务变量。

`.env.local` 只保留在本机，禁止提交。

## 开发校验

```bash
cd golden-set-runner
npm ci
npm run check
npm run test:pilot
```

## 发布前检查

在 GitHub 提交前执行：

```bash
git status --short
git check-ignore -v runtime-targets runtime-homes third_party golden-set-runner/runs golden-set-runner/codex-home
```

确认运行产物、产品副本和本地配置均处于忽略状态后，再进行暂存和提交。
