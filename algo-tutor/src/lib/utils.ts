export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export type DayGroup = '今天' | '昨天' | '更早';

export function dayGroup(timestamp: number, now = Date.now()): DayGroup {
  const today = startOfDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;
  if (timestamp >= today) return '今天';
  if (timestamp >= yesterday) return '昨天';
  return '更早';
}

export function formatSidebarTime(timestamp: number, now = Date.now()): string {
  const group = dayGroup(timestamp, now);
  const date = new Date(timestamp);
  if (group === '今天') {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  if (group === '昨天') return '昨天';
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatFullDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 回退到 textarea 方案
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 去掉 Markdown 标记，保留标题、列表和代码缩进，
 * 方便把笔记直接复制到纯文本笔记或照着抄到本子上。
 */
export function markdownToPlainText(markdown: string): string {
  let text = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/```[^\n]*\n/g, '\n')
    .replace(/```/g, '\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1（$2）');

  text = text
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^([ \t]*)[-+*][ \t]+/gm, '$1· ')
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, row: string) =>
      row
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join('  /  '),
    )
    .replace(/^[ \t]*-{3,}[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

export function downloadTextFile(filename: string, content: string, mime = 'text/markdown'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function formatFileSafeTitle(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || '复习笔记';
}

export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}
