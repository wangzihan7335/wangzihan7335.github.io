import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Code2, Copy } from 'lucide-react';
import 'highlight.js/styles/github-dark-dimmed.css';
import { copyText } from '../lib/utils';

const LANGUAGE_LABELS: Record<string, string> = {
  py: 'Python',
  python: 'Python',
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  cs: 'C#',
  csharp: 'C#',
  go: 'Go',
  rust: 'Rust',
  rb: 'Ruby',
  ruby: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  kotlin: 'Kotlin',
  sql: 'SQL',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  text: 'Text',
  txt: 'Text',
  plaintext: 'Text',
  output: '输出',
};

function nodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToText(node.props.children);
  }
  return '';
}

function CodeBlock({ children }: { children: ReactNode }) {
  const firstChild = Children.toArray(children)[0];
  const codeElement = isValidElement<{ className?: string; children?: ReactNode }>(firstChild)
    ? (firstChild as ReactElement<{ className?: string; children?: ReactNode }>)
    : null;
  const className = codeElement?.props.className || '';
  const codeChildren = codeElement?.props.children ?? children;
  const languageMatch = /language-([\w+#-]+)/.exec(className);
  const language = (languageMatch?.[1] || 'text').toLowerCase();
  const codeText = nodeToText(codeChildren).replace(/\n$/, '');
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    const ok = await copyText(codeText);
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-block-lang">
          <Code2 size={13} strokeWidth={1.8} />
          {LANGUAGE_LABELS[language] || language}
        </span>
        <button
          type="button"
          className="code-copy"
          onClick={handleCopy}
          title="复制代码"
          aria-label="复制代码"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre>
        <code className={className}>{codeChildren}</code>
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  pre({ children }) {
    return <CodeBlock>{children}</CodeBlock>;
  },
  a({ href, children, ...props }) {
    const external = Boolean(href && /^https?:\/\//i.test(href));
    return (
      <a
        href={href}
        {...props}
        {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      >
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

interface MarkdownProps {
  content: string;
  variant?: 'assistant' | 'user' | 'note';
  className?: string;
}

export const Markdown = memo(function Markdown({
  content,
  variant = 'assistant',
  className = '',
}: MarkdownProps) {
  return (
    <div className={`md-content md-${variant} ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={markdownComponents}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
