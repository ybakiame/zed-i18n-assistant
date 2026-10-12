# i18n Assistant 路线计划

**Goal:** 把已支持行内翻译、诊断、补全、跳转与项目配置的 MVP，打磨成稳定、可配置、可发布到 Zed 扩展商店的 i18n 辅助插件。

**Architecture:** 「Zed Extension 薄壳 + Node.js Language Server + 可测试 core」。Zed Rust/WASM 层只负责注册与启动 LSP；逻辑放在 `server/`（TypeScript），按领域拆分到 `server/src/**`。`server/core.ts` 是纯函数的兼容 barrel，`server/index.ts` 调用 `server/src/lsp/server.ts`；发布产物由 `bun run build:server` 打包为 `server/dist/index.js`。

**Tech Stack:** Zed Extension API、Rust/WASM、Node.js ESM、`vscode-languageserver`、Bun（`bun test` / `bun run typecheck`）。

---

## v0.0.1 当前能力

- Zed Dev Extension 可加载；Language Server 通过 `--stdio` 启动
- 支持文件：`.vue`、`.ts`、`.tsx`、`.js`、`.jsx`
- 识别写法：`$t`/`t`/`tc`/`$tc`/`i18n.t`/`i18n.tc`、`v-t="'key'"`、`v-t="{ path }"`、`<i18n-t keypath>`、react-i18next `<Trans i18nKey>`、react-intl `formatMessage({ id })`
- locale 形态：
  - 扁平 JSON（`en-US.json`）与目录式（`en-US/common.json`，按文件名加命名空间前缀，`index` 除外）
  - TypeScript/JavaScript locale module（静态解析，不执行用户代码）
- 能力：
  - Inlay Hints：行内显示默认语言翻译（还需在 Zed 打开 `inlay_hints.enabled`）
  - Hover：查看 key 对应多语言翻译（只读表格）
  - Diagnostics：全缺 error、部分语言缺失 warning、interpolation params 缺失/多余、跨语言参数不一致
  - Completion：仅在 i18n key 上下文内补全
  - Definition：跳转到 locale 定义，多语言时返回各语言位置供选择
  - Code Action：添加/移除 params；在无歧义 JSON locale 中安全创建缺失 key（含按 namespace 布局创建文件）
  - References：从源码或 locale 定义查引用，隔离独立子包并包含尚未落盘的打开文件
  - 编辑安全：读取未保存 locale、版本化最小编辑、拒绝歧义路径、源码识别降噪
- 配置：`.zed/i18n-assistant.json`（JSONC，附 JSON Schema 供编辑器补全/校验）与 `lsp.i18n-assistant.settings`；monorepo `packages` 多上下文与 `localeDirsMode`（`append` / `override`）
- 验证：`bun run test`（纯函数 + 真实 stdio LSP 回归）、`bun run typecheck`、`cargo check --target wasm32-wasip1`

---

## 后续计划（Backlog）

按方向列出，暂不做版本承诺。

### 体验与正确性

- 文案反查 key：在合法 i18n 上下文按翻译内容查找并准确替换 key
- 更多框架写法：`<FormattedMessage id>`、`$te`/`te`（exists 检查），函数名/属性名可配置
- 分框架的补全语义，不以全文件统一 namespace 替代绑定/作用域识别
- Rename：同步重命名 key（依赖准确定位、完整引用与冲突检查，扫描不完整时不执行部分重命名）

### 工程化与性能

- 项目级扫描报告与 CLI：缺失、空翻译、参数不一致、疑似未使用 key；必须显式报告扫描边界，不自动删除可能被动态引用的 key
- 大型项目性能：cache 策略与 debounce 调优（现有 locale cache + 文件监听）
- TS/JS locale 写入与 JSONC locale 支持（需独立设计与验收）

### 集成与产品化

- 报告稳定后再接 Assistant slash command（`/i18n-report`、`/i18n-missing` 等）
- Context Server：把 locale/key 使用索引作为 Zed Assistant 上下文
- 发布：扩展仓库转 public → npm 公开发布 → 向 `zed-industries/extensions` 提交子模块 PR；补 README 截图/GIF 与 CI

---

## Zed Extension API 调研结论

依赖 `zed_extension_api 0.7.0`。可利用方向：

1. **Zed settings 配置桥接**（已落地）：`language_server_workspace_configuration` / `LspSettings::for_worktree`，读取 `lsp.i18n-assistant.settings`。
2. **Assistant Slash Command 报告**：`run_slash_command` / `complete_slash_command_argument`，提供 `/i18n-report`、`/i18n-missing`、`/i18n-unused` 等。
3. **Context Server**：`context_server_command` / `context_server_configuration`，把 locale/key 索引暴露给 Assistant。
4. **暂不依赖 AI API**：优先做确定性的 diagnostics / code actions / report。

---

## 每次开发后的固定验证

```bash
bun run test
bun run typecheck
"$HOME/.cargo/bin/cargo.exe" check --target wasm32-wasip1
```

Windows 原生终端可用：

```powershell
bun run test
cargo check --target wasm32-wasip1
```

Zed 手动验证：重载 Dev Extension → 打开含 locale 文件的前端项目 → 测 hover / completion / diagnostics / definition / inlay hints → 查看 Zed 日志确认 language server 无报错。

---

## 不做事项 / 边界

- 复杂 WebView UI
- 自动机器翻译 / 调用外部 LLM API
- 大规模自动重构
- 执行用户 locale `.ts` / `.js` 代码
- 一次性支持所有 i18n 框架

原则：先把核心 LSP 体验做稳，再逐步扩展。
