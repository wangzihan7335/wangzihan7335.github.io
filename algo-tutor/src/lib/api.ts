import type {
  ApiMessage,
  ModelConfig,
  ReviewCard,
  ReviewCardDraft,
  ReviewGrade,
} from '../types';

export class ChatApiError extends Error {
  status: number;
  code: string;
  detail: string;

  constructor(message: string, status = 0, code = 'request_failed', detail = '') {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function parseErrorResponse(response: Response): Promise<ChatApiError> {
  const text = await response.text().catch(() => '');
  try {
    const payload = JSON.parse(text) as {
      error?: { message?: string; code?: string; detail?: string } | string;
    };
    if (payload?.error && typeof payload.error === 'object') {
      return new ChatApiError(
        payload.error.message || '模型请求失败，请稍后再试。',
        response.status,
        payload.error.code || 'request_failed',
        payload.error.detail || '',
      );
    }
  } catch {
    // fallthrough
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return new ChatApiError('无法连接模型服务，请检查网络与 Base URL。', response.status, 'network');
  }
  return new ChatApiError(
    `模型请求失败（HTTP ${response.status}）${text ? `：${text.slice(0, 200)}` : ''}`,
    response.status,
    'http_error',
  );
}

function extractDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as {
    delta?: { content?: unknown };
    message?: { content?: unknown };
    text?: unknown;
  };
  const candidate = first?.delta?.content ?? first?.message?.content ?? first?.text;
  if (typeof candidate === 'string') return candidate;
  if (Array.isArray(candidate)) {
    return candidate
      .map((part) =>
        typeof part === 'string' ? part : (part as { text?: string })?.text || '',
      )
      .join('');
  }
  return '';
}

function payloadError(payload: unknown): ChatApiError | null {
  if (!payload || typeof payload !== 'object') return null;
  const error = (payload as { error?: unknown }).error;
  if (!error) return null;
  if (typeof error === 'string') {
    return new ChatApiError(error, 502, 'stream_error');
  }
  if (typeof error === 'object') {
    const item = error as { message?: string; code?: string; detail?: string };
    return new ChatApiError(
      item.message || '流式生成中断，请稍后再试。',
      502,
      item.code || 'stream_error',
      item.detail || '',
    );
  }
  return null;
}

export interface ChatConfigPayload {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  stream: boolean;
}

function toConfigPayload(config: ModelConfig): ChatConfigPayload {
  return {
    name: config.name,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature,
    stream: config.stream,
  };
}

export interface ChatRequestOptions {
  config: ModelConfig;
  messages: ApiMessage[];
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}

/** POST /api/chat，流式返回文本增量。 */
export async function streamChat({
  config,
  messages,
  signal,
  onDelta,
}: ChatRequestOptions): Promise<{ content: string }> {
  if (!config?.model) {
    throw new ChatApiError('当前模型配置缺少模型名称。', 400, 'invalid_config');
  }
  if (!config?.baseUrl) {
    throw new ChatApiError('当前模型配置缺少 Base URL。', 400, 'invalid_config');
  }

  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: toConfigPayload(config),
        messages,
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new ChatApiError(
      '网络请求失败。请确认本地服务已启动，或检查网络连接。',
      0,
      'network_error',
    );
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const contentType = response.headers.get('content-type') || '';

  // 非流式模式：后端直接返回整段 JSON。
  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as { content?: string; error?: unknown };
    const apiError = payloadError(payload);
    if (apiError) throw apiError;
    const content = String(payload?.content || '');
    if (content) onDelta(content);
    return { content };
  }

  if (!response.body) {
    throw new ChatApiError('浏览器不支持流式读取，请更换浏览器。', 0, 'no_stream_support');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let dataLines: string[] = [];
  let eventName = '';
  let done = false;
  let streamError: ChatApiError | null = null;

  const dispatchEvent = () => {
    const data = dataLines.join('\n').trim();
    const currentEvent = eventName;
    dataLines = [];
    eventName = '';
    if (!data) return;
    if (data === '[DONE]') {
      done = true;
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    const apiError = payloadError(payload);
    if (apiError) {
      streamError = apiError;
      return;
    }
    if (currentEvent === 'error') {
      streamError = new ChatApiError('流式生成出错，请稍后重试。', 502, 'stream_error');
      return;
    }
    const delta = extractDelta(payload);
    if (delta) {
      accumulated += delta;
      onDelta(delta);
    }
  };

  const processLine = (line: string) => {
    if (line === '') {
      dispatchEvent();
      return;
    }
    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  };

  try {
    while (!done) {
      const { done: readerDone, value } = await reader.read();
      if (readerDone) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let lineBreak = buffer.indexOf('\n');
      while (lineBreak !== -1) {
        let line = buffer.slice(0, lineBreak);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        buffer = buffer.slice(lineBreak + 1);
        processLine(line);
        if (streamError) throw streamError;
        if (done) break;
        lineBreak = buffer.indexOf('\n');
      }
    }
    if (!done && buffer.trim()) {
      const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      processLine(line);
      dispatchEvent();
      if (streamError) throw streamError;
    } else if (!done && dataLines.length) {
      dispatchEvent();
      if (streamError) throw streamError;
    }
  } catch (error) {
    if (streamError) throw streamError;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error instanceof ChatApiError) throw error;
    throw new ChatApiError('读取模型响应时连接中断，请重试。', 0, 'stream_read_error');
  } finally {
    reader.releaseLock();
  }

  return { content: accumulated };
}

export async function requestTitle(
  config: ModelConfig,
  problem: string,
): Promise<string> {
  const response = await fetch('/api/title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: toConfigPayload(config), problem }),
  });
  if (!response.ok) throw await parseErrorResponse(response);
  const payload = (await response.json()) as { title?: string };
  return String(payload?.title || '').trim();
}

export async function testModel(config: ModelConfig): Promise<{
  ok: boolean;
  content: string;
  model: string;
  latencyMs: number;
}> {
  const response = await fetch('/api/models/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: toConfigPayload(config) }),
  });
  if (!response.ok) throw await parseErrorResponse(response);
  return (await response.json()) as {
    ok: boolean;
    content: string;
    model: string;
    latencyMs: number;
  };
}

/** 从一次学习记录中提炼 1-3 张复习卡。 */
export async function requestReviewCards(
  config: ModelConfig,
  context: string,
): Promise<ReviewCardDraft[]> {
  const response = await fetch('/api/review/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: toConfigPayload(config), context }),
  });
  if (!response.ok) throw await parseErrorResponse(response);
  const payload = (await response.json()) as { cards?: ReviewCardDraft[] };
  return Array.isArray(payload?.cards) ? payload.cards : [];
}

/** 交给 AI 批改；代码题只做逻辑审查，不编译、不运行。 */
export async function gradeReviewAnswer(
  config: ModelConfig,
  card: ReviewCard,
  answer: string,
): Promise<ReviewGrade> {
  const response = await fetch('/api/review/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: toConfigPayload(config),
      card: {
        mode: card.mode,
        title: card.title,
        prompt: card.prompt,
        reference: card.reference,
        rubric: card.rubric || [],
      },
      answer,
    }),
  });
  if (!response.ok) throw await parseErrorResponse(response);
  const payload = (await response.json()) as { grade?: ReviewGrade };
  if (!payload?.grade) {
    throw new ChatApiError('AI 没有返回批改结果，请稍后重试。', 502, 'empty_review_grade');
  }
  return payload.grade;
}

export function userMessageForError(error: unknown): { message: string; detail: string } {
  if (error instanceof ChatApiError) {
    return { message: error.message, detail: error.detail || '' };
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { message: '已停止生成。', detail: '' };
  }
  const message = error instanceof Error ? error.message : '未知错误';
  return { message: `请求失败：${message}`, detail: '' };
}
