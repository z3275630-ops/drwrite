/** 阿拉伯数字 → 中文数字（章节默认名用） */
const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function cnNum(n: number): string {
  if (n <= 0 || n >= 10000) return String(n);
  if (n < 10) return DIGITS[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + DIGITS[n % 10];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return DIGITS[t] + '十' + (o ? DIGITS[o] : '');
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    if (r === 0) return DIGITS[h] + '百';
    if (r < 10) return DIGITS[h] + '百零' + DIGITS[r];
    return DIGITS[h] + '百' + cnNum(r);
  }
  const q = Math.floor(n / 1000);
  const r = n % 1000;
  if (r === 0) return DIGITS[q] + '千';
  if (r < 100) return DIGITS[q] + '千零' + cnNum(r);
  return DIGITS[q] + '千' + cnNum(r);
}
