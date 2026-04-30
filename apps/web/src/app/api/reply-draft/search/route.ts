import { NextRequest, NextResponse } from "next/server";
import { normalizeSupabaseOrigin } from "@/lib/supabase-env";

type ComplaintRow = {
  id: string;
  receipt_number: string;
  receipt_date: string;
  complaint_content: string;
  complaint_type_major?: string | null;
  ai_category?: string | null;
  complainant_summary?: string | null;
  similar_case_content?: string | null;
  company_opinion?: string | null;
  violation_and_action?: string | null;
  future_action_plan?: string | null;
};

function getSupabaseConfig() {
  const supabaseUrl = normalizeSupabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}

function headers(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function textForSimilarity(row: ComplaintRow): string {
  return [
    row.complaint_content ?? "",
    row.complainant_summary ?? "",
    row.similar_case_content ?? "",
    row.company_opinion ?? "",
    row.violation_and_action ?? "",
    row.future_action_plan ?? ""
  ]
    .filter(Boolean)
    .join(" ");
}

function jaccardScore(query: string, doc: string): number {
  const qa = new Set(tokenize(query));
  const da = new Set(tokenize(doc));
  if (qa.size === 0 || da.size === 0) return 0;
  let intersection = 0;
  qa.forEach((t) => {
    if (da.has(t)) intersection += 1;
  });
  const union = qa.size + da.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export async function POST(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ ok: false, message: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 400 });
  }

  const body = (await request.json()) as {
    query?: string;
    productType?: string;
    category?: string;
    limit?: number;
  };
  const query = String(body.query ?? "").trim();
  const productType = String(body.productType ?? "전체").trim();
  const category = String(body.category ?? "전체").trim();
  const limit = Math.min(Math.max(Number(body.limit ?? 8), 1), 20);
  if (query.length < 5) {
    return NextResponse.json({ ok: false, message: "민원 내용을 5자 이상 입력해 주세요." }, { status: 400 });
  }

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,receipt_number,receipt_date,complaint_content,complaint_type_major,ai_category,complainant_summary,similar_case_content,company_opinion,violation_and_action,future_action_plan"
  );
  params.set("complaint_scope", "eq.대외");
  params.set("order", "receipt_date.desc");
  params.set("limit", "2500");

  const res = await fetch(`${config.supabaseUrl}/rest/v1/complaint_records?${params.toString()}`, {
    method: "GET",
    headers: headers(config.serviceRoleKey)
  });
  const rows = (await res.json()) as unknown;
  if (!res.ok || !Array.isArray(rows)) {
    return NextResponse.json({ ok: false, message: "유사사례 조회에 실패했습니다." }, { status: 500 });
  }

  const filtered = (rows as ComplaintRow[]).filter((row) => {
    if (productType !== "전체" && String(row.complaint_type_major ?? "").trim() !== productType) return false;
    if (category !== "전체" && String(row.ai_category ?? "").trim() !== category) return false;
    return true;
  });

  const scored = filtered
    .map((row) => {
      const score = jaccardScore(query, textForSimilarity(row));
      return {
        ...row,
        score
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || (a.receipt_date < b.receipt_date ? 1 : -1))
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      receipt_number: row.receipt_number,
      receipt_date: row.receipt_date,
      complaint_type_major: row.complaint_type_major ?? "",
      ai_category: row.ai_category ?? "",
      similarity: Math.max(1, Math.round(row.score * 100)),
      summary: (row.complainant_summary ?? row.complaint_content ?? "").slice(0, 180),
      sections: {
        complainant_summary: row.complainant_summary ?? "",
        similar_case_content: row.similar_case_content ?? "",
        company_opinion: row.company_opinion ?? "",
        violation_and_action: row.violation_and_action ?? "",
        future_action_plan: row.future_action_plan ?? ""
      }
    }));

  return NextResponse.json({
    ok: true,
    rows: scored
  });
}
