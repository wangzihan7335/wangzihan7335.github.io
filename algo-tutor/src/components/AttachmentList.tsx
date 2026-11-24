import { FileText, Image as ImageIcon, X } from 'lucide-react';
import type { MessageAttachment } from '../types';
import { formatFileSize } from '../lib/attachments';

interface AttachmentListProps {
  attachments: MessageAttachment[];
  variant?: 'composer' | 'message';
  onRemove?: (id: string) => void;
}

export function AttachmentList({
  attachments,
  variant = 'composer',
  onRemove,
}: AttachmentListProps) {
  if (!attachments.length) return null;

  return (
    <div className={`attachment-list attachment-list--${variant}`}>
      {attachments.map((attachment) => (
        <div
          className={`attachment-card attachment-card--${attachment.kind}`}
          key={attachment.id}
          title={attachment.truncated ? '文件较长，只发送了前一部分内容' : attachment.name}
        >
          {attachment.kind === 'image' && attachment.dataUrl ? (
            <a
              className="attachment-preview"
              href={attachment.dataUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`查看图片 ${attachment.name}`}
            >
              <img src={attachment.dataUrl} alt={attachment.name} />
            </a>
          ) : (
            <span className="attachment-icon">
              <FileText size={15} />
            </span>
          )}

          <span className="attachment-copy">
            <span className="attachment-name">{attachment.name}</span>
            <span className="attachment-meta">
              {attachment.kind === 'image' ? (
                <>
                  <ImageIcon size={10} />
                  图片
                </>
              ) : (
                formatFileSize(attachment.size)
              )}
              {attachment.truncated ? ' · 已截取' : ''}
            </span>
          </span>

          {onRemove && (
            <button
              type="button"
              className="attachment-remove"
              onClick={() => onRemove(attachment.id)}
              aria-label={`移除 ${attachment.name}`}
              title="移除"
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
