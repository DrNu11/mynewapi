'use strict';

const state = {
  tab: 'models',
  data: null,
  loading: false
};

const MODEL_FIELD_DEFS = [
  { key: 'ratio', label: '模型倍率', placeholder: '0.6' },
  { key: 'price', label: '固定价格(ModelPrice)', placeholder: '按次固定价，可空' },
  { key: 'completionRatio', label: '补全倍率', placeholder: '可空' },
  { key: 'cacheRatio', label: '缓存倍率', placeholder: '可空' },
  { key: 'createCacheRatio', label: '创建缓存倍率', placeholder: '可空' },
  { key: 'imageRatio', label: '图片倍率', placeholder: '可空' },
  { key: 'audioRatio', label: '音频倍率', placeholder: '可空' },
  { key: 'audioCompletionRatio', label: '音频补全倍率', placeholder: '可空' },
  { key: 'billingMode', label: '计费模式', placeholder: '可空', text: true },
  { key: 'billingExpr', label: '计费表达式', placeholder: '可空', text: true }
];

const $ = (id) => document.getElementById(id);
const content = $('content');

function showLogin(message = '') {
  $('appShell').hidden = true;
  $('loginView').hidden = false;
  $('loginUsername').value = 'admin';
  const error = $('loginError');
  error.textContent = message;
  error.hidden = !message;
  setTimeout(() => $('loginPassword').focus(), 0);
}

function showApp(user = '') {
  $('loginView').hidden = true;
  $('appShell').hidden = false;
  $('userPill').hidden = !user;
  $('userPill').textContent = user ? `已登录 ${user}` : '';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function toInput(value) {
  return value === null || value === undefined ? '' : String(value);
}

function fmtDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function toast(message, bad = false) {
  const node = $('toast');
  node.textContent = message;
  node.classList.toggle('bad', bad);
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    node.hidden = true;
  }, 3800);
}

async function api(path, options = {}) {
  const url = new URL(path, window.location.href);
  url.username = '';
  url.password = '';

  const response = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const text = await response.text();
  let payload = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok || payload.ok === false || payload.success === false) {
    const error = new Error(payload.error || payload.message || response.statusText);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function post(path, body) {
  return api(path, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

function setSyncStatus(text, mode) {
  const node = $('syncStatus');
  node.textContent = text;
  node.classList.toggle('ok', mode === 'ok');
  node.classList.toggle('bad', mode === 'bad');
}

async function loadState() {
  if (state.loading) return;
  state.loading = true;
  setSyncStatus('同步中', '');
  try {
    const data = await api('/api/state');
    state.data = data;
    fillStats();
    fillDatalist();
    render();
    setSyncStatus('已连接', 'ok');
  } catch (error) {
    if (error.status === 401) {
      setSyncStatus('未登录', 'bad');
      showLogin();
      return;
    }
    setSyncStatus('连接失败', 'bad');
    content.innerHTML = `<div class="empty">加载失败：${esc(error.message)}</div>`;
  } finally {
    state.loading = false;
  }
}

async function bootstrap() {
  try {
    const session = await api('/api/session');
    if (session.authenticated) {
      showApp(session.user || 'admin');
      await loadState();
      return;
    }
  } catch {
    // Treat a session check failure as logged out; the login form can still report details.
  }
  showLogin();
}

function fillStats() {
  const stats = state.data?.stats || {};
  $('statEnabled').textContent = stats.enabledModels ?? '-';
  $('statConfigured').textContent = stats.configuredModels ?? '-';
  $('statUnpriced').textContent = stats.unpricedModels ?? '-';
  $('statGroups').textContent = stats.groups ?? '-';
  $('updatedAt').textContent = state.data?.generatedAt ? `更新于 ${fmtDate(state.data.generatedAt)}` : '未加载';
}

function fillDatalist() {
  const rows = state.data?.models || [];
  $('modelList').innerHTML = rows.map((row) => `<option value="${esc(row.model)}"></option>`).join('');
}

function currentRows() {
  const query = $('searchInput').value.trim().toLowerCase();
  const data = state.data;
  if (!data) return [];

  let rows = [];
  if (state.tab === 'models') rows = data.models || [];
  if (state.tab === 'unpriced') rows = data.unpriced || [];
  if (state.tab === 'groups') rows = data.groups || [];
  if (state.tab === 'deletedHistory') rows = data.deletedHistory || [];
  if (state.tab === 'backups') rows = data.backups || [];

  if (!query) return rows;

  return rows.filter((row) => {
    const haystack = JSON.stringify(row).toLowerCase();
    return haystack.includes(query);
  });
}

function statusTag(row) {
  if (row.status === 'fixed') return '<span class="tag fixed">固定价格</span>';
  if (row.status === 'ratio') return '<span class="tag enabled">倍率</span>';
  if (row.status === 'expression') return '<span class="tag fixed">表达式</span>';
  if (row.status === 'custom') return '<span class="tag fixed">自定义</span>';
  if (row.status === 'live') return '<span class="tag live">NewAPI实时</span>';
  return '<span class="tag warn">未定价</span>';
}

function priceText(value) {
  return value || '-';
}

function primaryDisplaySummary(row) {
  const pricing = row.displayPricing;
  if (!pricing) return '';

  if (pricing.mode === 'dynamic') {
    return '<span class="market-price">广场动态计费</span>';
  }

  const primary = pricing.primary;
  if (!primary) return '';

  if (pricing.mode === 'request') {
    return `
      <span class="market-price">广场按次 ${esc(priceText(primary.fixed))}</span>
      <span>最低分组 ${esc(primary.group)} ×${esc(primary.groupRatio)}</span>
    `;
  }

  return `
    <span class="market-price">广场输入 ${esc(priceText(primary.input))}/1M</span>
    <span class="market-price">广场输出 ${esc(priceText(primary.output))}/1M</span>
    <span class="market-price">广场缓存 ${esc(priceText(primary.cache))}/1M</span>
    <span>最低分组 ${esc(primary.group)} ×${esc(primary.groupRatio)}</span>
  `;
}

function groupPricePreview(row) {
  const groups = row.displayPricing?.groups || [];
  if (!groups.length) return '';

  return `
    <div class="group-price-preview">
      ${groups.map((item) => {
        if (row.displayPricing.mode === 'request') {
          return `<span><b>${esc(item.group)}</b> ×${esc(item.groupRatio)} 按次 ${esc(priceText(item.fixed))}</span>`;
        }
        return `<span><b>${esc(item.group)}</b> ×${esc(item.groupRatio)} 输入 ${esc(priceText(item.input))}/1M 输出 ${esc(priceText(item.output))}/1M 缓存 ${esc(priceText(item.cache))}/1M</span>`;
      }).join('')}
    </div>
  `;
}

function priceSummary(row) {
  const live = row.livePricing || {};
  const configured = row.configured || {};
  const liveModel = live.model && live.model !== row.model ? `<span class="case-note">实时匹配 ${esc(live.model)}</span>` : '';
  return `
    <div class="price-summary">
      ${primaryDisplaySummary(row)}
      <span>原始模型倍率 ${esc(toInput(live.modelRatio) || '-')}</span>
      <span>原始补全倍率 ${esc(toInput(live.completionRatio) || '-')}</span>
      <span>原始缓存倍率 ${esc(toInput(live.cacheRatio) || '-')}</span>
      <span>配置固定价 ${esc(toInput(configured.price) || '-')}</span>
      <span>配置模型倍率 ${esc(toInput(configured.ratio) || '-')}</span>
      ${liveModel}
    </div>
    ${groupPricePreview(row)}
  `;
}

function groupTags(row) {
  const tags = [];
  tags.push(row.enabled ? '<span class="tag enabled">启用</span>' : '<span class="tag danger">未启用</span>');
  for (const group of row.groups || []) {
    tags.push(`<span class="tag">${esc(group)}</span>`);
  }
  return `<div class="tag-row">${tags.join('')}</div>`;
}

function modelFields(row) {
  return MODEL_FIELD_DEFS.map((field) => `
    <label class="field">
      <span>${esc(field.label)}</span>
      <input
        data-field="${esc(field.key)}"
        ${field.text ? '' : 'inputmode="decimal"'}
        value="${esc(toInput(row[field.key]))}"
        placeholder="${esc(field.placeholder)}"
      />
    </label>
  `).join('');
}

function modelTable(rows, unpricedOnly = false) {
  if (!rows.length) return '<div class="empty">没有匹配记录</div>';
  return `
    <div class="model-list">
      ${rows.map((row) => `
        <article class="model-row" data-model="${esc(row.model)}" data-status="${esc(row.status)}">
          <div class="model-row-head">
            <div class="model-title">
              <div class="model-name">${esc(row.model)}</div>
              <div class="tag-row">${statusTag(row)}${groupTags(row).replace('<div class="tag-row">', '').replace('</div>', '')}</div>
              ${priceSummary(row)}
            </div>
            <div class="actions model-actions">
              <button class="button primary" data-action="save-current" type="button">${unpricedOnly ? '保存价格' : '保存当前'}</button>
              <button class="button ghost" data-action="save-ratio" type="button">按倍率保存</button>
              <button class="button ghost" data-action="save-fixed" type="button">按固定价格保存</button>
              <button class="button danger soft-danger" data-action="delete-model" type="button">删除价格配置</button>
              ${row.enabled
                ? '<button class="button danger" data-action="disable-model" type="button">禁用模型</button>'
                : '<button class="button enable" data-action="enable-model" type="button">启用模型</button>'}
            </div>
          </div>
          <div class="price-grid">
            ${modelFields(row)}
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function groupsTable(rows) {
  const addRow = `
    <tr data-group="">
      <td><input data-field="newGroup" placeholder="新分组名" /></td>
      <td><input data-field="newRatio" inputmode="decimal" placeholder="1" /></td>
      <td>-</td>
      <td>-</td>
      <td>
        <button class="button primary" data-action="add-group" type="button">新增</button>
      </td>
    </tr>
  `;

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width: 28%">分组</th>
            <th style="width: 16%">GroupRatio</th>
            <th style="width: 16%">Topup</th>
            <th style="width: 16%">GroupGroup</th>
            <th style="width: 24%">操作</th>
          </tr>
        </thead>
        <tbody>
          ${addRow}
          ${rows.map((row) => `
            <tr data-group="${esc(row.group)}">
              <td><div class="model-name">${esc(row.group)}</div></td>
              <td><input class="cell-input" data-field="ratio" inputmode="decimal" value="${esc(toInput(row.ratio))}" placeholder="1" /></td>
              <td>${esc(toInput(row.topupRatio)) || '-'}</td>
              <td>${esc(toInput(row.groupGroupRatio)) || '-'}</td>
              <td>
                <div class="actions">
                  <button class="button primary" data-action="save-group" type="button">保存</button>
                  <button class="button danger" data-action="delete-group" type="button">删倍率</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function backupsList(rows) {
  if (!rows.length) return '<div class="empty">暂无备份</div>';
  return `
    <div class="backup-list">
      ${rows.map((row) => `
        <article class="backup-item">
          <div>
            <div class="backup-title">${esc(row.id)}</div>
            <div class="backup-meta">${esc(row.action || '-')} · ${esc(fmtDate(row.createdAt))} · ${esc(row.keys)} keys · ${esc(row.channels || 0)} channels</div>
          </div>
          <button class="button danger" data-action="rollback" data-backup="${esc(row.id)}" type="button">回滚</button>
        </article>
      `).join('')}
    </div>
  `;
}

function deletedHistoryList(rows) {
  if (!rows.length) return '<div class="empty">暂无删除历史。点“禁用模型”后，这里会出现可恢复记录。</div>';
  return `
    <div class="backup-list">
      ${rows.map((row) => `
        <article class="backup-item">
          <div>
            <div class="backup-title">${esc(row.model || '-')}</div>
            <div class="backup-meta">${esc(fmtDate(row.createdAt))} · ${esc(row.channels || 0)} channels · ${esc(row.id)}</div>
          </div>
          <div class="actions">
            <button class="button enable" data-action="enable-history" data-model="${esc(row.model || '')}" data-backup="${esc(row.id)}" type="button">启用/恢复</button>
            <button class="button ghost" data-action="rollback" data-backup="${esc(row.id)}" type="button">完整回滚</button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function render() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === state.tab);
  });

  const rows = currentRows();
  if (state.tab === 'models') content.innerHTML = modelTable(rows, false);
  if (state.tab === 'unpriced') content.innerHTML = modelTable(rows, true);
  if (state.tab === 'groups') content.innerHTML = groupsTable(rows);
  if (state.tab === 'deletedHistory') content.innerHTML = deletedHistoryList(rows);
  if (state.tab === 'backups') content.innerHTML = backupsList(rows);
}

function rowModel(button) {
  const row = button.closest('[data-model]');
  const data = { row, model: row?.dataset.model || '', status: row?.dataset.status || '' };
  for (const field of MODEL_FIELD_DEFS) {
    data[field.key] = row?.querySelector(`[data-field="${field.key}"]`)?.value.trim();
  }
  return {
    ...data,
    ratio: data.ratio || '',
    price: data.price || ''
  };
}

function inferPricingType(data) {
  if (data.status === 'fixed' && data.price !== '') return 'fixed';
  if (data.status === 'ratio' && data.ratio !== '') return 'ratio';
  if (data.price !== '' && data.ratio === '') return 'fixed';
  return 'ratio';
}

async function saveModelFromRow(button, pricingType) {
  const data = rowModel(button);
  const type = pricingType || inferPricingType(data);
  const value = type === 'fixed' ? data.price : data.ratio;
  if (!data.model || value === '') {
    toast(type === 'fixed' ? '模型和固定价格不能为空' : '模型和模型倍率不能为空', true);
    return;
  }

  button.disabled = true;
  try {
    const result = await post('/api/models/upsert', {
      model: data.model,
      pricingType: type,
      value,
      completionRatio: data.completionRatio,
      cacheRatio: data.cacheRatio,
      createCacheRatio: data.createCacheRatio,
      imageRatio: data.imageRatio,
      audioRatio: data.audioRatio,
      audioCompletionRatio: data.audioCompletionRatio,
      billingMode: data.billingMode,
      billingExpr: data.billingExpr
    });
    state.data = result.state;
    fillStats();
    render();
    toast(`已保存 ${data.model}`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function deleteModelFromRow(button) {
  const data = rowModel(button);
  if (!data.model) return;
  if (!confirm(`删除 ${data.model} 的所有价格配置？\n\n只清理模型倍率、固定价格、补全倍率、缓存倍率、图片/音频倍率和自定义计费配置。\n不会影响模型是否可调用。`)) return;

  button.disabled = true;
  try {
    const result = await post('/api/models/delete', { model: data.model });
    state.data = result.state;
    fillStats();
    render();
    toast(`已删除 ${data.model} 的价格配置`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function deleteModelByName(model) {
  const name = String(model || '').trim();
  if (!name) {
    toast('先输入模型名', true);
    return;
  }
  if (!confirm(`删除 ${name} 的所有价格配置？\n\n这个操作不会下架模型。`)) return;

  const button = $('quickDeleteModel');
  button.disabled = true;
  try {
    const result = await post('/api/models/delete', { model: name });
    state.data = result.state;
    fillStats();
    fillDatalist();
    render();
    toast(`已删除 ${name} 的价格配置`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function disableModelByName(model, button) {
  const name = String(model || '').trim();
  if (!name) {
    toast('先输入模型名', true);
    return;
  }

  let bindings;
  try {
    bindings = await api(`/api/models/bindings?model=${encodeURIComponent(name)}`);
  } catch (error) {
    toast(error.message, true);
    return;
  }

  const channelLines = (bindings.channels || [])
    .slice(0, 8)
    .map((channel) => `#${channel.id} ${channel.name || '-'} (${channel.modelCount} models)`)
    .join('\n');
  const more = bindings.count > 8 ? `\n其余 ${bindings.count - 8} 个渠道不展开显示。` : '';
  const detail = bindings.count > 0 ? `\n\n影响渠道：\n${channelLines}${more}` : '\n\n当前没有渠道绑定它；会继续清理价格配置。';
  const ok = confirm(`禁用模型 ${name}？\n\n执行后模型广场不会显示，/v1/models 不会返回，用户调用也找不到可用渠道。系统会先自动备份，可在备份页回滚。${detail}`);
  if (!ok) return;

  button.disabled = true;
  try {
    const result = await post('/api/models/disable', { model: name });
    state.data = result.state;
    fillStats();
    fillDatalist();
    render();
    toast(`已禁用 ${name}，影响 ${result.affectedChannels?.length || 0} 个渠道`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function latestDeleteHistory(model) {
  const name = String(model || '').trim();
  return (state.data?.deletedHistory || []).find((row) => row.model === name);
}

async function enableModelByName(model, button, backupId) {
  const name = String(model || '').trim();
  if (!name) {
    toast('先输入模型名', true);
    return;
  }

  const history = backupId ? { id: backupId } : latestDeleteHistory(name);
  if (!history?.id) {
    toast(`没有 ${name} 的删除历史，不能自动恢复到渠道`, true);
    return;
  }

  const ok = confirm(`启用/恢复模型 ${name}？\n\n会从删除历史恢复它绑定过的渠道，并恢复这个模型自己的价格配置。不会整包回滚其它模型。`);
  if (!ok) return;

  button.disabled = true;
  try {
    const result = await post('/api/models/enable', { model: name, backupId: history.id });
    state.data = result.state;
    fillStats();
    fillDatalist();
    render();
    toast(`已启用 ${name}，恢复 ${result.affectedChannels?.length || 0} 个渠道`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function saveGroup(button) {
  const row = button.closest('tr');
  const group = row.dataset.group || row.querySelector('[data-field="newGroup"]')?.value.trim() || '';
  const ratio = row.querySelector('[data-field="ratio"]')?.value.trim() || row.querySelector('[data-field="newRatio"]')?.value.trim() || '';
  if (!group || ratio === '') {
    toast('分组和倍率不能为空', true);
    return;
  }

  button.disabled = true;
  try {
    const result = await post('/api/groups/upsert', { group, ratio });
    state.data = result.state;
    fillStats();
    render();
    toast(`已保存分组 ${group}`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function deleteGroup(button) {
  const row = button.closest('tr');
  const group = row.dataset.group || '';
  if (!group) return;
  if (!confirm(`删除 ${group} 的 GroupRatio 倍率？`)) return;

  button.disabled = true;
  try {
    const result = await post('/api/groups/delete', { group });
    state.data = result.state;
    fillStats();
    render();
    toast(`已删除分组 ${group} 的倍率`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function rollback(button) {
  const backupId = button.dataset.backup;
  if (!backupId) return;
  if (!confirm(`回滚到 ${backupId}？当前配置会先自动备份。`)) return;

  button.disabled = true;
  try {
    const result = await post('/api/backups/rollback', { backupId });
    state.data = result.state;
    fillStats();
    render();
    toast(`已回滚到 ${backupId}`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.tab = tab.dataset.tab;
    render();
  });
});

$('refreshBtn').addEventListener('click', loadState);
$('searchInput').addEventListener('input', render);

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter || $('loginSubmit');
  const originalText = button?.textContent || '登录';
  const username = $('loginUsername').value.trim() || 'admin';
  const password = $('loginPassword').value;
  $('loginUsername').value = username;
  if (!password) {
    showLogin('请输入密码');
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = '登录中...';
  }
  try {
    const result = await post('/api/login', { username, password });
    $('loginPassword').value = '';
    showApp(result.user || username);
    await loadState();
  } catch (error) {
    showLogin(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
});

$('logoutBtn').addEventListener('click', async () => {
  try {
    await post('/api/logout', {});
  } catch {
    // Logging out locally is still fine if the session already expired.
  }
  state.data = null;
  content.innerHTML = '';
  showLogin();
});

$('modelForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const model = $('modelName').value.trim();
  const pricingType = $('pricingType').value;
  const value = $('pricingValue').value.trim();
  if (!model || !value) {
    toast('模型和数值不能为空', true);
    return;
  }

  const button = event.submitter || $('quickSaveModel');
  if (button) button.disabled = true;
  try {
    const result = await post('/api/models/upsert', { model, pricingType, value });
    state.data = result.state;
    fillStats();
    fillDatalist();
    render();
    $('pricingValue').value = '';
    toast(`已保存 ${model}`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
});

content.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  if (action === 'save-current') saveModelFromRow(button);
  if (action === 'save-ratio') saveModelFromRow(button, 'ratio');
  if (action === 'save-fixed') saveModelFromRow(button, 'fixed');
  if (action === 'delete-model') deleteModelFromRow(button);
  if (action === 'disable-model') disableModelByName(rowModel(button).model, button);
  if (action === 'enable-model') enableModelByName(rowModel(button).model, button);
  if (action === 'enable-history') enableModelByName(button.dataset.model, button, button.dataset.backup);
  if (action === 'save-group' || action === 'add-group') saveGroup(button);
  if (action === 'delete-group') deleteGroup(button);
  if (action === 'rollback') rollback(button);
});

$('quickDeleteModel').addEventListener('click', () => {
  deleteModelByName($('modelName').value);
});

$('quickEnableModel').addEventListener('click', () => {
  enableModelByName($('modelName').value, $('quickEnableModel'));
});

$('quickDisableModel').addEventListener('click', () => {
  disableModelByName($('modelName').value, $('quickDisableModel'));
});

bootstrap();
