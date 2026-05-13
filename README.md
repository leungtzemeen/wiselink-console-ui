# wiselink-console-ui

Vue 3 + Vite + TypeScript 控制台前端，内含 **面试演示用** SSE 单页：`fetch` + `ReadableStream` 解析 `text/event-stream`（智选灵犀与 Manus 两种 Tab）。

## 环境变量

复制 `.env.example` 为 `.env` 或 `.env.local` 后按需修改。

- 示例值：`VITE_API_BASE=http://localhost:8081/api`
- **生产**（Nginx 同域）：构建前改为 `VITE_API_BASE=https://wiselink.wiki/api`（与静态站同源下的 `/api` 路径一致即可）。
- **本地跨域**：`vite.config.ts` 已将 `/api` 代理到 `http://localhost:8081`。可在 `.env.local` 中设置 `VITE_API_BASE=/api`，前端请求走同源 `/api/...`，由 Vite 转发到 Java，无需后端开 CORS。

仓库内 **不要** 提交任何 API Key；本演示仅使用 `prompt` + `sessionId` 查询参数。

## 常用命令

```bash
pnpm i
pnpm dev
pnpm build
```

- `pnpm dev`：启动开发服务器（默认带 `/api` → `http://localhost:8081` 代理）。
- `pnpm build`：类型检查并产出 `dist/` 静态资源。

预览构建结果：`pnpm preview`。

## Nginx 同域部署（静态站 + `/api` 反代到 Java）

静态文件指向构建产物目录，并将 API 前缀反代到后端，例如：

```nginx
server {
    listen 443 ssl;
    server_name wiselink.wiki;

    root /var/www/wiselink-console-ui/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8081/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

构建时使用 `VITE_API_BASE=https://wiselink.wiki/api`（或与 `location /api/` 一致的前缀），这样前端请求与页面同源，由 Nginx 将 `/api` 转到 Java 服务。

## 技术栈

- [Vue 3](https://vuejs.org/) + [Vite](https://vite.dev/) + [TypeScript](https://www.typescriptlang.org/)
