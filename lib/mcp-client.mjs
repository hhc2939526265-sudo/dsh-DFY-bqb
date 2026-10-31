// 底座 MCP 客户端：spawn dsh-douyin-scroll 的 tools/mcp-server.mjs，通过 stdio JSON-RPC 调用底座能力。
// 零侵入、解耦；离线/无底座时用 FakeMcpClient，保证插件可独立加载与自检。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { sleep } from './util.mjs';

const PROTOCOL_VERSION = '2025-06-18';

// 自动发现底座安装路径
export function discoverBasePath(configured) {
  const candidates = [];
  if (configured && configured.trim()) candidates.push(configured.trim());
  const home = homedir();
  candidates.push(
    join(home, '.dsh', 'plugins', 'dsh-douyin-scroll'),
    join(home, '.dsh', 'dsh-douyin-scroll'),
    join(home, 'dsh-plugins', 'dsh-douyin-scroll'),
    'D:\\dsh-plugins\\dsh-douyin-scroll',
  );
  return candidates.find((p) => existsSync(join(p, 'tools', 'mcp-server.mjs'))) || null;
}

export class McpClient {
  constructor(basePath, opts = {}) {
    this.basePath = basePath;
    this.serverScript = join(basePath, 'tools', 'mcp-server.mjs');
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.ready = false;
    this.proc = null;
    this.log = opts.log || (() => {});
    this.defaultTimeout = opts.timeoutMs || 30000;
  }

  start() {
    return new Promise((resolve, reject) => {
      if (!existsSync(this.serverScript)) {
        reject(new Error(`底座 MCP server 不存在：${this.serverScript}`));
        return;
      }
      this.proc = spawn(process.execPath, [this.serverScript], {
        cwd: this.basePath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (chunk) => this.onData(chunk));
      this.proc.stderr.on('data', (c) => this.log('mcp-stderr', String(c).trim()));
      this.proc.on('exit', (code) => {
        this.ready = false;
        this.failAll(new Error(`MCP server 退出 code=${code}`));
      });

      this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'dsh-dfy-bqb', version: '0.1.0' },
      }, 15000).then((result) => {
        this.serverInfo = result.serverInfo || {};
        this.notify('notifications/initialized');
        this.ready = true;
        resolve(result);
      }).catch(reject);
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'MCP error'));
        else resolve(msg.result);
      }
    }
  }

  request(method, params, timeoutMs = this.defaultTimeout) {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params: params || {} };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n');
  }

  async callTool(name, args = {}, timeoutMs) {
    const result = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    if (result.isError) {
      const text = (result.content || []).map((c) => c.text).join('');
      throw new Error(`工具 ${name} 返回错误：${text}`);
    }
    return result;
  }

  // 便捷：取工具返回的文本
  async callText(name, args, timeoutMs) {
    const r = await this.callTool(name, args, timeoutMs);
    return (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }

  failAll(err) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
  }

  stop() {
    try { this.proc && this.proc.kill(); } catch { /* ignore */ }
    this.ready = false;
  }
}

// 离线假通道：不连底座，返回可预测的模拟数据，用于自检与无底座演示
export class FakeMcpClient {
  constructor() {
    // index.js 统一用 await mcp.ready 等待通道就绪
    this.ready = Promise.resolve();
    this.calls = [];
  }

  async start() { this.ready = Promise.resolve(); }

  async callText(name, args) {
    this.calls.push({ name, args });
    const fake = {
      douyin_im_read: JSON.stringify({ ok: true, messages: [], note: 'fake: 无新私信' }),
      douyin_at_me: JSON.stringify({ ok: true, events: [], note: 'fake: 无新@' }),
      douyin_dm: JSON.stringify({ ok: true, dryRun: true, note: 'fake: 私信未真实发送' }),
      douyin_comment_sticker: JSON.stringify({ ok: true, dryRun: true, note: 'fake: 评论表情未真实发送' }),
      douyin_comment_reply: JSON.stringify({ ok: true, dryRun: true, note: 'fake: 评论回复未真实发送' }),
    };
    await sleep(2);
    return fake[name] || JSON.stringify({ ok: true, note: `fake: ${name}` });
  }

  // 与 McpClient 对齐
  async callTool(name, args) {
    const text = await this.callText(name, args);
    return { content: [{ type: 'text', text }], isError: false };
  }

  stop() { this.ready = false; }
}
