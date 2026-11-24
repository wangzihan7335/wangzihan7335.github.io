import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import cpp from 'highlight.js/lib/languages/cpp';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import go from 'highlight.js/lib/languages/go';

hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('java', java);
hljs.registerLanguage('c', c);
hljs.registerLanguage('go', go);

export type CodeLanguage = 'python' | 'javascript' | 'typescript' | 'cpp' | 'java' | 'c' | 'go';

export interface CodeLanguageOption {
  id: CodeLanguage;
  label: string;
  short: string;
}

export const CODE_LANGUAGES: CodeLanguageOption[] = [
  { id: 'python', label: 'Python', short: 'py' },
  { id: 'javascript', label: 'JavaScript', short: 'js' },
  { id: 'typescript', label: 'TypeScript', short: 'ts' },
  { id: 'cpp', label: 'C++', short: 'cpp' },
  { id: 'java', label: 'Java', short: 'java' },
  { id: 'c', label: 'C', short: 'c' },
  { id: 'go', label: 'Go', short: 'go' },
];

export function languageLabel(language: CodeLanguage): string {
  return CODE_LANGUAGES.find((item) => item.id === language)?.label || language;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function highlightCode(code: string, language: CodeLanguage): string {
  if (!code) return '';
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

/** 返回当前光标旁边括号的配对位置；找不到时返回 null。 */
export function findMatchingBrackets(
  code: string,
  caret: number,
): [number, number] | null {
  const pairs: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    ')': '(',
    ']': '[',
    '}': '{',
  };
  const positions = [caret - 1, caret].filter((index) => index >= 0 && index < code.length);
  for (const index of positions) {
    const char = code[index];
    if (!pairs[char]) continue;
    const forward = char === '(' || char === '[' || char === '{';
    const match = pairs[char];
    let depth = 0;
    if (forward) {
      for (let i = index; i < code.length; i += 1) {
        if (code[i] === char) depth += 1;
        else if (code[i] === match) {
          depth -= 1;
          if (depth === 0) return [index, i];
        }
      }
    } else {
      for (let i = index; i >= 0; i -= 1) {
        if (code[i] === char) depth += 1;
        else if (code[i] === match) {
          depth -= 1;
          if (depth === 0) return [index, i];
        }
      }
    }
  }
  return null;
}
