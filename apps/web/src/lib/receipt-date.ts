/**
 * Excel/엑셀에서 온 접수일 값을 YYYY-MM-DD로 맞춥니다.
 * 서버 `parse/route`의 toIsoDate와 동일한 규칙(시리얼일·구분자)을 클라이언트에도 둡니다.
 */
export function normalizeReceiptDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const utcDays = Math.floor(value);
    const excelEpoch = Date.UTC(1899, 11, 30);
    const d = new Date(excelEpoch + utcDays * 86400000);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  const normalized = str.replaceAll(".", "-").replaceAll("/", "-");
  const date = new Date(normalized);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return "";
}
