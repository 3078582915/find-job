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

