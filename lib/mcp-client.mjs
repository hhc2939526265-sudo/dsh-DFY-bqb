// 底座 MCP 客户端：spawn 底座的 stdio MCP server，复用其登录态与发送通道。
// 协议为 JSON-RPC 2.0 over stdio；找不到底座/离线时用 FakeMcpClient 降级。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { withRetry } from './util.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const CANDIDATE_PATHS = [
  process.env.DSH_BASE_PATH,
  join(homedir(), '.dsh', 'plugins', 'dsh-douyin-scroll'),
  join(homedir(), '.dsh', 'dsh-douyin-scroll'),
];

export function discoverBasePath(explicit) {
  if (explicit && existsSync(join(explicit, 'tools', 'mcp-server.mjs'))) return explicit;
  return CANDIDATE_PATHS.find((p) => p && existsSync(join(p, 'tools', 'mcp-server.mjs'))) || null;
}

let nextId = 1;

export class McpClient {
  constructor(basePath, { logger = () => {} } = {}) {
    this.basePath = basePath;
    this.log = logger;
    this.proc = null;
    this.pending = new Map();
    this.buffer = '';
  }

  start() {
    return new Promise((resolve, reject) => {
      const serverFile = join(this.basePath, 'tools', 'mcp-server.mjs');
      this.proc = spawn(process.execPath, [serverFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc.on('error', reject);
      this.proc.on('exit', (code) => {
        this.log('mcp', `底座 MCP 退出 code=${code}`);
        for (const { reject: rj } of this.pending.values()) {
          rj(new Error('mcp exited'));
        }
        this.pending.clear();
      });
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (chunk) => this._onData(chunk));
      this.proc.stderr.on('data', (c) => this.log('mcp', `stderr: ${c.trim()}`));
      this._request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'dfy-bqb', version: '0.1.0' },
      }).then(() => this._notify('notifications/initialized', {})).then(resolve).catch(reject);
    });
  }

  _onData(chunk) {
    this.buffer += chunk;
    let idx;
    // MCP stdio 以换行分隔 JSON-RPC 消息
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || 'rpc error'));
          else resolve(msg.result);
        }
      } catch (e) {
        this.log('mcp', `解析消息失败：${e.message}`);
      }
    }
  }

  _send(msg) {
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  _notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params });
  }

  _request(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      this.pending.set(id, { resolve, reject });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async listTools() {
    const r = await withRetry(() => this._request('tools/list', {}), { label: 'listTools' });
    return r.tools || [];
  }

  async callTool(name, args) {
    return withRetry(() => this._request('tools/call', { name, arguments: args }), {
      label: `call:${name}`,
    });
  }

  // 便捷封装：发送私信 / 评论（带 sticker_id）
  async sendDm({ peer, text, stickerId }) {
    return this.callTool('douyin_dm', { peer, text, sticker_id: stickerId || '' });
  }

  async sendComment({ awemeId, text, stickerId, replyId }) {
    return this.callTool('douyin_comment_reply', {
      aweme_id: awemeId, text, sticker_id: stickerId || '', reply_id: replyId || '',
    });
  }

  async readIncoming() {
    const dm = await this.callTool('douyin_im_read', {}).catch(() => ({ messages: [] }));
    const at = await this.callTool('douyin_at_me', {}).catch(() => ({ messages: [] }));
    return [...(dm.messages || []), ...(at.messages || [])];
  }

  stop() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

// 离线降级：记录调用不真发，保证插件可独立加载、自检与演示
export class FakeMcpClient {
  constructor() {
    this.calls = [];
  }

  async callTool(name, args) {
    this.calls.push({ name, args, at: new Date().toISOString() });
    return { ok: true, fake: true, name };
  }

  async sendDm(args) { return this.callTool('fake_dm', args); }

  async sendComment(args) { return this.callTool('fake_comment', args); }

  async readIncoming() { return []; }

  stop() { /* noop */ }
}
