#!/usr/bin/env node
/**
 * NassaAPI Codex CLI 一键智能配置脚本
 *
 * 功能:
 *  - 自动备份现有 ~/.codex/config.toml 和 ~/.codex/auth.json
 *  - 智能合并:删除所有 [model_providers.*] 段和顶层冲突键
 *  - 注入正确的 NassaAPI 配置 (model_provider, base_url, wire_api 等)
 *  - 保留客户已有的 [mcp_servers.*], [projects.*], [features], [notice.*] 等段
 *  - 同时写入 auth.json (auth_mode=apikey + OPENAI_API_KEY)
 *
 * 用法:
 *   node codex-setup.js <sk-key>
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function main() {
  const sk = (process.argv[2] || '').trim();
  if (!sk) {
    console.error('用法: node codex-setup.js <sk-key>');
    console.error('  从 NassaAPI 卡密激活页拿到的 sk-xxx 密钥');
    process.exit(1);
  }
  if (!sk.match(/^[A-Za-z0-9_\-]{20,}$/)) {
    console.error('❌ sk-key 格式异常,请检查是否完整:');
    console.error(`   ${sk.slice(0, 12)}... (长度 ${sk.length})`);
    process.exit(1);
  }

  const codexDir = path.join(os.homedir(), '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  const cfgPath = path.join(codexDir, 'config.toml');
  const authPath = path.join(codexDir, 'auth.json');
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.]/g, '')
    .slice(0, 14);

  // 1. 备份现有
  let oldCfg = '';
  if (fs.existsSync(cfgPath)) {
    oldCfg = fs.readFileSync(cfgPath, 'utf-8');
    fs.writeFileSync(cfgPath + `.bak.${ts}`, oldCfg);
  }
  if (fs.existsSync(authPath)) {
    fs.writeFileSync(
      authPath + `.bak.${ts}`,
      fs.readFileSync(authPath, 'utf-8')
    );
  }

  // 2. 清理旧 config (基于行的简单 TOML 段处理):
  //    - 删除所有 [model_providers.*] 段及其内容
  //    - 在所有位置(顶层或任何非 [model_providers.*] 段内)删除冲突键
  //      因为这些键名只该出现在 [model_providers.*] 段下,出现在其他位置都是错位
  const stripKeys = new Set([
    'model_provider',
    'model',
    'model_reasoning_effort',
    'disable_response_storage',
    'request_max_retries',
    'stream_max_retries',
    'stream_idle_timeout_ms',
    'base_url',
    'wire_api',
    'requires_openai_auth',
  ]);

  const lines = oldCfg.split(/\r?\n/);
  const out = [];
  let inProviderSection = false;
  // 跟踪 [tui.model_availability_nux] 段(CC Switch 的 bug 高危区)
  // 这个段是 codex 的 model→u32 计数器 map,合法行只能是 `<model_name> = <数字>`
  // CC Switch 等工具会把 base_url / 其他键错位塞进来,需要按段清理
  let inTuiNuxSection = false;
  // 旧版用 `model_availability_nux = "url"` 写法的兼容(顶层错位)
  // 新版 CC Switch (v3.12.2-) 写成 `[tui.model_availability_nux]` 段 + 段内错位

  for (const raw of lines) {
    const trimmed = raw.trim();
    // 段头检测
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (trimmed.startsWith('[model_providers.')) {
        inProviderSection = true;
        inTuiNuxSection = false;
        continue; // 整个段头丢(我们后面统一重写 [model_providers.nassaapi])
      }
      inProviderSection = false;
      // 检测进入 [tui.model_availability_nux] 段
      inTuiNuxSection = trimmed === '[tui.model_availability_nux]';
      out.push(raw);
      continue;
    }
    if (inProviderSection) continue; // [model_providers.*] 段内整体丢

    // [tui.model_availability_nux] 段内:严格只保留合法 NUX 计数器行
    //   合法格式: "model-name" = 数字  或  model_name = 数字
    //   任何其他格式(尤其值为字符串/URL)都视为 CC Switch 错位写入,清掉
    if (inTuiNuxSection) {
      if (trimmed === '' || trimmed.startsWith('#')) {
        out.push(raw);
        continue;
      }
      // 合法:key = <整数>
      if (/^"?[A-Za-z0-9_.-]+"?\s*=\s*\d+\s*$/.test(trimmed)) {
        out.push(raw);
        continue;
      }
      // 不合法 → 错位,跳过
      continue;
    }

    // 任何位置的冲突键都删 (这些键只该在 [model_providers.*] 段内合法存在)
    const m = raw.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
    if (m && stripKeys.has(m[1])) continue;
    // 老版 CC Switch / 手动编辑可能把 URL 字符串错位写成顶层
    // `model_availability_nux = "url"`(合法类型是 u32),也清掉
    if (m && m[1] === 'model_availability_nux' && /=\s*"/.test(raw)) continue;
    out.push(raw);
  }
  let cleaned = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // 3. 拼接 NassaAPI 配置 + 客户保留段
  const nassaBlock =
    `# NassaAPI Codex 配置 (此段由 codex-setup.js 自动生成,可手动修改)
model_provider = "nassaapi"
model = "gpt-5.5"
model_reasoning_effort = "high"
disable_response_storage = true
request_max_retries = 5
stream_max_retries = 5
stream_idle_timeout_ms = 300000

[model_providers.nassaapi]
name = "NassaAPI"
base_url = "https://api.nassaapi.xyz/v1"
wire_api = "responses"
requires_openai_auth = true
`;

  const finalCfg = nassaBlock + (cleaned ? '\n' + cleaned + '\n' : '');
  fs.writeFileSync(cfgPath, finalCfg, 'utf-8');

  // 4. 写 auth.json
  fs.writeFileSync(
    authPath,
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: sk }) + '\n',
    'utf-8'
  );

  // 5. 报告
  console.log('');
  console.log('✅ NassaAPI Codex 配置完成');
  console.log(`   config: ${cfgPath}`);
  console.log(`   auth:   ${authPath}`);
  if (oldCfg) {
    console.log(`   备份:   ${cfgPath}.bak.${ts}`);
    console.log('   ↳ 已保留你原有的 [mcp_servers.*] / [projects.*] / [features] 等配置');
  }
  console.log('');
  console.log('   下一步:运行 codex 命令即可开始使用');
  console.log('');
}

try {
  main();
} catch (e) {
  console.error('❌ 配置失败:', e && e.message ? e.message : e);
  process.exit(1);
}
