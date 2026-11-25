import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from 'react';
import {
  CODE_LANGUAGES,
  findMatchingBrackets,
  highlightCode,
  languageLabel,
  type CodeLanguage,
} from '../lib/code';

const INDENT = '  ';
const LINE_HEIGHT = 22;
const PADDING_Y = 12;

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage;
  onLanguageChange: (language: CodeLanguage) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`',
};

const CLOSERS = new Set([')', ']', '}', '"', "'", '`']);

function wrapCharacterAt(root: HTMLElement, offset: number, className: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const length = node.data.length;
    if (remaining < length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.setEnd(node, remaining + 1);
      const wrapper = document.createElement('span');
      wrapper.className = className;
      try {
        range.surroundContents(wrapper);
      } catch {
        // 跨节点时放弃本次高亮。
      }
      return;
    }
    remaining -= length;
    node = walker.nextNode() as Text | null;
  }
}

export function CodeEditor({
  value,
  onChange,
  language,
  onLanguageChange,
  disabled = false,
  autoFocus = false,
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const codeRef = useRef<HTMLElement | null>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const [caret, setCaret] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  const lines = useMemo(() => value.split('\n'), [value]);
  const lineCount = Math.max(1, lines.length);
  const activeLine = useMemo(() => {
    let line = 0;
    for (let index = 0; index < Math.min(caret, value.length); index += 1) {
      if (value[index] === '\n') line += 1;
    }
    return line;
  }, [caret, value]);
  const highlighted = useMemo(() => highlightCode(value, language), [value, language]);

  useLayoutEffect(() => {
    const codeElement = codeRef.current;
    if (!codeElement) return;
    codeElement.innerHTML = highlighted || '<span class="code-editor-empty"></span>';
    const pair = findMatchingBrackets(value, caret);
    if (pair) {
      const first = Math.min(pair[0], pair[1]);
      const second = Math.max(pair[0], pair[1]);
      wrapCharacterAt(codeElement, second, 'code-bracket-match');
      wrapCharacterAt(codeElement, first, 'code-bracket-match');
    }
    const textarea = textareaRef.current;
    if (textarea) {
      if (highlightRef.current) {
        highlightRef.current.scrollTop = textarea.scrollTop;
        highlightRef.current.scrollLeft = textarea.scrollLeft;
      }
      if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
    }
  }, [highlighted, caret, value]);

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending) return;
    pendingSelectionRef.current = null;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(pending.start, pending.end);
    setCaret(pending.start);
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
    setScrollTop(textarea.scrollTop);
  }, [value]);

  const syncScroll = (event?: UIEvent<HTMLTextAreaElement>) => {
    const textarea = event?.currentTarget || textareaRef.current;
    if (!textarea) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = textarea.scrollTop;
    }
    setScrollTop(textarea.scrollTop);
  };

  const syncCaret = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setCaret(textarea.selectionStart);
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
    setScrollTop(textarea.scrollTop);
  };

  const applyEdit = (next: string, start: number, end = start) => {
    pendingSelectionRef.current = { start, end };
    onChange(next);
    const textarea = textareaRef.current;
    if (textarea) {
      // 立刻写入 DOM，避免受控组件在 React 更新前的光标跳回开头。
      textarea.value = next;
      textarea.setSelectionRange(start, end);
    }
    setCaret(start);
  };

  const lineStartAt = (text: string, position: number) => text.lastIndexOf('\n', position - 1) + 1;

  const outdentCurrentLine = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const lineStart = lineStartAt(value, start);
    const prefix = value.slice(lineStart, start);
    const removeCount = prefix.endsWith(INDENT)
      ? INDENT.length
      : prefix.endsWith(' ')
        ? 1
        : 0;
    if (!removeCount) return;
    const next = value.slice(0, start - removeCount) + value.slice(start);
    applyEdit(next, start - removeCount, Math.max(start - removeCount, end - removeCount));
  };

  const insertIndent = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    if (start === end) {
      const next = value.slice(0, start) + INDENT + value.slice(end);
      applyEdit(next, start + INDENT.length);
      return;
    }

    // 选中多行时，为涉及的每一行整体缩进。
    const blockStart = lineStartAt(value, start);
    const nextNewline = value.indexOf('\n', end);
    const blockEnd = nextNewline === -1 ? value.length : nextNewline;
    const block = value.slice(blockStart, blockEnd);
    const blockLines = block.split('\n');
    const indented = blockLines.map((line) => `${INDENT}${line}`).join('\n');
    const next = value.slice(0, blockStart) + indented + value.slice(blockEnd);
    const addedBeforeSelection = INDENT.length;
    const addedWithinSelection = blockLines.length * INDENT.length;
    applyEdit(
      next,
      start + addedBeforeSelection,
      Math.min(next.length, end + addedWithinSelection),
    );
  };

  const insertNewLine = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lineStart = lineStartAt(value, start);
    const currentLine = before.slice(lineStart);
    const baseIndent = /^\s*/.exec(currentLine)?.[0] || '';
    const trimmed = currentLine.trimEnd();
    const nextChar = after[0];
    const shouldOpenBlock = /[[({]$/.test(trimmed) || trimmed.endsWith(':');
    const closingMatch =
      (trimmed.endsWith('{') && nextChar === '}') ||
      (trimmed.endsWith('(') && nextChar === ')') ||
      (trimmed.endsWith('[') && nextChar === ']');

    let insertion: string;
    let caretOffset: number;
    if (closingMatch) {
      insertion = `\n${baseIndent}${INDENT}\n${baseIndent}`;
      caretOffset = baseIndent.length + INDENT.length + 1;
    } else {
      const indent = shouldOpenBlock ? baseIndent + INDENT : baseIndent;
      insertion = `\n${indent}`;
      caretOffset = insertion.length;
    }
    const next = value.slice(0, start) + insertion + value.slice(end);
    applyEdit(next, start + caretOffset);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled || event.nativeEvent.isComposing) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const selection = value.slice(start, end);

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) outdentCurrentLine();
      else insertIndent();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      insertNewLine();
      return;
    }

    if (event.key === 'Backspace' && start === end && start > 0) {
      const beforeChar = value[start - 1];
      const afterChar = value[start];
      if (PAIRS[beforeChar] === afterChar && CLOSERS.has(afterChar)) {
        event.preventDefault();
        const next = value.slice(0, start - 1) + value.slice(start + 1);
        applyEdit(next, start - 1);
      }
      return;
    }

    if (PAIRS[event.key]) {
      event.preventDefault();
      const closing = PAIRS[event.key];
      if (selection) {
        const next = value.slice(0, start) + event.key + selection + closing + value.slice(end);
        applyEdit(next, start + 1, start + 1 + selection.length);
      } else {
        const next = value.slice(0, start) + event.key + closing + value.slice(end);
        applyEdit(next, start + 1);
      }
      return;
    }

    if (CLOSERS.has(event.key) && start === end && value[start] === event.key) {
      event.preventDefault();
      textarea.setSelectionRange(start + 1, start + 1);
      setCaret(start + 1);
    }
  };

  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1),
    [lineCount],
  );

  return (
    <div className={`code-editor ${disabled ? 'is-disabled' : ''} ${isComposing ? 'is-composing' : ''}`}>
      <div className="code-editor-toolbar">
        <span className="code-editor-title">代码</span>
        <div className="code-editor-toolbar-right">
          <select
            value={language}
            onChange={(event) => onLanguageChange(event.target.value as CodeLanguage)}
            aria-label="代码语言"
            className="language-select"
          >
            {CODE_LANGUAGES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="code-editor-shortcut">Tab 缩进 · 自动配对</span>
        </div>
      </div>

      <div className="code-editor-surface">
        <div className="code-gutter" ref={gutterRef} aria-hidden="true">
          <div className="code-gutter-lines" style={{ paddingTop: PADDING_Y }}>
            {lineNumbers.map((number) => (
              <span
                key={number}
                className={number - 1 === activeLine ? 'is-active' : ''}
                style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
              >
                {number}
              </span>
            ))}
          </div>
        </div>
        <div className="code-main">
          <div
            className="code-current-line"
            style={{ top: PADDING_Y + activeLine * LINE_HEIGHT - scrollTop }}
            aria-hidden="true"
          />
          <div className="code-highlight-scroll" ref={highlightRef} aria-hidden="true">
            <pre style={{ padding: `${PADDING_Y}px 16px`, lineHeight: `${LINE_HEIGHT}px` }}>
              {/* 不挂 hljs 类：Markdown 主题会给 pre code.hljs 加 padding/overflow，
                  与透明 textarea 的光标和行号错位。 */}
              <code ref={codeRef} className={`language-${language}`} />
            </pre>
          </div>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setCaret(event.target.selectionStart);
            }}
            onSelect={syncCaret}
            onKeyDown={handleKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onScroll={syncScroll}
            onFocus={syncCaret}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            spellCheck={false}
            wrap="off"
            disabled={disabled}
            aria-label="代码编辑器"
            placeholder={`用 ${languageLabel(language)} 写下你的代码…`}
            style={{ lineHeight: `${LINE_HEIGHT}px` }}
          />
        </div>
      </div>

      <div className="code-editor-footer">
        <span>{lineCount} 行</span>
      </div>
    </div>
  );
}
