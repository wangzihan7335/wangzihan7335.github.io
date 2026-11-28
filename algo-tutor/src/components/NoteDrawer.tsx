import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Download, FileText, X } from 'lucide-react';
import type { Session } from '../types';
import {
  copyText,
  downloadTextFile,
  formatFileSafeTitle,
  formatFullDate,
  markdownToPlainText,
} from '../lib/utils';
import { Markdown } from './Markdown';

interface NoteDrawerProps {
  open: boolean;
  session: Session | null;
  onClose: () => void;
  onToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

export function NoteDrawer({ open, session, onClose, onToast }: NoteDrawerProps) {
  const [copied, setCopied] = useState<'markdown' | 'plain' | null>(null);
  const note = session?.note;

  useEffect(() => {
    if (!open) return;
    setCopied(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !note || !session) return null;

  const handleCopy = async () => {
    const ok = await copyText(note.markdown);
    if (!ok) {
      onToast('复制失败，请手动选择笔记内容。', 'error');
      return;
    }
    setCopied('markdown');
    onToast('笔记已复制为 Markdown。', 'success');
    window.setTimeout(() => setCopied(null), 1800);
  };

  const handleCopyPlain = async () => {
    const ok = await copyText(markdownToPlainText(note.markdown));
    if (!ok) {
      onToast('复制失败，请手动选择笔记内容。', 'error');
      return;
    }
    setCopied('plain');
    onToast('手抄版已复制为纯文本，可以直接照着抄。', 'success');
    window.setTimeout(() => setCopied(null), 1800);
  };

  const handleDownload = () => {
    downloadTextFile(
      `${formatFileSafeTitle(note.title || session.title)}.md`,
      note.markdown,
      'text/markdown',
    );
    onToast('已下载笔记。', 'success');
  };

  return createPortal(
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="note-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-drawer-title"
      >
        <header className="note-drawer-head">
          <div className="note-drawer-title">
            <span className="note-drawer-eyebrow">复习笔记</span>
            <h2 id="note-drawer-title">{note.title || session.title}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭笔记">
            <X size={18} />
          </button>
        </header>

        <div className="note-meta-row">
          <span>{formatFullDate(note.createdAt)}</span>
          <span className="meta-dot">·</span>
          <span>{session.messages.length} 条对话</span>
        </div>

        <div className="note-drawer-actions">
          <button type="button" className="link-button" onClick={handleCopy}>
            {copied === 'markdown' ? <Check size={13} /> : <Copy size={13} />}
            {copied === 'markdown' ? '已复制' : '复制 Markdown'}
          </button>
          <button type="button" className="link-button" onClick={handleCopyPlain}>
            {copied === 'plain' ? <Check size={13} /> : <FileText size={13} />}
            {copied === 'plain' ? '已复制' : '复制手抄版'}
          </button>
          <button type="button" className="link-button" onClick={handleDownload}>
            <Download size={13} />
            下载 .md
          </button>
        </div>

        <div className="note-scroll">
          <Markdown content={note.markdown} variant="note" />
        </div>
      </aside>
    </div>,
    document.body,
  );
}
