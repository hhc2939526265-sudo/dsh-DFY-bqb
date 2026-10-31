/**
 * dsh-dfy-bqb —— 大肥鱼表情包插件入口
 * ----------------------------------------------------------------------------
 * 挂载到 DSH（Cordis）后：
 *   1. 初始化表情库（BqbStore，JSON 索引，四来源 + 状态机）。
 *   2. 连接底座 dsh-douyin-scroll 的 MCP（找不到/离线则用 FakeMcpClient，插件照常激活）。
 *   3. 注册一组 bqb_* 工具供大肥鱼值班轮调用；情绪一致性由工具层硬闸保证，不靠 prompt 自觉。
 *   4. 定时轮询新私信/@，走「情绪→形态→匹配→闸→发送→计数」闭环。
 * 设计原则：任何宿主服务缺失都降级，绝不因单个依赖导致整条插件不激活。
 */
import { join } from 'node:path';
import { mergeConfig } from './lib/config.mjs';
import { BqbStore } from './lib/bqb-store.mjs';
import { McpClient, FakeMcpClient, discoverBasePath } from './lib/mcp-client.mjs';
import { BqbEngine } from './lib/engine.mjs';
import { resolveDataDir, log as makeLog } from './lib/util.mjs';
import { analyzeEmotion } from './lib/emotion.mjs';
import { searchAndDownload, ingestDownloads } from './sources/web-search.mjs';
import { deriveCaption, ingestDerived } from './sources/derive.mjs';
import { generateWithDoubao, ingestDoubaoImage } from './sources/doubao-driver.mjs';
import { scanOwnerDrop, defaultOwnerDropDir } from './sources/owner-drop.mjs';

export const name = 'dfy-bqb';
export const inject = ['tools', 'settings'];

// 本地 defineTool 兼容：宿主 dsh-tools 缺失时使用，仅做与宿主一致的 schema 硬校验
function localDefineTool(spec) {
  const check = (schema, where) => {
    if (!schema || typeof schema !== 'object') return;
    if (schema.type === 'object' && schema.additionalProperties === undefined) {
      throw new Error(`defineTool(${spec.name}): ${where} 是 object 却没写 additionalProperties`);
    }
    for (const [k, v] of Object.entries(schema.properties || {})) check(v, `${where}.${k}`);
  };
  check(spec.parameters, 'parameters');
  return spec;
}

export function apply(ctx, config) {
  const cfg = mergeConfig(config || {});
  const log = (mod, msg, extra) => makeLog(mod, msg, extra);
  if (!cfg.enabled) {
    log('dfy-bqb', '插件未启用，跳过激活');
    return;
  }

  const dataDir = resolveDataDir(cfg.dataDir);
  const store = new BqbStore(dataDir);

  // ---- MCP 生命周期：异步 ready，不阻塞插件激活 ----
  let mcp;
  if (cfg.offline) {
    mcp = new FakeMcpClient();
    mcp.ready = Promise.resolve();
    log('dfy-bqb', '配置为离线模式，使用 FakeMcpClient');
  } else {
    const basePath = discoverBasePath(cfg.basePath);
    if (basePath) {
      mcp = new McpClient(basePath, { log });
      mcp.ready = mcp.start().then(() => {
        log('dfy-bqb', '已连接底座 MCP', { basePath });
      }).catch((e) => {
        log('dfy-bqb', `底座 MCP 启动失败，降级 Fake：${e.message}`);
        mcp = new FakeMcpClient();
        mcp.ready = Promise.resolve();
      });
    } else {
      mcp = new FakeMcpClient();
      mcp.ready = Promise.resolve();
      log('dfy-bqb', '未找到底座，使用 FakeMcpClient（可离线自检/演示）');
    }
  }

  const engine = new BqbEngine(cfg, { store, mcp, logger: log });

  // ---- 工具注册适配 ----
  const defineTool = (typeof ctx?.tools?.defineTool === 'function')
    ? ctx.tools.defineTool
    : localDefineTool;
  function registerTool(spec) {
    const defined = defineTool(spec);
    if (ctx?.tools?.register) {
      ctx.tools.register(defined);
    } else {
      log('dfy-bqb', `宿主无 tools.register，工具 ${spec.name} 仅本地可见`);
    }
  }

  const textOut = { schema: { type: 'string' } };
  const str = (name_, desc, required = [], properties = {}) => ({
    name: name_,
    description: desc,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    output: textOut,
  });

  // 1. 库状态
  registerTool({
    ...str('bqb_status', '查看大肥鱼表情库状态：各审核状态数量、今日贴纸计数'),
    async execute() {
      return JSON.stringify({
        total: store.all().length,
        pending: store.listByStatus('pending').length,
        approved: store.listByStatus('approved').length,
        blocked: store.listByStatus('blocked').length,
        todayTotal: store.dailyStickerCount(),
        dataDir,
      });
    },
  });

  // 2. 情绪分析
  registerTool({
    ...str('bqb_analyze_text', '对一段文本做情绪+意图分析（规则引擎，无需联网）',
      ['text'], { text: { type: 'string', description: '待分析文本' } }),
    async execute(args) {
      return JSON.stringify(analyzeEmotion(args.text));
    },
  });

  // 3. 待审列表
  registerTool({
    ...str('bqb_pending_list', '列出待审核表情（只有 approved 才能发出去）'),
    async execute() {
      return JSON.stringify(store.listByStatus('pending').map((s) => ({
        id: s.id, emotion: s.emotion, tags: s.tags, source: s.source, path: s.path,
      })));
    },
  });

  // 4. 审核
  registerTool({
    ...str('bqb_review', '审核一张表情：approve 允许发送 / block 拉黑',
      ['id', 'decision'],
      {
        id: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'block'] },
      }),
    async execute(args) {
      const r = store.updateStatus(args.id, args.decision === 'approve' ? 'approved' : 'blocked');
      return JSON.stringify(r.sticker ? { ok: true, id: r.sticker.id, status: r.sticker.status } : r);
    },
  });

  // 5. 网搜
  registerTool({
    ...str('bqb_web_search', '来源①：在网上搜索并下载表情包（默认 pending 待审核）',
      ['query'],
      {
        query: { type: 'string' },
        emotion: { type: 'string', enum: ['happy', 'sad', 'angry', 'shy', 'confused', 'daily'] },
      }),
    async execute(args) {
      if (!cfg.webSearch.enabled) return JSON.stringify({ ok: false, reason: '网搜已关闭' });
      const batch = await searchAndDownload({
        query: args.query,
        emotion: args.emotion || 'daily',
        workDir: dataDir,
        maxCandidates: cfg.webSearch.maxCandidates,
      });
      const ingested = ingestDownloads(store, batch);
      return JSON.stringify({
        ok: true, downloaded: batch.downloaded.length,
        errors: batch.errors.length, ingested: ingested.length,
      });
    },
  });

  // 6. 二创
  registerTool({
    ...str('bqb_derive', '来源②：给库中已有表情加字幕二创（默认 pending 待审核）',
      ['baseId'],
      {
        baseId: { type: 'string' },
        topText: { type: 'string' },
        bottomText: { type: 'string' },
      }),
    async execute(args) {
      if (!cfg.derive.enabled) return JSON.stringify({ ok: false, reason: '二创已关闭' });
      const base = store.get(args.baseId);
      if (!base) return JSON.stringify({ ok: false, reason: '底图不存在' });
      const derived = await deriveCaption({
        baseImage: base.path,
        topText: args.topText || '',
        bottomText: args.bottomText || '',
        workDir: dataDir,
      });
      const r = ingestDerived(store, derived, base.emotion, base.tags);
      return JSON.stringify(r.sticker ? { ok: true, id: r.sticker.id } : r);
    },
  });

  // 7. 豆包生图
  registerTool({
    ...str('bqb_doubao_generate', '来源③：调用电脑豆包 app 原创生图（需豆包已登录；默认 pending）',
      ['prompt'],
      {
        prompt: { type: 'string' },
        emotion: { type: 'string', enum: ['happy', 'sad', 'angry', 'shy', 'confused', 'daily'] },
        dryRun: { type: 'boolean' },
      }),
    async execute(args) {
      if (!cfg.doubao.enabled && !args.dryRun) {
        return JSON.stringify({ ok: false, reason: '豆包生图未启用（设置里打开 doubao.enabled）' });
      }
      const generated = await generateWithDoubao({
        config: cfg.doubao,
        prompt: args.prompt,
        emotion: args.emotion || 'daily',
        workDir: dataDir,
        dryRun: Boolean(args.dryRun),
      });
      if (generated.dryRun) return JSON.stringify(generated);
      const r = ingestDoubaoImage(store, generated);
      return JSON.stringify(r.sticker ? { ok: true, id: r.sticker.id, path: generated.path } : r);
    },
  });

  // 8. 主人投放扫描
  registerTool({
    ...str('bqb_owner_scan', '来源④：扫描主人投放文件夹，新图自动入库（默认 approved）'),
    async execute() {
      const dir = cfg.ownerDropDir || defaultOwnerDropDir();
      return JSON.stringify(scanOwnerDrop(store, dir));
    },
  });

  // 9. 手动处理一条文本（完整闭环，默认 dryRun）
  registerTool({
    ...str('bqb_handle', '对一条文本走完整情绪→匹配→闸→发送流程（默认 dryRun 不真发）',
      ['scene', 'text'],
      {
        scene: { type: 'string', enum: ['dm', 'comment'] },
        text: { type: 'string' },
        peer: { type: 'string' },
        dryRun: { type: 'boolean' },
      }),
    async execute(args) {
      await mcp.ready;
      const r = await engine.processIncoming({
        scene: args.scene,
        text: args.text,
        peer: args.peer || '',
        dryRun: args.dryRun !== false,
      });
      return JSON.stringify(r);
    },
  });

  // 10. 手动轮询
  registerTool({
    ...str('bqb_poll', '手动触发一次底座新私信/@轮询（默认 dryRun）',
      [],
      { dryRun: { type: 'boolean' } }),
    async execute(args) {
      await mcp.ready;
      const outcomes = await engine.pollOnce({ dryRun: args.dryRun !== false });
      return JSON.stringify({ ok: true, count: outcomes.length, outcomes });
    },
  });

  // ---- 定时轮询 ----
  const intervalMs = Math.max(15, cfg.pollIntervalSec) * 1000;
  const timer = setInterval(() => {
    Promise.resolve(mcp.ready)
      .then(() => engine.pollOnce())
      .then((r) => { if (r.length) log('dfy-bqb', `轮询处理 ${r.length} 条`); })
      .catch((e) => log('dfy-bqb', `轮询异常：${e.message}`));
  }, intervalMs);

  // 启动时先扫一次主人投放（不报错即成功）
  try {
    const dropDir = cfg.ownerDropDir || defaultOwnerDropDir();
    const scan = scanOwnerDrop(store, dropDir);
    if (scan.added.length) log('dfy-bqb', `启动扫描到 ${scan.added.length} 张主人投放`);
  } catch (e) {
    log('dfy-bqb', `启动投放扫描失败：${e.message}`);
  }

  // ---- 可选：设置页后端路由（宿主有 webServer 才注册，缺失则 client.js 降级 localStorage）----
  try {
    if (ctx?.webServer?.register) {
      const runtimeConfig = { get: () => cfg, file: join(dataDir, 'runtime-config.json') };
      ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/api/dfy-bqb',
        handler: async (req, res) => {
          const send = (code, obj) => {
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(obj));
          };
          const u = new URL(req.url, 'http://127.0.0.1');
          if (req.method === 'GET' && u.pathname === '/config') return send(200, runtimeConfig.get);
          if (req.method === 'POST' && u.pathname === '/config') {
            const body = await new Promise((r) => {
              let b = '';
              req.on('data', (c) => { b += c; });
              req.on('end', () => r(b));
            });
            try {
              const parsed = JSON.parse(body || '{}');
              Object.assign(cfg, mergeConfig(parsed));
              return send(200, { ok: true });
            } catch (e) {
              return send(400, { ok: false, error: e.message });
            }
          }
          return send(404, { ok: false, error: 'not found' });
        },
      }), 'dfy-bqb: /api/dfy-bqb 路由');
    }
  } catch (e) {
    log('dfy-bqb', `设置页路由未注册：${e.message}`);
  }

  ctx.effect(() => () => {
    clearInterval(timer);
    try { mcp.stop(); } catch { /* ignore */ }
  }, 'dfy-bqb: 清理轮询定时器与 MCP');

  log('dfy-bqb', '已挂载', {
    dataDir,
    dm: cfg.enableDm,
    comment: cfg.enableComment,
    interval: cfg.pollIntervalSec,
    approved: store.listByStatus('approved').length,
  });
}
