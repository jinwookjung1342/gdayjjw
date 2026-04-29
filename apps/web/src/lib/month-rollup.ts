/** doc-ai가 엑셀 전체 행·접수일자 열 기준으로 만든 월별 건수 (민원통계 KPI와 동일 정의) */

export const MONTH_ROLLUP_KEY = "jb_month_rollup";

export type MonthRollupEntry = { total: number; external: number; internal: number };

export function readMonthRollover(): Record<string, MonthRollupEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MONTH_ROLLUP_KEY);
    if (!raw?.trim()) return {};
    const parsed = JSON.parse(raw) as Record<string, MonthRollupEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeMonthRollover(rollup: Record<string, MonthRollupEntry>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MONTH_ROLLUP_KEY, JSON.stringify(rollup));
}

/** doc-ai가 엑셀 전 행·접수일과 동일 규칙으로 월별 「연령대」 건수 (대내·대외 전체) */
export const MONTH_AGE_ROLLUP_KEY = "jb_month_age_rollup";

export type MonthAgeRollup = Record<string, Record<string, number>>;

export function readMonthAgeRollover(): MonthAgeRollup {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MONTH_AGE_ROLLUP_KEY);
    if (!raw?.trim()) return {};
    const parsed = JSON.parse(raw) as MonthAgeRollup;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeMonthAgeRollover(rollup: MonthAgeRollup) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MONTH_AGE_ROLLUP_KEY, JSON.stringify(rollup));
}
