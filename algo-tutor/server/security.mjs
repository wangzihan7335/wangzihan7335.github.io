import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Errors here use the same shape as server/index.mjs's ApiError so the global
 * error handler can return a useful Chinese message and HTTP status.
 */
export class SecurityError extends Error {
  constructor(message, status = 403, code = 'blocked_upstream', detail = '') {
    super(message);
    this.name = 'SecurityError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const privateRanges = new net.BlockList();
const ipv4Ranges = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
const ipv6Ranges = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:10::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];
for (const [subnet, prefix] of ipv4Ranges) privateRanges.addSubnet(subnet, prefix, 'ipv4');
for (const [subnet, prefix] of ipv6Ranges) privateRanges.addSubnet(subnet, prefix, 'ipv6');

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return privateRanges.check(address, 'ipv4');
  if (family === 6) return privateRanges.check(address, 'ipv6');
  return true;
}

function normalizeHostname(hostname) {
  return String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function allowedHosts() {
  return String(process.env.ALLOWED_API_HOSTS || '')
    .split(',')
    .map((host) => normalizeHostname(host.trim()))
    .filter(Boolean);
}

function hostAllowed(hostname) {
  const allowed = allowedHosts();
  if (!allowed.length) return true;
  return allowed.some((allowedHost) => hostname === allowedHost || hostname.endsWith(`.${allowedHost}`));
}

/**
 * Validate every user-supplied upstream endpoint before it receives an API
 * request. This is intentionally conservative for public deployments:
 * - https only unless ALLOW_PRIVATE_UPSTREAMS=1 (local development)
 * - no loopback / RFC1918 / link-local / metadata-style destinations
 * - optional ALLOWED_API_HOSTS allowlist, e.g. api.deepseek.com,api.openai.com
 * - no credentials in the URL
 *
 * Redirects are disabled at fetch sites, which prevents a public host from
 * redirecting the proxy into an internal address.
 */
export async function assertUpstreamAllowed(rawUrl) {
  if (String(rawUrl || '').startsWith('mock://')) return;

  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new SecurityError('API Base URL 格式不正确，应以 https:// 开头。', 400, 'invalid_base_url');
  }

  if (url.username || url.password) {
    throw new SecurityError('API Base URL 不能包含用户名或密码。', 400, 'invalid_base_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SecurityError('API Base URL 只支持 http/https。', 400, 'invalid_base_url');
  }

  const allowPrivate = process.env.ALLOW_PRIVATE_UPSTREAMS === '1';
  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw new SecurityError('API Base URL 缺少主机名。', 400, 'invalid_base_url');
  }
  if (!allowPrivate && url.protocol !== 'https:') {
    throw new SecurityError('为保护 API Key 与对话内容，模型接口必须使用 https://。', 400, 'https_required');
  }
  if (
    !allowPrivate &&
    (hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.home.arpa'))
  ) {
    throw new SecurityError('出于安全考虑，不允许连接本机或内网地址。', 403, 'blocked_upstream');
  }
  if (!hostAllowed(hostname)) {
    throw new SecurityError(
      '该模型服务不在本站允许的地址列表中。请联系站点管理员把域名加入 ALLOWED_API_HOSTS。',
      403,
      'blocked_upstream',
    );
  }
  if (allowPrivate) return;

  let addresses;
  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new SecurityError('无法解析模型服务域名，请检查 Base URL 或网络。', 400, 'upstream_dns_failed');
    }
  }

  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new SecurityError(
      '出于安全考虑，不允许通过本站连接本机、内网或保留地址。',
      403,
      'blocked_upstream',
    );
  }
}

export function createRateLimiter({ limit, windowMs = 60_000 }) {
  const buckets = new Map();
  let lastCleanup = Date.now();
  const enabled = Number.isFinite(limit) && limit > 0;

  function cleanup(now) {
    if (now - lastCleanup < windowMs) return;
    lastCleanup = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    check(key) {
      if (!enabled) return { allowed: true, retryAfter: 0 };
      const now = Date.now();
      cleanup(now);
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      if (bucket.count >= limit) {
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        };
      }
      bucket.count += 1;
      return { allowed: true, retryAfter: 0 };
    },
  };
}

export function getClientIp(req, trustProxy = false) {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const first = (Array.isArray(header) ? header[0] : String(header || ''))
      .split(',')[0]
      .trim();
    if (net.isIP(first)) return first;
  }
  return req.socket?.remoteAddress || 'unknown';
}
