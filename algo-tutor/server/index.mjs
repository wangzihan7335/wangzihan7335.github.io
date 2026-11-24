/**
 * server/index.mjs
 * ---------------------------------------------------------------------------
 * 零框架 Node HTTP 服务：
 *   - /api/chat   代理 OpenAI 兼容 Chat Completions，原样转发 SSE 流
 *   - /api/title  轻量标题生成（title 块缺失时的备选方案）
 *   - /api/models/test  模型连通性测试
 *   - 生产模式下托管 dist/ 静态文件
 *
 * API Key 永远不会写入日志，也不会拼进 URL。
 * ---------------------------------------------------------------------------
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_MODEL_NAME, mockTitle, streamMockReply } from './mock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MAX_BODY_BYTES = 25 * 1024 * 1024;

await loadDotEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

/* ------------------------------------------------------------------ utils */

class ApiError extends Error {
  constructor(message, status = 400, code = 'bad_request', detail = '') {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function loadDotEnv(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[env] 读取 .env 失败：', error.message);
    }
  }
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendApiError(res, error) {
  const status = Number(error?.status) || 500;
  const message = error?.message || '服务器开小差了，请稍后再试。';
  sendJson(res, status, {
    error: {
      message,
      code: error?.code || 'internal_error',
      detail: error?.detail || '',
    },
  });
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new ApiError('请求内容过大，请缩短题目或对话内容。', 413, 'payload_too_large');
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('请求格式不正确：需要 JSON。', 400, 'invalid_json');
  }
}

function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl || process.env.AI_BASE_URL || 'https://api.deepseek.com').trim();
  if (raw.startsWith('mock://')) return raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError('API Base URL 格式不正确，应以 https:// 开头。', 400, 'invalid_base_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError('API Base URL 只支持 http/https。', 400, 'invalid_base_url');
  }
  return url.toString();
}

function chatEndpointFor(baseUrl) {
  if (baseUrl.startsWith('mock://')) return baseUrl;
  const url = new URL(baseUrl);
  let pathname = url.pathname.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(pathname)) {
    url.pathname = pathname;
    return url.toString();
  }
  if (/\/v\d+$/.test(pathname)) {
    url.pathname = `${pathname}/chat/completions`;
  } else {
    url.pathname = `${pathname}/v1/chat/completions`.replace(/\/{2,}/g, '/');
  }
  return url.toString();
}

function normalizeConfig(input = {}) {
  return {
    name: String(input.name || '未命名模型').slice(0, 60),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    apiKey: String(input.apiKey || '').trim(),
    model: String(input.model || process.env.AI_MODEL || 'deepseek-chat').trim(),
    temperature:
      typeof input.temperature === 'number' && Number.isFinite(input.temperature)
        ? Math.min(2, Math.max(0, input.temperature))
        : 0.6,
    stream: input.stream !== false,
  };
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content.slice(0, 120_000);
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const part of content.slice(0, 20)) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text.slice(0, 120_000) });
      continue;
    }
    if (
      part.type === 'image_url' &&
      part.image_url &&
      typeof part.image_url.url === 'string' &&
      /^data:image\//.test(part.image_url.url)
    ) {
      if (part.image_url.url.length <= 8_000_000) {
        parts.push({ type: 'image_url', image_url: { url: part.image_url.url } });
      }
    }
  }
  return parts;
}

function normalizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ApiError('对话消息为空。', 400, 'empty_messages');
  }
  if (input.length > 80) {
    throw new ApiError('当前会话消息过多，请新建一个题目会话再继续。', 400, 'too_many_messages');
  }
  return input
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'))
    .map((m) => ({ role: m.role, content: normalizeMessageContent(m.content) }))
    .filter((m) => (typeof m.content === 'string' ? m.content.length > 0 : m.content.length > 0));
}

function friendlyUpstreamError(status, rawText) {
  let providerMessage = '';
  try {
    const parsed = JSON.parse(rawText);
    providerMessage = String(
      parsed?.error?.message || parsed?.message || parsed?.error?.code || parsed?.error || '',
    );
  } catch {
    providerMessage = String(rawText || '').slice(0, 500);
  }
  providerMessage = providerMessage.replace(/\s+/g, ' ').trim().slice(0, 500);

  if (status === 401 || status === 403) {
    return new ApiError(
      '模型鉴权失败：请检查 API Key 是否正确、是否有该模型的权限。',
      status,
      'auth_failed',
      providerMessage,
    );
  }
  if (status === 402 || /余额不足|insufficient.?quota|insufficient.?balance|quota.*exceeded/i.test(providerMessage)) {
    return new ApiError('账户余额不足或额度已用尽，请充值或更换 API Key。', 402, 'insufficient_balance', providerMessage);
  }
  if (status === 429) {
    return new ApiError('请求太频繁或超出速率限制，请稍后再试。', 429, 'rate_limited', providerMessage);
  }
  if (status === 404) {
    return new ApiError(
      '接口地址不存在（404）。请检查 Base URL；也可以直接填写完整的 /chat/completions 地址。',
      404,
      'endpoint_not_found',
      providerMessage,
    );
  }
  if (status === 400 || status === 422) {
    return new ApiError(
      `模型服务拒绝了请求：${providerMessage || '请检查模型名称与请求参数。'}`,
      400,
      'upstream_rejected',
      providerMessage,
    );
  }
  return new ApiError(
    `模型服务暂时不可用（HTTP ${status}）。${providerMessage ? `上游信息：${providerMessage}` : ''}`,
    502,
    'upstream_error',
    providerMessage,
  );
}

function authHeaders(config) {
  const apiKey = config.apiKey || process.env.AI_API_KEY || '';
  if (!apiKey) {
    throw new ApiError(
      '尚未填写 API Key。请打开右上角「模型设置」填写，或把它写入服务端 .env 的 AI_API_KEY。',
      400,
      'missing_api_key',
    );
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    Accept: 'text/event-stream, application/json',
  };
}

function completionPayload(config, messages, overrides = {}) {
  return {
    model: config.model,
    messages,
    temperature: config.temperature,
    stream: overrides.stream ?? config.stream,
    ...overrides.extra,
  };
}

async function fetchCompletion(config, messages, overrides = {}) {
  const endpoint = chatEndpointFor(config.baseUrl);
  const headers = authHeaders(config);
  const controller = new AbortController();
  const timeoutMs = overrides.timeoutMs || 45_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(completionPayload(config, messages, overrides)),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error?.name === 'AbortError') {
      throw new ApiError('模型请求超时，请检查网络或稍后再试。', 504, 'timeout');
    }
    throw new ApiError(
      '无法连接模型服务，请检查 Base URL、网络连接或代理设置。',
      502,
      'network_error',
      String(error?.cause?.code || error?.message || error).slice(0, 300),
    );
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw friendlyUpstreamError(response.status, text);
  }
  return response;
}

function readCompletionContent(payload) {
  const choices = payload?.choices;
  if (!Array.isArray(choices) || !choices.length) return '';
  const first = choices[0];
  const content = first?.message?.content ?? first?.delta?.content ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('');
  }
  return '';
}

/* ------------------------------------------------------------------- api */

async function handleChat(req, res) {
  const body = await readJsonBody(req);
  const config = normalizeConfig(body.config);
  const messages = normalizeMessages(body.messages);
  const wantsStream = config.stream;

  if (config.baseUrl.startsWith('mock://')) {
    if (!wantsStream) {
      const { buildMockReply } = await import('./mock.mjs');
      sendJson(res, 200, { content: buildMockReply(messages), model: DEMO_MODEL_NAME });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    await streamMockReply({ messages, res, signal: controller.signal });
    res.end();
    return;
  }

  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);

  const endpoint = chatEndpointFor(config.baseUrl);
  const headers = authHeaders(config);
  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(completionPayload(config, messages, { stream: wantsStream })),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (!res.writableEnded) res.end();
      return;
    }
    throw new ApiError(
      '无法连接模型服务，请检查 Base URL、网络连接或代理设置。',
      502,
      'network_error',
      String(error?.cause?.code || error?.message || error).slice(0, 300),
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    throw friendlyUpstreamError(upstream.status, text);
  }

  const contentType = upstream.headers.get('content-type') || '';

  if (!wantsStream) {
    const payload = await upstream.json().catch(() => null);
    const content = readCompletionContent(payload);
    if (!content) {
      throw new ApiError('模型返回了空内容，请检查模型名称或稍后再试。', 502, 'empty_completion');
    }
    sendJson(res, 200, { content, model: config.model });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // 少数兼容服务即使 stream:true 也返回整段 JSON，这里统一转换成 SSE。
  if (!contentType.includes('text/event-stream')) {
    const payload = await upstream.json().catch(() => null);
    const content = readCompletionContent(payload);
    if (content) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const reader = upstream.body?.getReader();
  if (!reader) {
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.writableEnded) res.write(Buffer.from(value));
    }
  } catch (error) {
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({
          error: { message: '流式传输中断，可以重试或检查网络。', code: 'stream_interrupted' },
        })}\n\n`,
      );
    }
  } finally {
    reader.releaseLock?.();
    if (!res.writableEnded) res.end();
  }
}

async function handleTitle(req, res) {
  const body = await readJsonBody(req);
  const config = normalizeConfig(body.config);
  const problem = String(body.problem || '').slice(0, 6000);
  if (!problem.trim()) {
    throw new ApiError('题目内容为空，无法生成标题。', 400, 'empty_problem');
  }

  if (config.baseUrl.startsWith('mock://')) {
    sendJson(res, 200, { title: mockTitle(problem) });
    return;
  }

  const response = await fetchCompletion(
    config,
    [
      {
        role: 'system',
        content:
          '你是会话标题生成器。请根据用户提供的算法题，生成一个不超过 15 个汉字的中文短标题。' +
          '只输出标题本身，不要引号、标点、解释或任何前缀。突出算法主题。',
      },
      { role: 'user', content: problem },
    ],
    { stream: false, timeoutMs: 25_000, extra: { max_tokens: 40, temperature: 0.2 } },
  );
  const payload = await response.json().catch(() => null);
  let title = readCompletionContent(payload)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^(标题|题目|title)\s*[:：]\s*/i, '')
    .replace(/["'“”‘’`]/g, '')
    .replace(/\s+/g, '')
    .trim();
  title = Array.from(title).slice(0, 15).join('');
  sendJson(res, 200, { title: title || mockTitle(problem) });
}

async function handleModelTest(req, res) {
  const body = await readJsonBody(req);
  const config = normalizeConfig(body.config);
  const startedAt = Date.now();

  if (config.baseUrl.startsWith('mock://')) {
    sendJson(res, 200, {
      ok: true,
      content: '演示模型已就绪，无需 API Key。',
      model: DEMO_MODEL_NAME,
      latencyMs: Date.now() - startedAt,
    });
    return;
  }

  const response = await fetchCompletion(
    config,
    [
      { role: 'system', content: '你是连接测试助手。只回复四个字：连接成功' },
      { role: 'user', content: '请回复：连接成功' },
    ],
    { stream: false, timeoutMs: 30_000, extra: { max_tokens: 16, temperature: 0 } },
  );
  const payload = await response.json().catch(() => null);
  const content = readCompletionContent(payload);
  if (!content) {
    throw new ApiError('连接成功，但模型返回内容为空。请检查模型名称。', 502, 'empty_completion');
  }
  sendJson(res, 200, {
    ok: true,
    content: content.slice(0, 100),
    model: config.model,
    latencyMs: Date.now() - startedAt,
  });
}

/* ---------------------------------------------------------------- static */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(res, 400, { error: { message: 'Bad Request' } });
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(DIST, `.${pathname}`);
  if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
    sendJson(res, 403, { error: { message: 'Forbidden' } });
    return;
  }

  let stat = null;
  try {
    stat = await fs.stat(filePath);
  } catch {
    stat = null;
  }

  if (!stat?.isFile()) {
    // SPA 回退；但带扩展名的资源缺失时返回 404，避免把 HTML 当成 JS。
    if (path.extname(pathname)) {
      sendJson(res, 404, { error: { message: 'Not Found' } });
      return;
    }
    const fallback = path.join(DIST, 'index.html');
    try {
      stat = await fs.stat(fallback);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('前端尚未构建。开发模式请访问 Vite 的 5173 端口，或先运行 npm run build。');
      return;
    }
    return serveFile(req, res, fallback, stat, true);
  }
  return serveFile(req, res, filePath, stat, false);
}

function serveFile(req, res, filePath, stat, isIndex) {
  const ext = path.extname(filePath).toLowerCase();
  const cacheControl = isIndex
    ? 'no-cache'
    : /\/assets\//.test(filePath)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.writableEnded) res.destroy();
  });
  stream.pipe(res);
}

/* ---------------------------------------------------------------- server */

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const pathname = (() => {
    try {
      return new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      return '/';
    }
  })();

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        demo: true,
        hasServerKey: Boolean(process.env.AI_API_KEY),
        time: new Date().toISOString(),
      });
      return;
    }
    if (pathname === '/api/chat' && req.method === 'POST') {
      await handleChat(req, res);
      return;
    }
    if (pathname === '/api/title' && req.method === 'POST') {
      await handleTitle(req, res);
      return;
    }
    if (pathname === '/api/models/test' && req.method === 'POST') {
      await handleModelTest(req, res);
      return;
    }
    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: { message: '接口不存在。', code: 'not_found' } });
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      console.error('[api] 已发送响应后发生错误：', error?.message || error);
      return;
    }
    sendApiError(res, error);
  } finally {
    const elapsed = Date.now() - started;
    if (pathname.startsWith('/api/') && elapsed > 1000) {
      console.log(`[api] ${req.method} ${pathname} ${elapsed}ms`);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  拾阶 · 算法题引导助教 API`);
  console.log(`  ➜ http://${HOST}:${PORT}`);
  console.log(`  ➜ 演示模型：已启用（无需 Key）`);
  console.log(`  ➜ 服务端兜底 Key：${process.env.AI_API_KEY ? '已配置' : '未配置'}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
