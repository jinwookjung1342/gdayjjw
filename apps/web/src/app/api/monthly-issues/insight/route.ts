import { NextRequest, NextResponse } from "next/server";
import { normalizeSupabaseOrigin } from "@/lib/supabase-env";

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

export async function GET(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ ok: false, message: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 400 });
  }
  const month = (request.nextUrl.searchParams.get("month") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ ok: false, message: "month(YYYY-MM)이 필요합니다." }, { status: 400 });
  }

  const params = new URLSearchParams();
  params.set("select", "edited_report,generated_report,updated_at");
  params.set("month_key", `eq.${month}`);
  params.set("limit", "1");

  const res = await fetch(`${config.supabaseUrl}/rest/v1/monthly_issue_reports?${params.toString()}`, {
    method: "GET",
    headers: headers(config.serviceRoleKey)
  });
  const body = (await res.json().catch(() => [])) as unknown;
  if (!res.ok) {
    return NextResponse.json({ ok: false, message: "인사이트 조회에 실패했습니다.", detail: body }, { status: res.status });
  }
  const row = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : undefined;
  const text =
    typeof row?.edited_report === "string"
      ? row.edited_report
      : typeof row?.generated_report === "string"
        ? row.generated_report
        : "";
  return NextResponse.json({
    ok: true,
    month,
    text,
    updated_at: typeof row?.updated_at === "string" ? row.updated_at : null
  });
}

export async function PATCH(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ ok: false, message: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 400 });
  }
  const body = (await request.json()) as { month?: string; text?: string };
  const month = String(body.month ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ ok: false, message: "month(YYYY-MM)이 필요합니다." }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text : "";

  const payload = [
    {
      month_key: month,
      edited_report: text,
      updated_at: new Date().toISOString()
    }
  ];
  const res = await fetch(`${config.supabaseUrl}/rest/v1/monthly_issue_reports?on_conflict=month_key`, {
    method: "POST",
    headers: { ...headers(config.serviceRoleKey), Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload)
  });
  const json = (await res.json().catch(() => [])) as unknown;
  if (!res.ok) {
    return NextResponse.json({ ok: false, message: "인사이트 저장에 실패했습니다.", detail: json }, { status: res.status });
  }
  return NextResponse.json({ ok: true, month, text });
}
