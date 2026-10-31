/**
 * client.js —— 大肥鱼表情包设置页（注入 DSH 设置界面）
 * 自包含原生 JS：优先通过 /api/dfy-bqb/config 读写；后端路由缺失时降级 localStorage。
 */
const API = '/api/dfy-bqb/config';
const LS_KEY = 'dfy-bqb-config-draft';

const FIELDS = [
  { key: 'basePath', label: '底座 dsh-douyin-scroll 路径（留空自动发现）', type: 'text' },
  { key: 'dataDir', label: '数据目录（留空用 ~/.dsh/dfy-bqb）', type: 'text' },
  { key: 'ownerDropDir', label: '主人投放表情文件夹', type: 'text' },
  { key: 'enableDm', label: '启用私信表情回复', type: 'bool' },
  { key: 'enableComment', label: '启用评论区表情回复', type: 'bool' },
  { key: 'offline', label: '离线模式（Fake 通道，不连底座）', type: 'bool' },
  { key: 'dmStickerChance', label: '私信 文字+表情 概率', type: 'num' },
  { key: 'dmPureStickerChance', label: '私信 纯表情 概率', type: 'num' },
  { key: 'commentStickerChance', label: '评论区 文字+表情 概率', type: 'num' },
  { key: 'commentPureStickerChance', label: '评论区 纯表情 概率', type: 'num' },
  { key: 'dailyStickerLimit', label: '每日贴纸上限', type: 'int' },
  { key: 'perPeerStickerLimit', label: '同对象每日贴纸上限', type: 'int' },
  { key: 'pollIntervalSec', label: '轮询间隔（秒）', type: 'int' },
];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) node.appendChild(c);
  return node;
}

async function loadConfig() {
  try {
    const res = await fetch(API, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('bad status');
    return { cfg: await res.json(), backend: true };
  } catch {
    try { return { cfg: JSON.parse(localStorage.getItem(LS_KEY) || '{}'), backend: false }; }
    catch { return { cfg: {}, backend: false }; }
  }
}

async function saveConfig(cfg) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function mount(container) {
  const root = el('div', { style: 'font-family:inherit;padding:12px;max-width:720px' });
  const title = el('h3', {}, [document.createTextNode('大肥鱼表情包设置')]);
  const note = el('p', {
    style: 'color:#888;font-size:12px;margin:4px 0 12px',
  });
  root.appendChild(title);
  root.appendChild(note);

  const form = el('div');
  const inputs = {};
  for (const f of FIELDS) {
    const row = el('div', { style: 'margin-bottom:10px' });
    const label = el('label', {
      style: 'display:block;font-size:13px;margin-bottom:4px',
    }, [document.createTextNode(f.label)]);
    let input;
    if (f.type === 'bool') {
      input = el('input', { type: 'checkbox' });
    } else {
      input = el('input', {
        type: f.type === 'text' ? 'text' : 'number',
        style: 'width:100%;padding:6px;box-sizing:border-box',
      });
    }
    inputs[f.key] = { input, type: f.type };
    row.appendChild(label);
    row.appendChild(input);
    form.appendChild(row);
  }
  root.appendChild(form);

  const status = el('div', { style: 'font-size:12px;margin-top:8px;color:#2a7' });
  const saveBtn = el('button', {
    style: 'margin-top:12px;padding:8px 18px',
  }, [document.createTextNode('保存配置')]);
  root.appendChild(saveBtn);
  root.appendChild(status);

  loadConfig().then(({ cfg, backend }) => {
    note.textContent = backend
      ? '已连接后端配置接口，保存即生效。'
      : '后端路由不可用，配置仅保存在本页草稿（localStorage）。';
    for (const f of FIELDS) {
      const { input, type } = inputs[f.key];
      if (type === 'bool') input.checked = Boolean(cfg[f.key]);
      else if (cfg[f.key] !== undefined) input.value = cfg[f.key];
    }
  });

  saveBtn.addEventListener('click', async () => {
    const cfg = {};
    for (const f of FIELDS) {
      const { input, type } = inputs[f.key];
      if (type === 'bool') cfg[f.key] = input.checked;
      else if (type === 'text') cfg[f.key] = input.value;
      else cfg[f.key] = input.value === '' ? undefined : Number(input.value);
    }
    const ok = await saveConfig(cfg);
    status.textContent = ok ? '已保存到后端。' : '已保存到本页草稿（后端不可用）。';
  });

  container.innerHTML = '';
  container.appendChild(root);
  return root;
}

// 自启动：DSH 设置页若直接加载本脚本，挂到 #dfy-bqb-settings 或 body
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const host = document.getElementById('dfy-bqb-settings') || document.body;
    mount(host);
  });
}
