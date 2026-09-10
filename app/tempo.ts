export const MIN_TEMPO = 10;
export const MAX_TEMPO = 250;

export function normalizeTempo(value: number) {
  return Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, Math.round(value)));
}
