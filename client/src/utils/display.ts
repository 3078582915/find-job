const UNREADABLE_CHAR_PATTERN = /[\uE000-\uF8FF\uFFFD□�]/;
const UNREADABLE_SALARY_PATTERN = /[\uE000-\uF8FF\uFFFD□�]+(?:\s*[-~－]\s*[\uE000-\uF8FF\uFFFD□�]+)?\s*(?:K|元\/天|元\/月|薪)?/g;
const BOSS_PRIVATE_DIGITS: Record<string, string> = {
  '\uE031': '0',
  '\uE032': '1',
  '\uE033': '2',
  '\uE034': '3',
  '\uE035': '4',
  '\uE036': '5',
  '\uE037': '6',
  '\uE038': '7',
  '\uE039': '8',
  '\uE030': '9',
};

export function decodeBossPrivateText(value?: string | null): string {
  if (!value) return '';
  return value.replace(/[\uE030-\uE039]/g, (char) => BOSS_PRIVATE_DIGITS[char] || char);
}

export function hasUnreadableChars(value?: string | null): boolean {
  const decoded = decodeBossPrivateText(value);
  return Boolean(decoded && UNREADABLE_CHAR_PATTERN.test(decoded));
}

export function cleanJobText(value?: string | null): string {
  const decoded = decodeBossPrivateText(value);
  if (!decoded) return '';
  return decoded
    .replace(UNREADABLE_SALARY_PATTERN, '')
    .replace(UNREADABLE_CHAR_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,，。；;])/g, '$1')
    .trim();
}

export function formatSalary(value?: string | null): string {
  if (!value) return '';
  if (value.trim() === '·') return '';
  if (value === '薪资见详情') return '待重新抓取';
  const decoded = decodeBossPrivateText(value);
  const text = cleanJobText(decoded);
  return text || decoded.trim();
}
