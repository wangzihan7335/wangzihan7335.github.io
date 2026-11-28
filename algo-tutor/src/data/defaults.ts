import type { ModelConfig } from '../types';

/**
 * 内置演示模型。
 * 它走的是和真实模型完全一样的 title / knowledge / knowledge-result 协议，
 * 方便用户在没有任何 API Key 时完整体验产品。
 */
export const DEMO_CONFIG: ModelConfig = {
  id: 'demo-local',
  name: '演示助教',
  baseUrl: 'mock://local',
  apiKey: '',
  model: 'demo-tutor',
  temperature: 0.7,
  stream: true,
};

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hint: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hint: '填写 DeepSeek 开放平台的 Key',
  },
  {
    id: 'kimi',
    name: 'Kimi / 月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: '填写 Moonshot 控制台的 Key',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '需要可访问 OpenAI 的网络',
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: '使用 DashScope 兼容模式 Key',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash-250414',
    hint: '填写智谱开放平台的 Key；图片请改用视觉模型',
  },
];

export const EXAMPLE_PROBLEMS = [
  {
    tag: '模拟',
    title: '一年中的第几天',
    description: '输入 YYYY-MM-DD，返回这一天是当年的第几天。闰年规则要算对。',
    prompt:
      '给你一个字符串日期 date（格式 YYYY-MM-DD），请返回该日期是当年的第几天。注意闰年：能被 4 整除但不能被 100 整除，或能被 400 整除的年份为闰年。',
  },
  {
    tag: '数组',
    title: '两数之和',
    description: '在数组中找到两个数，使它们的和等于目标值，返回下标。',
    prompt:
      '给定一个整数数组 nums 和一个整数目标值 target，请找出数组中和为目标值 target 的两个整数，并返回它们的数组下标。假设每种输入只会对应一个答案，同一个元素不能重复使用。',
  },
  {
    tag: '字符串',
    title: '有效的括号',
    description: '判断只含括号的字符串是否按正确顺序闭合。',
    prompt:
      '给定一个只包括 "("，")"，"{"，"}"，"["，"]" 的字符串 s，判断字符串是否有效。有效字符串需满足：左括号必须用相同类型的右括号闭合，且必须以正确的顺序闭合。',
  },
];
