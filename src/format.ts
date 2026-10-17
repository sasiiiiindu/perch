/** "+4.2", "−4.2" (true minus sign), "0.0". */
export function signed(value: number, digits: number): string {
  const abs = Math.abs(value).toFixed(digits);
  if (Number(abs) === 0) return abs;
  return (value > 0 ? '+' : '−') + abs;
}
