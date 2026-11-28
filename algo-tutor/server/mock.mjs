/**
 * server/mock.mjs
 * ---------------------------------------------------------------------------
 * 「演示模型」的本地剧本。
 *
 * 它只做一件事：在不填写任何 API Key 的情况下，让整个产品流程可以完整体验：
 *   题目 → title 块 → knowledge 块 → 选择掌握程度 → 讲解 → 引导 → 贴代码 → 完成 → 笔记
 *
 * 它刻意复用与真实模型完全相同的协议（title / knowledge / knowledge-result），
 * 因此前端不需要为演示模式写任何特殊分支。
 * ---------------------------------------------------------------------------
 */

const FENCE = '```';

export const DEMO_MODEL_NAME = '演示助教';

function clip(text, max = 15) {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}` : text;
}

function cleanText(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mockTitle(problem) {
  const text = cleanText(problem);
  const rules = [
    [/日期|闰年|一年中|一年中的第/, '日期转年内第几天'],
    [/请检查这段.*代码|代码纠错/, '代码纠错'],
    [/两数之和|two.?sum|目标值\s*target|target\s*.*(两个|下标)/i, '两数之和'],
    [/三数|中间值/, '三数取中间值'],
    [/反转链表|链表反转/, '反转链表'],
    [/括号|parenthes/i, '有效括号判断'],
    [/最长.*子串|substring/i, '最长无重复子串'],
    [/二分|旋转数组|binary/i, '旋转数组二分查找'],
    [/爬楼梯|台阶/, '爬楼梯方案数'],
    [/合并.*区间|interval/i, '合并区间'],
    [/回文|palindrom/i, '回文串判断'],
  ];
  for (const [pattern, title] of rules) {
    if (pattern.test(text)) return title;
  }
  const fallback = text.slice(0, 15);
  return fallback || '新的算法练习';
}

function pickPoints(problem) {
  const text = cleanText(problem);
  if (/日期|闰年|一年中|一年中的第/.test(text)) {
    return [
      { id: 1, name: '闰年判断规则', role: '决定二月是 28 天还是 29 天，影响后续累计' },
      { id: 2, name: '月份天数累计', role: '把整月天数先相加，再补上当月的日号' },
      { id: 3, name: '边界与输入处理', role: '处理一月、十二月下标和非法日期' },
    ];
  }
  if (/链表/.test(text)) {
    return [
      { id: 1, name: '链表节点与指针', role: '确定 next 指针的起点和终止条件' },
      { id: 2, name: '指针修改顺序', role: '先保存后继再改指针，防止链表断裂' },
      { id: 3, name: '空链表与单节点边界', role: '处理空链表、单节点和尾节点的指针' },
    ];
  }
  if (/两数之和|two.?sum|目标值\s*target/i.test(text)) {
    return [
      { id: 1, name: '哈希表查找', role: '把已遍历元素的查找从 O(n) 降到 O(1)' },
      { id: 2, name: '一边遍历一边建表', role: '每个元素只扫一次，查完就写入 seen' },
      { id: 3, name: '重复元素与索引边界', role: '避免同一个元素被用两次并保留下标' },
    ];
  }
  if (/括号|parenthes/i.test(text)) {
    return [
      { id: 1, name: '栈的先进后出', role: '用后进先出匹配最近的未闭合左括号' },
      { id: 2, name: '左右括号配对规则', role: '决定遇到右括号时应该弹出哪一个左括号' },
      { id: 3, name: '空串与奇偶长度边界', role: '处理空串、提前出现的右括号和长度奇偶' },
    ];
  }
  return [
    { id: 1, name: '题意拆解与不变量', role: '固定输入输出与过程中始终成立的条件' },
    { id: 2, name: '数据结构选择', role: '让每一步操作都落在可接受的复杂度内' },
    { id: 3, name: '边界条件与复杂度', role: '避免漏掉空输入、单元素和极端数据' },
  ];
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part?.type === 'text') return String(part.text || '');
      if (part?.type === 'image_url') return '[用户上传了图片]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function contentHasImage(content) {
  return (
    Array.isArray(content) &&
    content.some((part) => part?.type === 'image_url')
  );
}

function extractLatestUser(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return contentToText(messages[i].content);
  }
  return '';
}

function extractKnowledgeResults(text) {
  const match = String(text).match(/\{[\s\S]*"results"[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed?.results) ? parsed.results : null;
  } catch {
    return null;
  }
}

function extractKnowledgePoints(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = contentToText(messages[i]?.content);
    const match = content.match(/```knowledge[^\n]*\n([\s\S]*?)```/i);
    if (!match) continue;
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed?.points)) return parsed.points;
    } catch {
      // 忽略不完整的历史块。
    }
  }
  return [];
}

const MASTERY_LABEL = {
  high: '高',
  medium: '中',
  low: '低',
  none: '不会',
};

function masterySentence(results) {
  if (!results?.length) return '先按你的节奏来。';
  const labels = results.map((r) => MASTERY_LABEL[r.mastery] || '未选择');
  return `收到，${labels.join(' / ')}，我记下了。`;
}

function explainPoint(name) {
  if (name.includes('闰年')) {
    return [
      '### 先讲「闰年判断」',
      '',
      '**它解决什么问题？** 二月有时 28 天、有时 29 天，所以「这一年到底怎么算」必须先有一个确定的规则。',
      '',
      '**规则可以写成一句人话：** 能被 4 整除，但不能被 100 整除的是闰年；例外是能被 400 整除的，仍然是闰年。',
      '',
      '```text',
      'leap = (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)',
      '```',
      '',
      '**最小例子：** 2024 是闰年；1900 不是；2000 是。',
      '',
      '**常见误区：** 只写 `year % 4 == 0`。这样 1900 会被误判为闰年，测试里很容易漏掉。',
      '',
      '先别急着写完整代码。你能用一句话说明：为什么 1900 和 2000 的结论不同吗？',
    ].join('\n');
  }
  if (name.includes('月份') || name.includes('天数')) {
    return [
      '### 先讲「月份天数累计」',
      '',
      '**核心动作：** 如果要求第 n 天，可以把「之前所有完整月份的天数」先加起来，再加上当月的日号。',
      '',
      '**最小例子：** 3 月 5 日 = 1 月天数 + 2 月天数 + 5。2 月天数由闰年决定，所以闰年判断是这一步的前置条件。',
      '',
      '**常见误区：** 用 12 个 `if` 硬编码，或者下标从 0 开始却把月份当成了 1 开始。',
      '',
      '如果已经知道每个月的天数，你会选择数组、前缀和，还是循环累加？各自的好处是什么？',
    ].join('\n');
  }
  if (name.includes('指针')) {
    return [
      '### 先讲「指针修改顺序」',
      '',
      '**为什么顺序重要？** 修改 `next` 之前，如果先把 `cur = cur.next`，原来的下一个节点就找不到了，链表会断。',
      '',
      '**一个安全的记忆法：** 先用临时变量记住下一个节点，再改指向，最后整体向前移动。',
      '',
      '**常见误区：** 三个指针的赋值顺序写反，或者循环结束后返回了 `head` 而不是新的头节点。',
      '',
      '你能先画一条 `1 → 2 → 3 → null` 的链表，然后口述第一步要改哪条箭头吗？',
    ].join('\n');
  }
  if (name.includes('哈希')) {
    return [
      '### 先讲「一边遍历一边建表」',
      '',
      '**它解决什么问题？** 把「找另一个数」从遍历变成 O(1) 的查表，整体复杂度从 O(n²) 降到 O(n)。',
      '',
      '**关键顺序：** 先查 `target - current` 是否出现过，再把当前值放进表里。反过来会把同一个元素用两次。',
      '',
      '**常见误区：** 忘记存下标；或者先全部建表，结果遇到重复元素时覆盖了错误的位置。',
      '',
      '如果数组是 `[3, 3]`、目标是 `6`，你的表里应该保留哪一个下标？为什么？',
    ].join('\n');
  }
  if (name.includes('栈') || name.includes('括号')) {
    return [
      '### 先讲「栈与括号配对」',
      '',
      '**为什么需要栈？** 左括号是「先来的要等后来的」，也就是后进先出；这正好是栈的性质。',
      '',
      '**最小例子：** `([])` 中，遇到 `]` 时最近一个未匹配的左括号必须是 `[`。',
      '',
      '**常见误区：** 只检查数量相等，不检查嵌套顺序；或者最后忘了判断栈是否为空。',
      '',
      '对于字符串 `([)]`，你能指出是哪一步配对失败吗？',
    ].join('\n');
  }
  return [
    `### 先讲「${name}」`,
    '',
    '**它解决什么问题？** 把它放回题目里看：这个知识点负责帮你减少哪一种重复计算，或者保证哪一条不变量始终成立。',
    '',
    '**最小例子：** 先用 3～5 个元素的小样例手算一次，把每一步的中间状态写出来。你会发现真正需要维护的信息通常只有一两个变量。',
    '',
    '**常见误区：** 只记结论不看适用条件；样例只测正常情况，漏掉空输入、单元素和极值。',
    '',
    '你能先用自己的话复述这个知识点在本题中负责哪一小步吗？',
  ].join('\n');
}

function buildOpening(problem) {
  const points = pickPoints(problem);
  const title = mockTitle(problem);
  return [
    `${FENCE}title`,
    title,
    FENCE,
    '',
    '这道题先不急着写代码。我们把它拆成几个可以分别攻克的小问题，你只需要根据自己的真实情况选择掌握程度。',
    '',
    `${FENCE}knowledge`,
    JSON.stringify({ points }),
    FENCE,
    '',
    '> 选择完四个按钮后点「确认掌握程度」，我会按你的选择安排讲解和引导。完全不会也没关系，这正是我们开始的地方。',
  ].join('\n');
}

function buildAfterKnowledge(problem, userText, messages) {
  const results = extractKnowledgeResults(userText) || [];
  const points = extractKnowledgePoints(messages);
  const nameById = new Map(points.map((p) => [Number(p.id), p.name]));
  const weak = results.filter((r) => r.mastery === 'low' || r.mastery === 'none');
  const strong = results.filter((r) => r.mastery === 'high' || r.mastery === 'medium');

  const pieces = [masterySentence(results)];
  if (strong.length) {
    pieces.push(
      `你标记为「${strong
        .map((r) => `${nameById.get(Number(r.id)) || `知识点 ${r.id}`}（${MASTERY_LABEL[r.mastery]}）`)
        .join('、')}」的部分，我就不展开讲了，后面会直接用。`,
    );
  }

  if (weak.length) {
    const firstName = nameById.get(Number(weak[0].id)) || '这个知识点';
    pieces.push('', explainPoint(firstName));
    if (weak.length > 1) {
      const rest = weak
        .slice(1)
        .map((r) => nameById.get(Number(r.id)) || `知识点 ${r.id}`)
        .join('、');
      pieces.push('', `另外 ${rest} 我也会在后面的步骤里逐步补上，不会一次塞给你。`);
    }
  } else {
    pieces.push('', '你的基础看起来不错。那我就直接从最容易卡住的地方开始提问。');
  }

  pieces.push(
    '',
    '---',
    '',
    '### 回到题目：先只做第一步',
    '',
    '暂时不要写完整函数。先回答我两个问题：',
    '',
    '1. 这道题的输入有哪几种边界情况？请至少说出两种。',
    '2. 你打算用什么变量保存「目前为止的答案」？它每一步如何更新？',
    '',
    '先想 30 秒，把想法用一两句话告诉我就行。',
  );
  return pieces.join('\n');
}

function buildCodeReview(userText, problem = '') {
  const codeMatch = userText.match(/```(?:python|js|javascript|java|cpp|c\+\+|ts|typescript)?[^\n]*\n([\s\S]*?)```/i);
  const code = codeMatch?.[1] || '';
  const lines = code.split('\n');
  const dateProblem = /日期|闰年|一年中|一年中的第/.test(cleanText(problem));
  const forLine = lines.findIndex((l) => /for\s*\(|while\s*\(|for\s+.+\s+in\s+/.test(l));
  const returnLine = lines.findIndex((l) => /return\b/.test(l));
  const daysLine = lines.findIndex((l) => /days\s*=|\[31\s*,\s*28/.test(l));
  const lineHint = forLine >= 0 ? `第 ${forLine + 1} 行附近` : '循环部分';

  if (dateProblem) {
    return [
      '我看到了你的代码，思路已经是「按月累计」了，方向没问题。先不直接改，我们盯住一个地方一起验证。',
      '',
      daysLine >= 0
        ? `**先看第 ${daysLine + 1} 行的月份天数表：** 二月的天数被固定成了 28。可是你前面已经算过闰年，这个信息在这里用上了吗？`
        : '**先看月份天数表：** 二月的天数是不是固定成了 28？闰年这个条件有没有参与这张表的构造？',
      '',
      returnLine >= 0
        ? `**再看第 ${returnLine + 1} 行的返回值：** 它对前几个月的天数求和后再加上 day，这一步本身是对的。但当前月份的天数不会被加进去——这也是正确的，所以问题更可能只出在二月。`
        : '**再看返回值：** 前几个月的天数求和后加上 day，这个关系本身是对的。问题更可能只出在二月。',
      '',
      '### 用一个最小反例追踪',
      '',
      '拿 `2024-03-01` 跑一遍你的代码：',
      '',
      '- 它应该返回多少？',
      '- 你的 `days` 表给出的前两个月天数之和是多少？',
      '- 两者相差的 1 天，是哪个规则造成的？',
      '',
      '把这三个答案写给我，再自己决定是改表，还是改表构造之前的某个变量。',
    ].join('\n');
  }

  return [
    '我看到了你的代码。先不直接改，我们按执行顺序一起体检。',
    '',
    `**先看 ${lineHint}：** 循环的起点、终点和「是否包含等号」是否和题目定义一致？很多错误不是语法问题，而是循环多走或少走了一次。`,
    '',
    returnLine >= 0
      ? `**再看第 ${returnLine + 1} 行的返回值：** 它返回的是答案本身，还是答案所在的下标 / 节点？类型和题意对得上吗？`
      : '**再看返回值：** 每个分支都有返回值吗？空输入、单元素输入会走到哪个分支？',
    '',
    '### 请你先自检这三项',
    '',
    '- [ ] 用题目给的第一个样例，手动模拟一次，记录循环里关键变量的值。',
    '- [ ] 用一个「最小输入」测试：空、1 个元素、2 个元素。',
    '- [ ] 用一个「边界输入」测试：最大值、重复值、全相同。',
    '',
    '把你在某一组样例上的变量追踪贴给我，我就能更准确地指出偏差发生在哪一步。',
  ].join('\n');
}

function buildHint(problem) {
  return [
    '给你一个不涉及最终代码的提示：',
    '',
    '**先回答：题目要求的「答案」在遍历过程中可以用哪一两个量表示？**',
    '',
    '如果你能写出这个量在每一步的更新规则，代码只是把规则翻译出来。先不要考虑语法，用中文写出：',
    '',
    '> 初始时，我令 ______；每处理一个元素，我 ______；全部处理完后，答案是 ______。',
    '',
    '试着把这三个空填上，再贴给我。',
  ].join('\n');
}

function buildNote(problem, messages) {
  const results = [];
  for (const message of messages) {
    if (message?.role !== 'user') continue;
    const parsed = extractKnowledgeResults(String(message.content || ''));
    if (parsed) results.splice(0, results.length, ...parsed);
  }
  const points = extractKnowledgePoints(messages);
  const pointById = new Map(points.map((p) => [Number(p.id), p]));
  const masteryLine = results.length
    ? results
        .map((r) => {
          const point = pointById.get(Number(r.id));
          const name = point?.name || `知识点 ${r.id}`;
          const role = point?.role ? `｜本题作用：${point.role}` : '';
          return `- ${name}（${MASTERY_LABEL[r.mastery] || '未选择'}）${role}`;
        })
        .join('\n')
    : points
        .map((p) => `- ${p.name}（待复习）${p.role ? `｜本题作用：${p.role}` : ''}`)
        .join('\n');

  const dateProblem = /日期|闰年|一年中|一年中的第/.test(cleanText(problem));
  const code = dateProblem
    ? [
        '```python',
        'def day_of_year(date_str: str) -> int:',
        '    year, month, day = map(int, date_str.split("-"))',
        '    is_leap = (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)',
        '    days = [31, 29 if is_leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]',
        '    return sum(days[: month - 1]) + day',
        '```',
      ].join('\n')
    : [
        '```text',
        '先按「通法」写出函数骨架，再补核心循环；',
        '这里只保留你最终跑通的实现，不要贴测试代码。',
        '```',
      ].join('\n');

  const tests = dateProblem
    ? [
        '- `2024-03-01` → `61`（闰年 + 二月 29 天）',
        '- `2023-03-01` → `60`（平年）',
        '- `1900-03-01` → `60`（整百年不闰）',
      ].join('\n')
    : [
        '- 正常样例：手算一遍并核对中间变量；',
        '- 边界样例：空输入、单元素或重复元素；',
        '- 极值样例：数据规模取上限时复杂度是否可接受。',
      ].join('\n');

  const mistakes = dateProblem
    ? [
        '- 闰年规则漏掉「整百年」或「四百年」的例外；',
        '- 月份下标和实际月份差一；',
        '- 只测常规日期，不测年初、年末和 2 月 29 日。',
      ].join('\n')
    : [
        '- 只验证正常样例，漏掉空输入、单元素或重复值；',
        '- 修改指针 / 下标时顺序不对，覆盖了还要用的值；',
        '- 没想清楚循环结束后答案停在哪一个状态。',
      ].join('\n');

  return [
    `# ${mockTitle(problem)}`,
    '',
    '## 一、知识点',
    '',
    masteryLine || '- 暂无知识点记录',
    '',
    '## 二、通法',
    '',
    dateProblem
      ? [
          '1. 先判断闰年，确定二月天数。',
          '2. 用一个数组存每月天数。',
          '3. 累加当月之前的整月天数。',
          '4. 再加上当月日号，返回结果。',
        ].join('\n')
      : [
          '1. 先固定循环不变量：每一轮开始前，哪些信息一定成立。',
          '2. 选择能维护这个不变量的数据结构。',
          '3. 每轮只更新必要状态，处理边界后再继续。',
          '4. 用最小样例和边界样例验证。',
        ].join('\n'),
    '',
    '## 三、代码',
    '',
    code,
    '',
    '## 四、测试',
    '',
    tests,
    '',
    '## 五、易错点',
    '',
    mistakes,
    '',
    '## 六、一句话',
    '',
    dateProblem
      ? '> 先把会变的闰年规则固定下来，剩下就只是按月累加。'
      : '> 先让不变量说清楚，再让代码替它跑起来。',
  ].join('\n');
}

/** 生成一段演示回复的完整文本。 */
export function buildMockReply(messages) {
  const all = Array.isArray(messages) ? messages : [];
  const assistantCount = all.filter((m) => m?.role === 'assistant').length;
  const userText = extractLatestUser(all);
  const latestUser = [...all].reverse().find((m) => m?.role === 'user');
  const hasImage = contentHasImage(latestUser?.content);
  const firstProblem = all.find((m) => m?.role === 'user')?.content || '';
  const problem = contentToText(firstProblem);

  if (extractKnowledgeResults(userText)) {
    return buildAfterKnowledge(problem, userText, all);
  }
  if (assistantCount === 0) {
    const opening = buildOpening(problem);
    return hasImage
      ? `${opening}\n\n> 演示模型读不了图片内容。接入支持视觉的模型后可以识别截图；现在也可以把题干文字直接贴进来。`
      : opening;
  }
  if (/(^|[，。\s])(完成|做完了|写完了|搞定)([，。！\s]|$)/.test(userText) || /生成.*笔记/.test(userText)) {
    return buildNote(problem, all);
  }
  if (/```(?:python|js|javascript|java|cpp|c\+\+|ts|typescript)/i.test(userText)) {
    return buildCodeReview(userText, problem);
  }
  if (hasImage) {
    return [
      '图片收到了，但演示模型无法读取图片里的内容。',
      '',
      '你可以：',
      '',
      '1. 把题目/代码用文字贴进来；',
      '2. 或在「模型设置」里切换到支持视觉的模型（如 GPT-4o 系列）。',
      '',
      '如果你愿意，我也可以先根据你文字描述的目标，继续给你递进提示。',
    ].join('\n');
  }
  if (/提示|没有思路|不会做|卡住|help/i.test(userText)) {
    return buildHint(problem);
  }
  if (assistantCount === 1) {
    return [
      '可以先不写完整代码。我们先约定一个小目标：',
      '',
      '**把「输入 → 中间状态 → 输出」用自己的话写出来。**',
      '',
      '例如，用一行文字描述：对每一个 ______，我维护 ______，最后输出 ______。',
      '',
      '完成这个填空后，再考虑用哪种循环。你愿意先试着填一填吗？',
    ].join('\n');
  }
  return [
    '我们继续往前挪一步。',
    '',
    masterySentence([]) +
      ' 先别求一次写对，先写出一个「哪怕低效但正确」的版本，再谈优化。',
    '',
    '你可以告诉我：现在卡在**思路**、**边界**，还是**代码实现**？我按对应的方向给你下一层提示。',
  ].join('\n');
}

/** 以 OpenAI SSE 格式把文本切成小块推送给浏览器。 */
export async function streamMockReply({ messages, res, signal }) {
  const text = buildMockReply(messages);
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    const size = 2 + Math.floor(Math.random() * 6);
    chunks.push(text.slice(cursor, cursor + size));
    cursor += size;
  }

  for (const chunk of chunks) {
    if (signal?.aborted) return;
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  res.write('data: [DONE]\n\n');
}

function contextLine(context, label) {
  const match = String(context || '').match(new RegExp(`${label}[：:]\\s*([^\\n]+)`));
  return match?.[1]?.trim() || '';
}

function firstCodeBlock(context) {
  const match = String(context || '').match(/```([a-zA-Z+#]*)\r?\n([\s\S]*?)```/);
  if (!match) return null;
  const language = (match[1] || 'python').toLowerCase();
  const supported = /^(python|py|javascript|js|typescript|ts|cpp|c\+\+|java|c|go)$/.test(language)
    ? language
    : 'python';
  const normalizedLanguage =
    supported === 'py'
      ? 'python'
      : supported === 'js'
        ? 'javascript'
        : supported === 'ts'
          ? 'typescript'
          : supported === 'c++'
            ? 'cpp'
            : supported;
  return { language: normalizedLanguage, code: match[2].trim().slice(0, 3000) };
}

function reviewTopic(context) {
  const known = contextLine(context, '题目');
  const knowledge = contextLine(context, '知识点');
  const firstPoint = knowledge.split(/[、,，]/)[0]?.replace(/（[^）]*）/g, '').trim();
  if (/两数之和|two.?sum/i.test(known)) return { topic: '两数之和', point: firstPoint || '哈希表查找' };
  if (/日期|闰年/i.test(known)) return { topic: '日期转年内第几天', point: firstPoint || '闰年判断规则' };
  if (/括号|parenthes/i.test(known)) return { topic: '有效括号', point: firstPoint || '栈的先进后出' };
  if (/链表/i.test(known)) return { topic: '链表题', point: firstPoint || '指针修改顺序' };
  return {
    topic: known ? clip(cleanText(known), 18) : '这道题',
    point: firstPoint || '核心思路',
  };
}

/** 演示模式下的复习卡生成：不调用网络，但返回与真实接口完全相同的结构。 */
export function buildMockReviewCards(context) {
  const { topic, point } = reviewTopic(context);
  const codeBlock = firstCodeBlock(context);
  const fallbackCode =
    'def solve(nums, target):\n' +
    '    seen = {}\n' +
    '    for i, value in enumerate(nums):\n' +
    '        need = target - value\n' +
    '        if need in seen:\n' +
    '            return [seen[need], i]\n' +
    '        seen[value] = i\n' +
    '    return []\n';
  const snippet = codeBlock?.code || fallbackCode;
  const language = codeBlock?.language || 'python';

  return [
    {
      mode: 'explain',
      pointName: point,
      title: `${point} · 规则复述`,
      prompt: `不看对话，用自己的话解释「${point}」。请说清：它解决什么问题、依赖的关键条件是什么、在什么情况下会失效。`,
      reference: `参考学习记录中关于「${point}」的讲解，以及「${topic}」的通用解法。检查自己是否说清了定义、条件和边界，并与对话中的解释对照。`,
      hints: ['先用自己的话说出它解决什么问题。', '再补充一个边界条件或反例。'],
      rubric: ['说清定义或作用', '说清关键条件', '能指出边界或反例'],
    },
    {
      mode: 'trace',
      title: `${topic} · 手推变量`,
      prompt: '逐轮推演下面代码的关键变量。请写出每一轮的 i、value、need，以及循环结束或返回时的状态与结果。',
      reference: '按代码逐行执行：记录循环前的初始状态、每一轮变量如何更新、循环退出或返回的条件。以代码实际执行结果为准。',
      snippet,
      language,
      hints: ['先写循环开始前的初始状态。', '每轮结束时更新一次 seen，再进入下一轮。'],
      rubric: ['初始状态正确', '每轮变量更新正确', '能说清退出或返回条件'],
    },
    {
      mode: 'code',
      title: `${topic} · 默写代码`,
      prompt: '不看历史记录，重新写出这道题的核心解法，并说明时间、空间复杂度。AI 只做逻辑审查，不运行代码，也不依赖编译器或测试结果。',
      reference: codeBlock?.code || '参考复习笔记中的最终正确代码；重点对照循环不变量的维护、索引更新顺序和边界处理。',
      language,
      hints: ['先写函数签名和输入输出。', '再写主循环、状态更新和边界返回。'],
      rubric: ['核心思路正确', '边界处理完整', '复杂度说明准确'],
    },
  ];
}

/** 演示模式的 AI 批改占位：只用文本启发式，真实模式会交给模型审查。 */
export function gradeMockReview(card, answer) {
  const text = String(answer || '').trim();
  const mode = card?.mode || 'explain';
  const short = text.length < 12;
  const mentionsReasoning = /因为|所以|复杂度|条件|边界|循环|索引|返回|时间|空间/.test(text);
  const codeLike = /(^|\n)\s*(def |class |function |for |while |if |return |int |void )/m.test(text);

  let verdict = 'partial';
  let score = 62;
  let suggestedRating = 'hard';
  let feedback = '内容基本到位，但还缺少一个关键条件或边界说明。试着把“为什么”讲出来，而不只是描述步骤。';
  const missing = ['关键条件/原因', '一个边界或反例'];

  if (short) {
    verdict = 'incorrect';
    score = 28;
    suggestedRating = 'again';
    feedback = '回答还太短，暂时看不出是否真正掌握。先写下你的核心结论，再补一个原因或例子。';
  } else if (mode === 'code') {
    if (codeLike && text.length > 55) {
      verdict = 'correct';
      score = 84;
      suggestedRating = 'good';
      feedback = '结构上已经包含可执行的解法。请再自查：空输入、重复元素、索引更新顺序，以及复杂度是否说明清楚。';
    } else {
      verdict = 'partial';
      score = 58;
      suggestedRating = 'hard';
      feedback = '文字描述有了，但还不像一份完整代码。补上函数签名、主循环和返回条件，再对照复习笔记检查。';
    }
  } else if (mentionsReasoning && text.length > 35) {
    verdict = 'correct';
    score = 86;
    suggestedRating = 'good';
    feedback = '结论、原因和关键条件基本都覆盖到了。可以再补一个反例，检验自己是否真正理解边界。';
  }

  return {
    verdict,
    score,
    feedback: `${feedback}（演示模式为启发式批改，真实模型会做更细的逻辑审查。）`,
    missing: verdict === 'correct' ? ['边界反例（可选）'] : missing,
    suggestedRating,
  };
}
