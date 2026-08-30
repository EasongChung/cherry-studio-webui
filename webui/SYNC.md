# WebUI 上游同步指南

本文件记录将 `webui` 分支与 Cherry Studio 上游保持同步的**三步操作法**。

## 背景

`webui` 是一个最小化侵入的独立子目录（Vue 3 + Vite + TypeScript），仅通过主程序窄桥（Data API / WebService）读取数据，不直接触碰主进程、IPC、数据库或 AI 核心。因此上游主程序更新对 webui 影响极小。

## 三步同步

### 1. 拉取上游最新提交

```bash
git fetch upstream main
```

### 2. 合并上游 main 到当前 webui 分支

```bash
git merge upstream/main --no-edit -X theirs
```

- `-X theirs`：冲突文件一律采用上游版本。由于 webui 是最小侵入子目录，冲突几乎只发生在主程序代码（i18n locales、electron-builder.yml、主进程 TS 等），本地对这些文件的改动应让位于上游最新实现。
- 合并成功后应确认 **webui/ 子目录零冲突、零 staged 改动**——这才是正确合并的标志。
- 若首次未用 `-X theirs` 产生冲突，先 `git merge --abort` 中止，再以 `-X theirs` 重试。

### 3. 验证并提交

```bash
cd webui && pnpm typecheck && pnpm test && pnpm build
git add -A
git commit -m "chore(sync): merge upstream/main"
```

- 提交信息沿用历史惯例前缀 `chore(sync):`（参见 `7f61ba6740`）。
- 本方法为**仅本地同步**，不自动推送；需要发布时再 `git push`。

## 注意事项

- 不做 `rebase`：保持合并提交历史，便于追溯上游合并点。
- 主程序 i18n locales 与 webui 的 `textPacks.ts` 相互独立，冲突时直接取上游版本，不影响 webui 文案。
- 同步后运行 webui 的 `typecheck / test / build` 作为回归门槛。
