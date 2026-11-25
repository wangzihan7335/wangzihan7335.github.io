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
import { DEMO_MODEL_NAME, buildMockReviewCards, gradeMockReview, mockTitle, streamMockReply } from './mock.mjs';
import {
  assertUpstreamAllowed,
  createRateLimiter,
  getClientIp,
} from './security.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MAX_BODY_BYTES = 25 * 1024 * 1024;

await loadDotEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const configuredRateLimit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 30);
const RATE_LIMIT_PER_MINUTE = Number.isFinite(configuredRateLimit) ? configuredRateLimit : 30;
const apiRateLimiter = createRateLimiter({ limit: RATE_LIMIT_PER_MINUTE });

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

function sendJson(res, status, payload, extraHeaders = {}) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
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
  await assertUpstreamAllowed(config.baseUrl);
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
      redirect: 'error',
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

  await assertUpstreamAllowed(config.baseUrl);
  const endpoint = chatEndpointFor(config.baseUrl);
  const headers = authHeaders(config);
  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(completionPayload(config, messages, { stream: wantsStream })),
      signal: controller.signal,
      redirect: 'error',
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

/* --------------------------------------------------------------- review */

const REVIEW_MODES = new Set(['explain', 'trace', 'code']);
const REVIEW_RATINGS = new Set(['again', 'hard', 'good', 'easy']);
const REVIEW_VERDICTS = new Set(['correct', 'partial', 'incorrect']);
const REVIEW_LANGUAGES = new Set([
  'python',
  'javascript',
  'typescript',
  'cpp',
  'java',
  'c',
  'go',
]);

function decodeJsonBlock(raw) {
  const text = String(raw || '').trim();
  let candidate = text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidate = fenced[1].trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new ApiError('模型返回的复习卡格式不正确，请稍后重试。', 502, 'invalid_review_json');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new ApiError('模型返回的复习卡格式不正确，请稍后重试。', 502, 'invalid_review_json');
  }
}

function stringList(raw, maxItems, maxLength) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

function normalizeReviewCardDraft(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw;
  const mode = REVIEW_MODES.has(item.mode) ? item.mode : 'explain';
  const prompt = String(item.prompt || '').trim().slice(0, 3000);
  const reference = String(item.reference || '').trim().slice(0, 8000);
  if (!prompt || !reference) return null;
  const language = REVIEW_LANGUAGES.has(String(item.language || '').toLowerCase())
    ? String(item.language).toLowerCase()
    : undefined;
  return {
    mode,
    title: (String(item.title || '').trim() || '复习卡').slice(0, 80),
    prompt,
    reference,
    hints: stringList(item.hints, 3, 180),
    rubric: stringList(item.rubric, 5, 180),
    snippet: String(item.snippet || '').trim().slice(0, 5000) || undefined,
    language,
    pointName: String(item.pointName || '').trim().slice(0, 60) || undefined,
  };
}

function normalizeReviewGrade(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new ApiError('模型没有返回有效的批改结果，请稍后重试。', 502, 'invalid_review_grade');
  }
  const verdict = REVIEW_VERDICTS.has(raw.verdict) ? raw.verdict : 'partial';
  const suggestedRating = REVIEW_RATINGS.has(raw.suggestedRating)
    ? raw.suggestedRating
    : verdict === 'correct'
      ? 'good'
      : verdict === 'partial'
        ? 'hard'
        : 'again';
  const numericScore = Number(raw.score);
  return {
    verdict,
    score: Number.isFinite(numericScore) ? Math.max(0, Math.min(100, Math.round(numericScore))) : 60,
    feedback:
      String(raw.feedback || '').trim().slice(0, 1000) ||
      'AI 没有给出具体反馈，请对照参考答案再检查一遍。',
    missing: stringList(raw.missing, 5, 160),
    suggestedRating,
  };
}

async function handleReviewCards(req, res) {
  const body = await readJsonBody(req);
  const config = normalizeConfig(body.config);
  const context = String(body.context || '').trim().slice(0, 18000);
  if (!context) {
    throw new ApiError('当前会话还没有足够内容来生成复习卡。', 400, 'empty_review_context');
  }

  if (config.baseUrl.startsWith('mock://')) {
    sendJson(res, 200, { cards: buildMockReviewCards(context) });
    return;
  }

  const system = [
    '你是算法学习复习卡生成器。根据用户的学习记录，生成 1-3 张原子化、可独立作答的复习卡。',
    '只输出严格 JSON，不要 markdown 代码围栏，不要解释。JSON 结构：',
    '{"cards":[{"mode":"explain|trace|code","title":"短标题","pointName":"对应知识点",',
    '"prompt":"只呈现问题，不能包含答案","reference":"标准答案/参考代码/参考推演",',
    '"hints":["2-3 条递进提示"],"rubric":["2-4 条评分要点"],',
    '"snippet":"仅 trace 模式需要：要推演的短代码","language":"仅 code 模式需要：python/javascript/typescript/cpp/java/c/go"}]}',
    '要求：',
    '1. explain 卡要求用户复述概念、关键条件或原因；',
    '2. trace 卡给出一段 5-15 行代码，要求用户逐轮推演变量；',
    '3. code 卡要求用户不看答案重写核心代码；prompt 不能出现完整解法。',
    '4. 内容必须来自学习记录，不要凭空扩展；若材料不足，少生成几张。',
    '5. 所有文本使用中文；reference 可以包含代码。',
  ].join('\n');
  const user = `以下是学习记录：\n\n${context}\n\n请生成复习卡。`;
  const response = await fetchCompletion(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    {
      stream: false,
      timeoutMs: 60_000,
      extra: { max_tokens: 2200, temperature: 0.35 },
    },
  );
  const payload = await response.json().catch(() => null);
  const content = readCompletionContent(payload);
  if (!content.trim()) {
    throw new ApiError('模型没有返回复习卡，请稍后重试。', 502, 'empty_review_cards');
  }
  const parsed = decodeJsonBlock(content);
  const rawCards = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.cards)
      ? parsed.cards
      : [];
  const cards = rawCards
    .map(normalizeReviewCardDraft)
    .filter(Boolean)
    .slice(0, 3);
  if (!cards.length) {
    throw new ApiError('模型没有生成可用的复习卡，请稍后重试。', 502, 'invalid_review_cards');
  }
  sendJson(res, 200, { cards });
}

async function handleReviewGrade(req, res) {
  const body = await readJsonBody(req);
  const config = normalizeConfig(body.config);
  const card = body.card;
  const answer = String(body.answer || '').trim().slice(0, 12000);
  if (!card || !REVIEW_MODES.has(card.mode)) {
    throw new ApiError('复习卡内容不正确，无法批改。', 400, 'invalid_review_card');
  }
  if (!answer) {
    throw new ApiError('先写下你的答案，再交给 AI 批改。', 400, 'empty_review_answer');
  }
  if (config.baseUrl.startsWith('mock://')) {
    sendJson(res, 200, { grade: gradeMockReview(card, answer) });
    return;
  }

  const system = [
    '你是严格但克制的算法复习卡批改器。根据卡片问题和参考答案，评价用户答案。',
    '特别要求：代码题只做逻辑审查，不运行代码、不依赖编译器或测试结果，也不能声称“编译通过/测试通过”。',
    '不要直接贴出完整正确答案；先指出用户做对了什么，再指出缺失或错误，最后给一个下一步提示。',
    '只输出严格 JSON，不要 markdown 代码围栏。结构：',
    '{"verdict":"correct|partial|incorrect","score":0-100,"feedback":"2-4 句具体反馈",',
    '"missing":["最多 4 条未覆盖要点"],"suggestedRating":"again|hard|good|easy"}',
    '评分标准：思路正确且边界完整为 correct；思路接近但缺关键条件为 partial；核心错误为 incorrect。',
    'suggestedRating：incorrect=again，partial=hard，correct=good，答得完整且能举反例= easy。',
  ].join('\n');
  const cardForPrompt = {
    mode: card.mode,
    title: String(card.title || '').slice(0, 120),
    prompt: String(card.prompt || '').slice(0, 3000),
    reference: String(card.reference || '').slice(0, 8000),
    rubric: Array.isArray(card.rubric) ? card.rubric.slice(0, 5) : [],
  };
  const user = [
    '【复习卡】',
    JSON.stringify(cardForPrompt, null, 2),
    '',
    '【用户答案】',
    answer,
    '',
    '请只返回批改 JSON。',
  ].join('\n');
  const response = await fetchCompletion(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    {
      stream: false,
      timeoutMs: 45_000,
      extra: { max_tokens: 900, temperature: 0.2 },
    },
  );
  const payload = await response.json().catch(() => null);
  const content = readCompletionContent(payload);
  if (!content.trim()) {
    throw new ApiError('模型没有返回批改结果，请稍后重试。', 502, 'empty_review_grade');
  }
  const parsed = decodeJsonBlock(content);
  sendJson(res, 200, { grade: normalizeReviewGrade(parsed) });
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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const started = Date.now();
  const pathname = (() => {
    try {
      return new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      return '/';
    }
  })();

  try {
    const isRateLimitedRoute =
      req.method === 'POST' &&
      (pathname === '/api/chat' ||
        pathname === '/api/title' ||
        pathname === '/api/models/test' ||
        pathname === '/api/review/cards' ||
        pathname === '/api/review/grade');
    if (isRateLimitedRoute) {
      const ip = getClientIp(req, TRUST_PROXY);
      const rate = apiRateLimiter.check(ip);
      if (!rate.allowed) {
        sendJson(
          res,
          429,
          {
            error: {
              message: `请求太频繁了，请 ${rate.retryAfter} 秒后再试。`,
              code: 'rate_limited',
              detail: '',
            },
          },
          { 'Retry-After': String(rate.retryAfter) },
        );
        return;
      }
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        demo: true,
        hasServerKey: Boolean(process.env.AI_API_KEY),
        rateLimitPerMinute: RATE_LIMIT_PER_MINUTE,
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
    if (pathname === '/api/review/cards' && req.method === 'POST') {
      await handleReviewCards(req, res);
      return;
    }
    if (pathname === '/api/review/grade' && req.method === 'POST') {
      await handleReviewGrade(req, res);
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
  const allowlist = String(process.env.ALLOWED_API_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  console.log(`\n  拾阶 · 算法题引导助教 API`);
  console.log(`  ➜ http://${HOST}:${PORT}`);
  console.log(`  ➜ 演示模型：已启用（无需 Key）`);
  console.log(`  ➜ 服务端兜底 Key：${process.env.AI_API_KEY ? '已配置' : '未配置'}`);
  console.log(
    `  ➜ 上游白名单：${allowlist.length ? `${allowlist.length} 个域名` : '未限制（仍拦截内网/本机/保留地址）'}`,
  );
  console.log(
    `  ➜ 公共限流：${RATE_LIMIT_PER_MINUTE > 0 ? `${RATE_LIMIT_PER_MINUTE} 次/分钟/IP` : '已关闭'}`,
  );
  console.log(`  ➜ 反向代理 X-Forwarded-For：${TRUST_PROXY ? '信任' : '不信任'}`);
  console.log(
    `  ➜ 私网 / 本机上游：${
      process.env.ALLOW_PRIVATE_UPSTREAMS === '1' ? '已允许（仅限本地开发！）' : '已拦截'
    }\n`,
  );
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
