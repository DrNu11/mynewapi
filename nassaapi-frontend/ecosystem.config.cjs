/**
 * PM2 配置 - 让 nassaapi-frontend 在 VPS 上 7×24 跑
 *
 * 用法：
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save       # 保存进程列表
 *   pm2 startup    # 开机自启（按提示再执行一行命令）
 *   pm2 logs nassaapi-frontend
 *   pm2 reload nassaapi-frontend  # 零停机重启
 *
 * 重要：env 变量真实值放 .env.production.local，PM2 会自动读取
 */
module.exports = {
  apps: [
    {
      name: "nassaapi-frontend",
      cwd: "/opt/nassaapi-frontend",
      script: "node_modules/.bin/next",
      args: "start -p 3001",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
      },
      error_file: "/var/log/nassaapi/error.log",
      out_file: "/var/log/nassaapi/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
