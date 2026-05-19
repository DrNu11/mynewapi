/** @type {import('next').NextConfig} */
const path = require('path');
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  // 显式声明 @/* alias(2026-05-12:磁盘满后某些 build 环境 tsconfig paths 不生效,
  // 用 webpack alias 兜底确保 build 永远找得到 lib/components)
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname);
    return config;
  },
};

module.exports = nextConfig;
