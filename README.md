# WiseLink Console UI

WiseLink AI 对话控制台前端：基于 **Vue 3 + Vite + TypeScript**，对接 Java 后端的 **SSE（`text/event-stream`）** 流式接口，支持 **智选灵犀**（导购对话）与 **Manus**（多步执行、步进事件展示）两种模式。适用于线上部署、本地联调与容器化交付。

## 生态与相关仓库

WiseLink 能力按职责拆在 **三个独立 GitHub 仓库**（便于分别演进与部署）。**本仓库仅为浏览器端 UI**；对话推理、RAG、Manus 编排与 MCP 工具由后端仓库提供。

| 仓库 | 说明 | 默认端口 |
|------|------|----------|
| **本仓库** · `wiselink-console-ui` | 对话控制台 SPA（智选灵犀 / Manus Tab、流式展示、停止生成） | 开发 `5173`；生产由 Nginx 托管静态资源 |
| [gen-ai-agent-java](https://github.com/leungtzemeen/gen-ai-agent-java) | **后端主应用**（Spring Boot + Spring AI）：`GET /api/ai/chat` 导购 SSE、`GET /api/ai/chat/manus` Manus 步进 SSE；Function Calling、Modular RAG、会话记忆 | **8081**（`context-path: /api`） |
| [wiselink-mcp-ecosystem](https://github.com/leungtzemeen/wiselink-mcp-ecosystem) | **MCP Server 子进程**：主应用通过 **stdio** 拉起；提供 `exportShoppingReport` 等工具（Markdown → PDF）；另在 **8082** 提供 HTTP 下载与 MCP WebMVC | **8082** |

```
浏览器 ──► wiselink-console-ui (本仓库)
              │  /api/ai/chat、/api/ai/chat/manus  (SSE)
              ▼
         gen-ai-agent-java (8081)
              │  stdio 拉起 MCP 子进程
              ▼
         wiselink-mcp-ecosystem (8082)
```

本地联调时：先启动 **gen-ai-agent-java**，再 `pnpm dev`；前端通过 Vite 将 `/api` 代理到 `127.0.0.1:8081`。MCP 由主应用按需拉起，**无需**为控制台单独启动 8082（除非调试 PDF 导出或 MCP HTTP）。

各仓库的构建、环境变量与生产部署细节见其各自 **README**。

## 功能特性

- **双模式对话**：Tab 切换「智选灵犀 / Manus」，共用同一会话时间线（`sessionId`）。
- **自研 SSE 消费**：使用 `fetch` + `ReadableStream` 解析 SSE 帧（非 `EventSource`），支持首包回调、`AbortController` 取消竞态与用户主动「停止生成」（保留已输出 partial 内容）。
- **流式打字机展示**：普通模式逐字 reveal；Manus 模式对步进 `summary` 排队打字，终稿完成后再切换 Markdown，避免长文整块蹦出。
- **Manus 步进面板**：主列表 / 调试区折叠、面板收起策略、`RUN_FINISHED·META` 与 `done` 兜底收口、步进列表内层自动跟滚。
- **助手 Markdown 渲染**：`marked` 解析 + `DOMPurify` 消毒后 `v-html` 展示。
- **Agent 介绍 Popover**：头像唤起技能卡片、一键填入快捷 prompt（含 iOS/Android 同步 `focus` + 延迟滚动，保证软键盘唤起）。
- **移动端友好**：Vite `host: true` 支持局域网调试；非安全上下文下 `crypto.randomUUID` 降级方案。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | [Vue 3](https://vuejs.org/)（Composition API + `<script setup>`） |
| 构建 | [Vite 8](https://vite.dev/) + [TypeScript](https://www.typescriptlang.org/) + `vue-tsc` |
| 内容 | [marked](https://marked.js.org/) + [DOMPurify](https://github.com/cure53/DOMPurify) |
| 部署 | 多阶段 **Docker**（Node 构建 + Nginx 静态托管） |

## 架构概览

```
src/
├── App.vue                 # 页面壳：组合 composables + 子组件
├── components/             # UI 组件
│   ├── ChatLayout.vue      # shell / chat-window / 页脚
│   ├── ChatHeader.vue
│   ├── ChatComposer.vue    # Tab + 输入 + 发送（defineModel）
│   ├── ChatMessageItem.vue # 单条消息 + Markdown / 流式预览
│   ├── ManusStepsPanel.vue # Manus 步进区
│   └── AgentPopover.vue    # Teleport 技能弹层
├── composables/
│   ├── useChatService.ts   # SSE fetch、会话消息、错误处理
│   ├── useTypewriter.ts    # 打字机 reveal、Manus 步进动画
│   ├── useAutoScroll.ts    # 主列表 / 步进 ol 跟滚（双 rAF）
│   └── useAgentPopover.ts  # Popover 定位与快捷 prompt
├── chat/
│   └── chatSseStrategies.ts  # normal / manus SSE 策略（开闭原则，可横向扩展）
├── types/chat.ts           # 消息类型、常量池
├── utils/
│   ├── sse.ts              # SSE 解析、buildChatUrl
│   ├── markdown.ts
│   └── manusStepDisplay.ts # 步进主列表 / 调试区分流
└── styles/chat-feed.css    # 消息流、空状态、错误条
```

**设计要点**：SSE 核心循环与模式解析解耦（`ChatSseModeStrategy`）；UI 与滚动、打字机、网络层分 composable 维护，便于扩展第三种模式（如 search）。

## 与后端约定

- **智选灵犀**：`GET {VITE_API_BASE}/ai/chat?prompt=&sessionId=`，SSE 正文在 `data` 字段增量拼接。
- **Manus**：`GET {VITE_API_BASE}/ai/chat/manus?...`，事件类型包括：
  - `event: manus` — JSON 步进 payload（`phase` / `summary` / `messageType` 等）
  - `event: done` — JSON 终稿（`finalSummary`）
- 仓库内 **不要** 提交 API Key；鉴权若由网关处理，前端仅传 `prompt` + `sessionId`。

## 本地开发

### 环境变量

复制 `.env.example` 为 `.env` 或 `.env.local`：

```bash
# 推荐：走 Vite 同源代理，手机用 http://<电脑局域网IP>:5173 访问时也能转发到本机 Java
VITE_API_BASE=/api
```

- `vite.config.ts` 已将 `/api` 代理到 `http://127.0.0.1:8081`（`changeOrigin: true`）。
- **勿** 在手机调试时把 `VITE_API_BASE` 写成 `http://192.168.x.x:8081`，否则请求会直连后端端口，易被防火墙 / CORS 拦截。
- 生产构建同域示例：`VITE_API_BASE=https://your-domain.com/api`（须与 Nginx `location /api/` 前缀一致）。

### 常用命令

```bash
pnpm i
pnpm dev      # 开发服务器，默认 http://localhost:5173
pnpm build    # vue-tsc + vite build → dist/
pnpm preview  # 本地预览 dist
```

## Docker 部署

仓库提供多阶段镜像：Node 22 构建 → Nginx Alpine 托管静态资源，并挂载仓库内 [`nginx.conf`](./nginx.conf)。

```bash
# 构建前请设置生产 API 前缀（写入构建产物）
# 例如 Docker 同域反代：VITE_API_BASE=/api
docker build -t wiselink-console-ui .

docker run --rm -p 8080:80 \
  --network <与后端同一网络> \
  wiselink-console-ui
```

容器内 Nginx 行为（见 `nginx.conf`）：

- `/` — SPA，`try_files` 回退 `index.html`
- `/api/` — 反代至 `http://wiselink-server:8081`（**请与后端容器服务名或 Compose 网络对齐**）
- `proxy_buffering off` — **必须**，否则 SSE 流式打字会被缓冲

> 本地开发用 `pnpm`；镜像构建阶段使用 `npm`（见 Dockerfile）。二者脚本一致（`npm run build`）。

## 生产 Nginx（非 Docker / 宿主机直挂 dist）

静态目录指向 `dist/`，API 前缀反代到 Java。流式接口请关闭代理缓冲：

```nginx
server {
    listen 443 ssl;
    server_name wiselink.wiki;

    root /var/www/wiselink-console-ui/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8081;   # 或 http://127.0.0.1:8081/api/，与后端路由一致即可
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

构建时设置：`VITE_API_BASE=https://wiselink.wiki/api`（与页面同源下的 `/api` 路径一致）。

## 许可证

私有项目；对外展示代码前请确认与团队策略一致。
