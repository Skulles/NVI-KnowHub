/** Сумма всех цифр в дате ГГГГ-ММ-ДД (например 2026-04-10 → 2+0+2+6+0+4+1+0 = 15). */
function sumDateDigits(date: Date): number {
  const pad = (n: number) => String(n).padStart(2, '0')
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  let sum = 0
  for (const ch of ymd) {
    sum += Number(ch)
  }
  return sum
}

/** Версия релиза: «сумма цифр даты»-«время HHmmss» (например 15-001030). */
export function formatPublishVersionFromDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${sumDateDigits(date)}-${timePart}`
}
