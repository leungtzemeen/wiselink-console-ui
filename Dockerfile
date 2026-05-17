# ========================================== 阶段一：构建阶段 (Stage 1: Build) ==========================================
FROM node:22-alpine AS build-stage
# 设置容器内的打包工作目录
WORKDIR /app
# 1. 巧妙利用 Docker 缓存机制：先单独复制依赖描述文件
COPY package*.json ./
# 2. 线上高频避坑：强制指定国内淘宝镜像源，杜绝因连接国外官方源导致的下载超时崩溃
RUN npm install --registry=https://registry.npmmirror.com
# 3. 将前端项目的所有源码复制到容器中
COPY . .
# 4. 执行前端生产打包编译
RUN npm run build
# ========================================== 阶段二：生产运行阶段 (Stage 2: Production) ==========================================
FROM nginx:alpine AS production-stage
# 1. 移除 Nginx 镜像自带的默认欢迎页
RUN rm -rf /usr/share/nginx/html/*
# 2. 核心魔法：从第一阶段（build-stage）的容器里，把打包好的 dist 目录 干净地偷过来，塞进生产环境 Nginx 的静态资源托管目录
COPY --from=build-stage /app/dist /usr/share/nginx/html
# 3. 把我们上一步刚在宿主机写好的局部 nginx.conf 配置文件 覆盖到容器内部的配置路径下，让 /api 反代规则生效
COPY nginx.conf /etc/nginx/conf.d/default.conf
# 暴露容器内部的 80 端口（注意：这只是容器内端口，不对外暴露物理端口）
EXPOSE 80
# 启动 Nginx
CMD ["nginx", "-g", "daemon off;"]
