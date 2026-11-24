import type { MessageAttachment } from '../types';
import { createId } from './storage';

export const MAX_ATTACHMENTS = 6;
export const MAX_TEXT_FILE_BYTES = 512 * 1024;
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000;

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'py',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'java',
  'c',
  'h',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'go',
  'rs',
  'rb',
  'php',
  'swift',
  'kt',
  'kts',
  'cs',
  'scala',
  'sql',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'csv',
  'tsv',
  'svg',
  'ini',
  'conf',
  'log',
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']);

export const FILE_ACCEPT = [
  ...Array.from(TEXT_EXTENSIONS).map((extension) => `.${extension}`),
  ...Array.from(IMAGE_EXTENSIONS).map((extension) => `.${extension}`),
  'image/*',
  'text/*',
].join(',');

export const FILE_TYPES_HINT = '图片（PNG/JPG/WebP）或文本 / 代码文件';

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

function detectKind(file: File): 'text' | 'image' | null {
  const extension = extensionOf(file.name);
  if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (
    TEXT_EXTENSIONS.has(extension) ||
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    file.type === 'application/javascript' ||
    file.type === 'application/xml'
  ) {
    return 'text';
  }
  return null;
}

export interface AttachmentReadResult {
  attachments: MessageAttachment[];
  errors: string[];
}

async function readTextFile(file: File): Promise<MessageAttachment> {
  const raw = await file.text();
  const truncated = raw.length > MAX_TEXT_CHARS;
  return {
    id: createId('file'),
    name: file.name,
    mime: file.type || 'text/plain',
    size: file.size,
    kind: 'text',
    text: truncated
      ? `${raw.slice(0, MAX_TEXT_CHARS)}\n\n…（文件过长，仅发送前 ${MAX_TEXT_CHARS} 个字符）`
      : raw,
    truncated,
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片无法读取'));
    };
    image.src = url;
  });
}

async function encodeImage(
  image: HTMLImageElement,
  maxSide: number,
  quality: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法处理图片');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/webp', quality);
  return { dataUrl, width, height };
}

async function readImageFile(file: File): Promise<MessageAttachment> {
  const image = await loadImage(file);
  let encoded = await encodeImage(image, 1400, 0.8);
  if (encoded.dataUrl.length > 1_800_000) {
    encoded = await encodeImage(image, 1000, 0.7);
  }
  return {
    id: createId('img'),
    name: file.name,
    mime: 'image/webp',
    size: file.size,
    kind: 'image',
    dataUrl: encoded.dataUrl,
    width: encoded.width,
    height: encoded.height,
  };
}

/**
 * 把 File[] 转换成本地可保存的附件。
 * 文本/代码读取为纯文本；图片压缩后转成 WebP data URL。
 * 不支持的文件类型会进入 errors，由调用方 toast 提示。
 */
export async function readFilesAsAttachments(
  files: File[],
  existingCount = 0,
): Promise<AttachmentReadResult> {
  const attachments: MessageAttachment[] = [];
  const errors: string[] = [];
  const slots = Math.max(0, MAX_ATTACHMENTS - existingCount);
  const queue = files.slice(0, slots);
  if (files.length > slots) {
    errors.push(`最多同时上传 ${MAX_ATTACHMENTS} 个文件。`);
  }

  for (const file of queue) {
    const kind = detectKind(file);
    if (!kind) {
      errors.push(`不支持「${file.name}」。目前支持图片与文本 / 代码文件。`);
      continue;
    }
    try {
      if (kind === 'text') {
        if (file.size > MAX_TEXT_FILE_BYTES) {
          errors.push(`「${file.name}」超过 512 KB，文本文件请精简后再上传。`);
          continue;
        }
        attachments.push(await readTextFile(file));
      } else {
        if (file.size > MAX_IMAGE_FILE_BYTES) {
          errors.push(`「${file.name}」超过 10 MB，请压缩后再上传。`);
          continue;
        }
        attachments.push(await readImageFile(file));
      }
    } catch (error) {
      errors.push(
        `「${file.name}」读取失败：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  const imageTotal = attachments
    .filter((attachment) => attachment.kind === 'image')
    .reduce((sum, attachment) => sum + (attachment.dataUrl?.length || 0), 0);
  if (imageTotal > 3_200_000) {
    errors.push('图片总大小过大，请减少数量或压缩后再试。');
    return { attachments: [], errors };
  }

  return { attachments, errors };
}

export function attachmentLanguage(name: string): string | null {
  const extension = extensionOf(name);
  switch (extension) {
    case 'py':
      return 'python';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'jsx':
      return 'javascript';
    case 'java':
      return 'java';
    case 'c':
    case 'h':
      return 'c';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return 'cpp';
    case 'go':
      return 'go';
    case 'json':
      return 'json';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'sql':
      return 'sql';
    case 'sh':
    case 'bash':
      return 'bash';
    default:
      return null;
  }
}
