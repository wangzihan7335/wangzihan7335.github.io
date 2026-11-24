import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Paperclip } from 'lucide-react';
import type { MessageAttachment } from '../types';
import {
  FILE_ACCEPT,
  MAX_ATTACHMENTS,
  readFilesAsAttachments,
} from '../lib/attachments';
import type { CodeLanguage } from '../lib/code';
import { languageLabel } from '../lib/code';
import { cn } from '../lib/utils';
import { AttachmentList } from './AttachmentList';
import { CodeEditor } from './CodeEditor';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (attachments: MessageAttachment[]) => boolean;
  onSendCode: (payload: {
    code: string;
    language: CodeLanguage;
    attachments: MessageAttachment[];
  }) => boolean;
  onStop: () => void;
  isStreamingHere: boolean;
  isStreamingElsewhere: boolean;
  hasSession: boolean;
  hasAssistantMessage: boolean;
  focusToken: number;
  onQuickAction: (text: string) => void;
  onToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

type ComposerMode = 'chat' | 'code';

export function Composer({
  value,
  onChange,
  onSend,
  onSendCode,
  onStop,
  isStreamingHere,
  isStreamingElsewhere,
  hasSession,
  hasAssistantMessage,
  focusToken,
  onQuickAction,
  onToast,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [mode, setMode] = useState<ComposerMode>('chat');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isReadingFiles, setIsReadingFiles] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<CodeLanguage>('python');

  useEffect(() => {
    if (mode !== 'chat') return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [value, mode]);

  useEffect(() => {
    if (!focusToken) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const frame = requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusToken]);

  const canSendChat =
    !isStreamingHere &&
    !isStreamingElsewhere &&
    !isReadingFiles &&
    (value.trim().length > 0 || attachments.length > 0);

  const canSendCode =
    !isStreamingHere && !isStreamingElsewhere && !isReadingFiles && code.trim().length > 0;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSendChat) handleSendChat();
  };

  const handleSendChat = () => {
    if (!canSendChat) return;
    const sent = onSend(attachments);
    if (sent) setAttachments([]);
  };

  const handleSendCode = () => {
    if (!canSendCode) return;
    const sent = onSendCode({ code, language, attachments });
    if (sent) {
      setAttachments([]);
      setMode('chat');
    }
  };

  const addFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length || isReadingFiles) return;
    if (attachments.length >= MAX_ATTACHMENTS) {
      onToast(`最多同时上传 ${MAX_ATTACHMENTS} 个文件。`, 'error');
      return;
    }
    setIsReadingFiles(true);
    try {
      const result = await readFilesAsAttachments(files, attachments.length);
      if (result.attachments.length) {
        setAttachments((previous) =>
          [...previous, ...result.attachments].slice(0, MAX_ATTACHMENTS),
        );
      }
      if (result.attachments.some((attachment) => attachment.truncated)) {
        onToast('部分文件较长，已只保留可发送的前一段内容。', 'info');
      }
      for (const error of result.errors.slice(0, 2)) {
        onToast(error, 'error');
      }
    } finally {
      setIsReadingFiles(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((previous) => previous.filter((attachment) => attachment.id !== id));
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (isStreamingHere || isStreamingElsewhere) return;
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isStreamingHere || isStreamingElsewhere) return;
    void addFiles(event.dataTransfer.files);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  };

  const switchMode = (nextMode: ComposerMode) => {
    setMode(nextMode);
    if (nextMode === 'chat') {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const hasImageAttachment = attachments.some((attachment) => attachment.kind === 'image');

  let placeholder = '写下题目，或说说你卡在哪一步…';
  if (hasSession) placeholder = '说说你的想法，或把代码、题目截图拖进来…';
  if (isStreamingElsewhere) placeholder = '另一段对话正在生成…';

  return (
    <div className="composer-zone">
      <div
        className={cn(
          'composer',
          focused && mode === 'chat' && 'is-focused',
          mode === 'code' && 'is-code-mode',
          isDragging && 'is-dragging',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="composer-top">
          <div className="composer-tabs" role="tablist" aria-label="输入模式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'chat'}
              className={cn('composer-tab', mode === 'chat' && 'is-active')}
              onClick={() => switchMode('chat')}
            >
              对话
            </button>
            <span className="composer-tab-sep">/</span>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'code'}
              className={cn('composer-tab', mode === 'code' && 'is-active')}
              onClick={() => switchMode('code')}
            >
              代码
            </button>
          </div>
          <span className="composer-top-note">
            {mode === 'chat'
              ? isStreamingElsewhere
                ? '另一段对话生成中'
                : hasImageAttachment
                  ? '图片需要支持视觉的模型'
                  : '可以粘贴题目截图或文件'
              : ''}
          </span>
        </div>

        <AttachmentList
          attachments={attachments}
          onRemove={removeAttachment}
          variant="composer"
        />

        {mode === 'chat' ? (
          <>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onPaste={handlePaste}
              placeholder={placeholder}
              aria-label="输入题目或回复"
              rows={1}
              disabled={isStreamingElsewhere}
            />

            <div className="composer-bottom">
              <div className="composer-tools">
                <button
                  type="button"
                  className="attach-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isReadingFiles || isStreamingElsewhere}
                  title="上传图片、文本或代码文件"
                >
                  {isReadingFiles ? (
                    <Loader2 size={13} className="spin" />
                  ) : (
                    <Paperclip size={13} />
                  )}
                  <span>{isReadingFiles ? '读取中' : '文件'}</span>
                </button>
                {attachments.length > 0 && (
                  <span className="attachment-count">
                    {attachments.length}/{MAX_ATTACHMENTS}
                  </span>
                )}
                {hasSession &&
                  hasAssistantMessage &&
                  !attachments.length &&
                  !isStreamingHere &&
                  !isStreamingElsewhere && (
                    <>
                      <span className="quick-dot">·</span>
                      <button
                        type="button"
                        className="quick-link"
                        onClick={() =>
                          onQuickAction('给我一个提示，但先不要给出完整代码。')
                        }
                      >
                        给一点提示
                      </button>
                      <span className="quick-dot">·</span>
                      <button
                        type="button"
                        className="quick-link"
                        onClick={() => onQuickAction('完成，帮我生成复习笔记。')}
                      >
                        完成，生成笔记
                      </button>
                    </>
                  )}
              </div>

              <div className="composer-actions">
                {isStreamingHere ? (
                  <button
                    type="button"
                    className="stop-button"
                    onClick={onStop}
                    aria-label="停止生成"
                    title="停止生成"
                  >
                    停下
                  </button>
                ) : (
                  <button
                    type="button"
                    className="send-button"
                    onClick={handleSendChat}
                    disabled={!canSendChat}
                    aria-label="发送"
                    title="发送"
                  >
                    <ArrowUp size={17} strokeWidth={1.8} />
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <CodeEditor
              value={code}
              onChange={setCode}
              language={language}
              onLanguageChange={setLanguage}
              disabled={isStreamingElsewhere}
              autoFocus
            />
            <div className="composer-code-bottom">
              <div className="composer-code-meta">
                <button
                  type="button"
                  className="attach-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isReadingFiles || isStreamingElsewhere}
                  title="附带图片、文本或代码文件"
                >
                  {isReadingFiles ? (
                    <Loader2 size={13} className="spin" />
                  ) : (
                    <Paperclip size={13} />
                  )}
                  <span>{isReadingFiles ? '读取中' : '文件'}</span>
                </button>
                <span className="composer-code-hint">
                  {isStreamingHere
                    ? '助教正在回复，仍可继续修改代码'
                    : isReadingFiles
                      ? '正在读取附件…'
                      : '代码会作为带语法标记的代码块发送'}
                </span>
              </div>
              {isStreamingHere ? (
                <button type="button" className="stop-button" onClick={onStop}>
                  停下
                </button>
              ) : (
                <button
                  type="button"
                  className="ink-button send-code-button"
                  onClick={handleSendCode}
                  disabled={!canSendCode}
                >
                  发送代码
                </button>
              )}
            </div>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept={FILE_ACCEPT}
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = '';
          }}
        />

        {isDragging && <div className="composer-drop-hint">松开，添加文件</div>}
      </div>

      <div className="composer-foot">
        {mode === 'chat' ? (
          <>
            <span>Enter 发送 · Shift + Enter 换行</span>
            <span>支持图片、文本与代码文件</span>
          </>
        ) : (
          <>
            <span>Tab 缩进 · Shift + Tab 反缩进 · 自动闭合括号与引号</span>
            <span>{languageLabel(language)}</span>
          </>
        )}
      </div>
    </div>
  );
}
