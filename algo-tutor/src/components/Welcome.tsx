import { KeyRound } from 'lucide-react';
import type { ModelConfig } from '../types';
import { EXAMPLE_PROBLEMS } from '../data/defaults';

interface WelcomeProps {
  config: ModelConfig | null;
  onPickExample: (prompt: string) => void;
  onOpenSettings: () => void;
  isStreaming: boolean;
}

export function Welcome({
  config,
  onPickExample,
  onOpenSettings,
  isStreaming,
}: WelcomeProps) {
  const isDemo = Boolean(config?.baseUrl.startsWith('mock://'));
  const needsKey = !config || isDemo || !config.apiKey.trim();

  return (
    <section className="welcome">
      <div className="welcome-main">
        <p className="welcome-kicker">苏格拉底式算法陪练</p>
        <h1 className="welcome-title">
          先想一步，
          <br />
          <em>再写一行。</em>
        </h1>
        <p className="welcome-lede">
          不直接给答案。拆开知识点，问对问题，
          <br />
          陪你把「不会」慢慢想成「会」。
        </p>

        <div className="example-block">
          <span className="section-label">从一道题开始</span>
          <div className="example-list">
            {EXAMPLE_PROBLEMS.map((example, index) => (
              <button
                type="button"
                key={example.title}
                className="example-item"
                onClick={() => onPickExample(example.prompt)}
                disabled={isStreaming}
              >
                <span className="example-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="example-title">{example.title}</span>
                <span className="example-tag">{example.tag}</span>
                <span className="example-arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            ))}
          </div>
        </div>

        {needsKey && (
          <div className="welcome-setup">
            <div className="welcome-setup-copy">
              <span className="welcome-setup-kicker">
                <KeyRound size={12} strokeWidth={1.8} />
                在线使用 · 自带 API Key
              </span>
              <p>
                {isDemo
                  ? '演示模型可以直接体验流程；'
                  : '当前模型还没有填写 API Key；'}
                真实 AI 需要你在「模型设置」里填入自己的 Key。
                <small>Key 只保存在本浏览器，不会写入服务器。</small>
              </p>
            </div>
            <button type="button" className="welcome-setup-action" onClick={onOpenSettings}>
              填入我的 Key
            </button>
          </div>
        )}
      </div>

      <div className="welcome-doodle" aria-hidden="true">
        <svg viewBox="0 0 196 232" fill="none">
          <path
            d="M24 211c39-9 102-8 157-19"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.22"
          />
          <path
            d="M31 195h33v-30h33v-30h33V105"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.72"
          />
          <path
            d="M26 195c-3 4-5 8-6 12M64 165c3-4 5-8 6-12M97 135c3-4 5-8 6-12"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.18"
          />
          <path
            d="M126 88c7-7 15-10 25-9"
            stroke="#a74f38"
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.7"
          />
          <circle
            cx="157"
            cy="66"
            r="13"
            stroke="#a74f38"
            strokeWidth="1.1"
            opacity="0.55"
          />
          <path
            d="M157 49v-8M157 83v8M140 66h-8M174 66h8"
            stroke="#a74f38"
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.4"
          />
          <path
            d="M63 55c4-7 6-15 5-23M53 44c7 2 15 2 22-1"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.24"
          />
          <path
            d="M130 194c7-3 14-3 21 0"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.24"
          />
        </svg>
        <span className="doodle-caption">一步一步来</span>
      </div>
    </section>
  );
}
