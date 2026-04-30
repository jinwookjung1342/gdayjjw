/** PostgREST 호출 시 베이스 URL만 사용 (잘못 붙은 /rest/v1/ 제거) */
export function normalizeSupabaseOrigin(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1\/?$/i, "");
}
