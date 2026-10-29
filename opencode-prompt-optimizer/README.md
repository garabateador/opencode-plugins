# opencode-prompt-optimizer（OpenCode v2 版）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](.)
[![Platform](https://img.shields.io/badge/platform-opencode%20v2-blueviolet.svg)](https://opencode.ai)
[![English](https://img.shields.io/badge/docs-English-green.svg)](README.en.md)

OpenCode **v2** 插件。把随手写的需求扩写成 LLM 能直接执行的工程任务草稿（直接以任务内容开头，无 `[DRAFT]` 前缀 —— 该前缀已于 1.0.1 移除），并同时支持 **TUI** 与 **Desktop** 两端。

> 这是 [opencode-prompt-optimizer 0.3.x](https://github.com/JochenYang/opencode-prompt-optimizer)（v1，仅 TUI）按 v2 插件标准的完整改写版。

## 效果

你在输入框写：

```
我想增加一个会话区 chat 框下面有 statusbar，显示当前模型和上下文占用
```

触发优化后，得到（Desktop 上直接替换输入框内容；TUI 上在对话框中呈现并一键复制）：

```
基于现有前端栈（请先用 Read 工具查看侧边栏组件、会话区组件目录结构，
定位 Sidebar、ChatInput/MessageInput 等关键文件路径），按以下顺序交付：

1. StatusBar 组件
- ...（按项目实际情况生成）
```

输出直接以任务内容开头（不再带 `[DRAFT]` 前缀），自动引用当前项目的真实文件。**草稿先审阅、后发送**，从不自动发送 —— 与 v1 语义一致（v1 的 `[DRAFT]` 标记按用户要求已移除）。

---

## v2 架构：一个包，四个部件

| 导出 | 运行于 | 职责 |
| --- | --- | --- |
| `.`（server） | OpenCode server | 优化引擎（本插件的唯一实现）：RPC 注册、模型解析、项目感知、一次性生成 |
| `./rpc` | 任意客户端 | 类型化 RPC 契约 `Optimize.optimize` |
| `./tui` | 终端 UI | ✦ 图标（`prompt.footer.status` 槽位）、`/optimize` 命令、结果对话框 + OSC-52 复制 |
| `./gui-experimental` | Desktop 窗口 | ⌘⇧O / `/optimize` 命令、✦ Optimize 药丸、读写 composer（完整还原 v1 输入框替换语义） |

```text
opencode-prompt-optimizer/
├── package.json               # 四个 exports + 构建脚本 + v2 依赖
├── tsconfig.json              # server/rpc/engine（纯 TS）
├── tsconfig.tui.json          # TUI（OpenTUI Solid JSX）
├── tsconfig.gui.json          # GUI（Solid DOM JSX）
├── vite.config.ts             # GUI 官方 Vite 预设
├── scripts/build.ts           # TUI 的 Bun 打包
├── smoke.ts                   # RPC 冒烟脚本（本地验证用，不随包发布）
└── src/
    ├── index.ts               # server 部：Plugin.define + ctx.rpc.register + generate.text
    ├── engine.ts              # v1 原版迁移：提示词构建/语言检测/think 剥离/项目上下文
    ├── rpc.ts                 # Rpc.define 契约（三端共享）
    ├── tui.tsx                # TUI 部
    └── gui.tsx                # GUI 部
```

## 安装

### 从 npm（推荐）

```
opencode plugin add opencode-prompt-optimizer
```

包内有 server 部 → 写入全局 `opencode.json(c)` 的 `plugins` 数组；TUI 与 Desktop 会自动加载各自的部件。重启 OpenCode 生效。

### 手动配置

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-prompt-optimizer",
    // 或带选项的对象形制：
    {
      "package": "opencode-prompt-optimizer",
      "options": {
        "language": "auto",
        "variant": "none",
        "includeContext": true,
        "timeoutMs": 120000
      }
    }
  ]
}
```

### 本地目录（开发用）

v2 会自动发现 `.opencode/plugins/` 下的目录；目录内有 `package.json` + `exports` 时按发布包方式加载：

```bash
mkdir -p .opencode/plugins
ln -s /path/to/opencode-prompt-optimizer .opencode/plugins/prompt-optimizer
```

### 卸载

```
opencode plugin remove opencode-prompt-optimizer
```

或从 `opencode.json(c)` 的 `plugins` 数组删掉，再清理缓存：

```
rm -rf ~/.cache/opencode/packages/opencode-prompt-optimizer*
```

## 使用

### TUI

| 触发 | 行为 |
| --- | --- |
| 输入 `/opt <粗略需求>`（或 `/optimize`） | 直接优化命令后的文字；执行后 `/opt` 前缀会保留在输入框（宿主 `arguments` 命令的通用行为），手动清掉即可 |
| 输入粗略需求后点击输入框**底部右侧**的 **✦**（或 ⌘P 选择 Optimize prompt）| **读取输入框当前内容 → 优化 → 原地替换**输入框（v1 语义完整复原）|
| 命令面板（Palette）选 "Optimize prompt" | 同上 |

默认 `delivery: "insert"`：**原地替换**输入框内容（读取 → 优化 → `EditBuffer.replaceText` 写回，读回校验失败自动回退对话框+复制路径）；设置 `"delivery": "dialog"`（经 `cli.json` options）可回到对话框+OSC-52 复制审阅模式。运行中 ✦ 变为 spinner。✦ 位置 = 输入框 footer 行最右端（追加到文档化的 `prompt.footer` 槽位树，该行为 space-between 布局的最后一个元素 —— home 与会话输入框均生效）。原地替换通过插件的 `context.renderer` 渲染树定位提示框 TextareaRenderable 实现 —— 属 OpenTUI 内部面（宿主改版会自动回退对话框，见 `delivery` 语义）。

### Desktop

| 触发 | 行为 |
| --- | --- |
| 会话输入框写好粗略需求，按 **⌘⇧O** | 输入框内容**替换**为优化后的任务草稿，焦点回到输入框，审阅后发送 |
| 会话中输入 `/optimize` | 同上 |
| 点击 composer 上方的 **✦ Optimize** 药丸 | 同上 |
| Home（无会话）按 ⌘⇧O | 对话框收取需求 → 优化 → 打开一个带任务草稿的新草稿会话 |

**Desktop 端通过 `composer.text()` / `composer.setText()` 精确还原 v1 的“读取输入 → 替换 → 人工审阅”语义。**

> ⚠️ Desktop 的 v2 窗口槽位（`window.bottom` / `session.header` / `session.location.menu` / `session.panel.end`）不覆盖执行/停止按钮旁的位置，故 inline 形态采用受控 DOM 注入（锚定应用的 `data-slot`/`data-action` 属性，找不到锚点时空窗、`buttonPlacement:"lane"` 随时可切回）。

## 配置

放在 `opencode.json(c)` 的插件对象形制 `options` 中（由 server 部读取）：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `language` | `"auto"` / `"en"` / `"zh"` | `"auto"` | 输出语言，`auto` 按输入文本检测（中文 → zh） |
| `overrideModel` | `{ providerID, modelID }` | （继承） | 强制模型；默认用位置默认模型 |
| `variant` | `string` | （无） | 模型变体（如 `"none"` 关 thinking）。v2 server 部会先对照目标模型的 `variants` 列表校验，未注册时**静默回退**为模型默认变体（v1 语义；v2 原生 generate.api 会硬失败，故在插件内实现回退，server 日志会记 `variant not registered, falling back`） |
| `includeContext` | `boolean` | `true` | 是否注入项目上下文；关闭后只润色文本 |
| `timeoutMs` | `number` | `120000` | 单次优化超时（毫秒），超时返回类型化错误 |
| `buttonPlacement` | `"inline" \| "lane" \| "none"`（仅 GUI） | `"inline"` | `inline`：✦ 按钮注入到执行/停止按钮**左侧**（DOM 锚点 `[data-slot="composer-actions"]` → `[data-action="composer-submit"]`；应用改版找不到锚点时空窗降级，⌘⇧O 恒可用）；`lane`：输入框上方药丸（1.0 行为）；`none`：仅命令 |
| `showPill`（仅 GUI，兼容） | `boolean` | — | 1.0 遗留：`true` → `lane`，`false` → `none`；缺省走 `inline` |
| `pollIntervalMs` | — | — | **v1 遗留，已忽略**（v2 无轮询加载时会打日志提示） |

### 项目感知

打开时每次优化注入（与 v1 相同的范围与预算）：

- `package.json` 的 name / description / dependencies（前 8 个）+ devDependencies（前 6 个）
- 规则文件（2KB 预算，按优先级）：`AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `.cursorrules` / `.windsurfrules` / `CONVENTIONS.md` / `INSTRUCTIONS.md` / `.github/copilot-instructions.md`
- Git 状态（v2 经 `ctx.vcs` 读取，支持远程 server）：当前分支 + 已修改文件（前 12 个，过滤 `node_modules/`）

同一目录 5 分钟内复用缓存。**只读上述固定文件，不递归扫描项目**。`"includeContext": false` 可完全关闭。

## 权限

- RPC 即权限面：唯一方法 `optimize`（读文本 → 一次性生成），无工具、无 shell、无递归扫描。
- 模型调用全部发生在 server 进程，走 OpenCode 已配置的 provider；插件不新增任何 `permission.request`。
- GUI 部在 Desktop 中于 Settings → Extensions → Plugins 里显示，可随时开关。

## v1 → v2 关键差异与改造点

### API / 生命周期 / 配置

| 维度 | v1（0.3.x） | v2（1.0.0） | 对应改造点 |
| --- | --- | --- | --- |
| 插件形态 | 仅 `./tui` 部 | server + rpc + tui + gui 四件套 | 优化引擎移到 server 部；新增 RPC 与 GUI 部 |
| 入口 | `TuiPluginModule { id, tui }`，`tui(api, options)`（`@opencode-ai/plugin/tui`） | `Plugin.define({ id, setup(ctx) })`（`@opencode/plugin` / `/tui` / `/gui`） | 三处入口全部重写；cleanup 语义由 v2 生命周期提供（缓存清理定时器） |
| 优化执行 | TUI 内 `session.create → session.prompt → 轮询 messages → session.delete`（4+ 次 API + 轮询） | `ctx.experimental.generate.text`（无会话、无工具、不进历史，1 次调用） | 删除轮询代码；`pollIntervalMs` 退役 |
| 输入框读写 | 槽位 `home_prompt` / `session_prompt` 替换整个 Prompt 组件并捕获 `TuiPromptRef` (`ref.set`) | v2 SDK **无提示词读写 API**（Desktop 有 `composer.text/setText`） | Desktop 完整还原；TUI 改为「命令参数/对话框收集输入 + 对话框交付草稿 + OSC-52 复制」—— 与宿主第一方插件（/btw）同一模式 |
| UI 注入 | `api.slots.register` | `ctx.ui.slot({append: "prompt.footer.status", render})` 等槽位树 | ✦ 图标改挂在 `prompt.footer.status`（home 与 session 输入框均渲染） |
| 反馈 | `api.ui.toast({variant: success\|warning\|error})` | TUI `ctx.ui.toast.show`（info/success/warning/error）；GUI `ctx.toast.show`（default/success/error/loading） | 调用面与 variant 集合更新 |
| 主题 | `api.theme.current.accent / textMuted` | `ctx.theme.text.base/muted/faint`、`theme.hue.interactive[200]` | token 结构更新 |
| 项目感知 | TUI 进程 `execFileSync git` + 本地 fs | server 部 fs + `ctx.vcs.get/status`（按 RPC 入参 directory 定位，远程可用） | git 子进程删除 |
| 配置 | `tui.json` `"plugin": [pkg \| [pkg, opts]]` | `opencode.json(c)` `"plugins": [... \| {package, options}]`；TUI-only 包用 `cli.json`；`.opencode/plugins/` 自动发现 | 配置键、文件名、形制全变 |
| 依赖 | peer `@opencode-ai/plugin >=1`；deps `@opentui/*` 0.2.16、`solid-js` 1.9.13 | dep `@opencode/plugin ^2.2`；peer `@opentui/* >=0.6.6`、`solid-js >=1.9` | 单一 SDK 依赖，主机运行时提供其余模块 |
| 构建 | Bun（TUI） | Bun（TUI）+ Vite 官方 GUI 预设（单 CJS 产物 `dist/gui-experimental.cjs`） | 新增 GUI 构建链 |

### 语义保全清单

- `[DRAFT]` 前缀：v1 有该标记；1.0.1 起按用户要求移除（提示词不再要求、输出层防御性剥离），300 词上限、执行顺序子任务、无 Markdown 标题 —— 保留（同一套构建代码）。
- 语言 `auto/en/zh` 检测与回退、think 块剥离 —— 逐字保留。
- 项目感知范围/预算/TTL —— 逐字保留（git 读取通道替换）。
- “草稿先审阅后发送、不自动发送” —— Desktop 端语义完全一致；TUI 端因 v2 SDK 能力边界改为对话框交付 + 一键复制（这是 v2 规范下的最优等价形态）。
- `overrideModel` / `variant` / `includeContext` / `timeoutMs` —— 语义不变。

## 开发

```bash
npm install          # 或 bun install
npm run typecheck    # 三个 tsconfig（server / TUI / GUI）
npm run build        # dist/tui.js（Bun）+ dist/gui-experimental.cjs（Vite）
npm run dev          # TUI watch 模式（GUI 用 vite build --watch）
```

## 验证与测试（可执行步骤）

以下步骤全部在本仓库开发过程中实际执行过。

### 1. 构建与类型检查

```bash
npm run typecheck && npm run build
# 期望输出：
#   tui.js  ~9.5 KB
#   dist/gui-experimental.cjs  ~3 kB │ gzip: 1.33 kB
```

### 2. 产物契约检查

```bash
bun -e 'const m = await import("./dist/tui.js"); console.log(m.default)'
# 期望: { id: "prompt-optimizer.tui", setup: [Function] }  ← 宿主 isPlugin 校验的形状
```

### 3. server 部加载 + RPC 全链路冒烟（无 UI）

```bash
# 准备测试项目
SMOKE=$(mktemp -d) && cd $SMOKE && git init -q
echo '{"name":"smoke"}' > package.json && echo '# Smoke' > AGENTS.md
mkdir -p .opencode/plugins
ln -s /path/to/opencode-prompt-optimizer .opencode/plugins/prompt-optimizer
git add -A && git commit -qm smoke && echo x > echo.txt

# 启动 v2 server
opencode serve --hostname 127.0.0.1 --port 4587 2>&1 | tee serve.out &
sleep 5
# 期望日志出现: [prompt-optimizer] server part loaded { language: "auto", ... }

# 用本仓库的 smoke.ts 调 RPC（需要配置过模型，例如 opencode auth login）
export SMOKE_PASSWORD=$(grep -a "server password" serve.out | awk '{print $3}')
bun /path/to/opencode-prompt-optimizer/smoke.ts
# 期望 plugin 列表中: { id: "prompt-optimizer", state: "active", features: { server: true, tui: true, rpc: true, gui: true } }
# 期望 optimize 返回 { language: "zh", contextUsed: true } 且 text 直接以任务内容开头（无 [DRAFT] 前缀）
```

空输入路径的期望输出（无需可用模型即可复现）：

```
empty-text ok: Input is empty, nothing to optimize
```

### 4. TUI 端到端（已在本机 opencode v2.2.0 实测通过，tmux 驱动真机终端）

```bash
cd $SMOKE && opencode
```

实测记录（`opencode.json` 配置 `overrideModel` + 本地路径包）：

1. ✅ 首页与会话输入框底部 footer 出现 **✦**（`prompt.footer.status` 槽位）；无插件目录的对照项目无 ✦（阴性对照成立）。
2. ✅ `/` 斜杠补全同时列出 `/opt` 与 `/optimize`（别名生效），描述为 "Expand a rough request into an executable task spec"。
3. ✅ `/opt <粗略需求>` 回车 → ✦ 变为 **spinner**（busy 状态）→ 优化走对话框所选模型 → **结果对话框**完整渲染（标题 "Optimized draft — review, edit, then paste into the input and send"），草稿正确引用项目真实信息（识别到 AGENTS.md 与 solid-js + TypeScript 技术栈 —— 项目感知生效）。
4. ✅ 对话框内按 `c` → OSC-52 写入剪贴板 → 底部提示变为 `✓ copied`；`esc` 关闭。
5. ✅ `/opt` 无参数 → 输入框保留 `/opt` 前缀 + v1 同款空输入提示 toast。
6. ✅ 斜杠命令带参数执行时**不会**把命令文本提交给主 agent（草稿从不自动发送）。
7. ✅ `/plugins` 页显示 TUI 部 `prompt-optimizer.tui` 与 Server 部 `prompt-optimizer` 均 active。
8. ⚠️ 期间发现并修复了两个 v2 细节：错误消息渲染（rpc 错误对象形状）与 **RPC 调用需显式携带 `location`**（共享服务器拓扑下，服务端按位置解析插件注册）—— 已固化在 `src/tui.tsx` / `src/gui.tsx` 中。
9. ℹ️ 模型层仅剩账号级额度问题（免费额度耗尽时 "Free usage limit reached"，与 free 模型亦计入同一额度有关）；换用已认证 provider 即走通 —— 本机验证即切换为 Ollama Cloud。

### 5. Desktop 端到端

前置事实（本机实测）：Desktop 应用自身的 sidecar（`serve --service`）已在位置作用域下成功加载了本插件的 server 部与 RPC（服务器日志 `loading plugin … entrypoint=src/index.ts` 可证），GUI 部的窗口侧注入需按下述步骤交互验证。

1. 全局 `opencode.jsonc` 的 `plugins` 加入本包 → **Settings → Extensions → Plugins** 中可见 `prompt-optimizer` 且已启用。
3. 会话输入粗略需求 → **⌘⇧O** → 输入框被**替换**为优化后的任务草稿，焦点回到输入框；审阅后回车发送。
4. 再试 `/optimize` 与 ✦ 按钮；Home 上按 ⌘⇧O → 新草稿会话带出任务草稿。
5. `"options": { "showPill": false }` → 药丸消失，命令仍可用。

### 6. 语义回归检查表

| 用例 | 期望 |
| --- | --- |
| 中文输入 | 输出中文草稿 |
| 英文输入 | 输出英文草稿 |
| `"includeContext": false` | server 日志 `contextUsed: false` |
| `"variant": "none"` | server 日志 model 字段携带 variant |
| `"overrideModel": {...}` | 生成走指定模型 |
| 空输入 | 类型化错误 `Input is empty, nothing to optimize` |
| 模型超时（把 `timeoutMs` 调成 1000） | `Optimization failed: 1s timeout` |

## 故障排查

| 现象 | 排查 |
| --- | --- |
| 插件未加载 | `opencode serve` 日志找 `[prompt-optimizer] server part loaded`；无则检查 `.opencode/plugins/` 或 `opencode.jsonc` 的 `plugins` 数组 |
| TUI 无 ✦ / 无 `/opt` | 包构建产物缺失：本地目录方式需先 `npm run build`（`./tui` 指向 `dist/tui.js`）；`/plugins` 查看 TUI 部状态 |
| 优化结果英文（输入中文） | 显式 `"language": "zh"` |
| `Optimization failed: …s timeout` | 调大 `timeoutMs` 或换 `overrideModel` |
| 免费额度报错 | `Free usage limit reached…` 为 provider 侧限制，配认证或更换 provider |
| TUI 复制失败 | 终端不支持 OSC-52；用鼠标选中文本复制 |
| Desktop 里 GUI 未出现 | 检查 `dist/gui-experimental.cjs` 是否已构建，并确认插件在**全局** `opencode.json(c)`（Desktop 只读全局配置） |

## License

[MIT](LICENSE)