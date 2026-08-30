# WebUI 上游同步指南

本文件记录 Cherry Studio WebUI fork 的上游同步流程。WebUI 遵循最小侵入原则，但仍通过少量主程序窄桥、频道设置与运行参数接入桌面端；因此冲突必须逐文件审核，不能将主程序文件一律视为可覆盖内容。

## 三步同步

### 1. 先将 webui 合入同步分支

```bash
git checkout webui-upstream-sync
git -c commit.gpgsign=false merge webui
```

同步分支必须先包含当前 WebUI fork 的全部功能，避免基于过期 fork 合并上游。

### 2. 在同步分支合并上游 main

```bash
git fetch upstream
git -c commit.gpgsign=false merge upstream/main
```

逐文件解决冲突并验证双方语义。禁止使用 `-X theirs`、`-X ours` 或整文件 checkout 批量覆盖冲突；主程序文件可能包含 WebUI 必需的窄桥和 fork 契约。

冲突审核重点：

- `src/main/webService/`：WebUI HTTP/SSE 窄桥。
- `src/main/ai/streamManager/api/startAgentSessionRun.ts`：WebUI 运行参数（例如 `fastMode`）。
- `src/renderer/pages/settings/ChannelsSettings/`：桌面端 WebUI 频道设置入口。
- `src/renderer/i18n/locales/*.json`：fork 自有的 `settings.webui.*` 翻译键。
- CI、打包和 `electron-builder.yml`：WebUI 产物注入与发布配置。

### 3. 验证后合回 webui

```bash
git checkout webui
git -c commit.gpgsign=false merge webui-upstream-sync
```

仅在同步分支全部验证通过后合回 `webui`。未经用户明确授权不推送、不触发云构建。

## 验证门槛

```bash
pnpm run typecheck:node
pnpm i18n:check
pnpm test:renderer src/renderer/pages/settings/ChannelsSettings
cd webui && pnpm typecheck && pnpm test && pnpm build
cd .. && git diff --check
```

同时检查 fork 关键契约：

```bash
rg "fastMode" src/main/ai/streamManager/api/startAgentSessionRun.ts src/main/webService/apiRouter.ts
rg 'settings.webui.title' src/renderer/i18n/locales/*.json
```

## 本次事故记录

2026-08-30 的一次同步直接在 `webui` 分支执行 `merge upstream/main -X theirs`，造成两类回归：

1. 12 个 renderer 语言包中的 `settings.webui.*` 节点被上游版本整体覆盖，频道 WebUI 设置页显示原始翻译 key。
2. `startAgentSessionRun` 的 `fastMode?: boolean` 类型字段被覆盖，但调用和传参仍保留，导致 Windows 构建出现 TS2339/TS2353。

结论：最小侵入不等于主程序改动可以丢弃。同步必须通过 `webui-upstream-sync` 分支逐文件审核，并同时运行主程序和 WebUI 验证。
