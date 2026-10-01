# 运行环境：Node.js 20（glibc）。better-sqlite3 使用官方预编译二进制，无需编译工具链。
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# 安装依赖（仅生产依赖）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 应用代码与前端静态文件
COPY src ./src
COPY public ./public

# SQLite 数据目录（容器内自动建库建表，可用卷持久化）
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV PORT=3000 \
    DB_PATH=/app/data/app.db

EXPOSE 3000

# 启动即完成数据库初始化（建表 / 迁移）
CMD ["node", "src/server.js"]
