import { NextRequest, NextResponse } from "next/server";
import { normalizeSupabaseOrigin } from "@/lib/supabase-env";

const DEFAULT_LIMIT = 5000;

function getSupabaseConfig() {
  const supabaseUrl = normalizeSupabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}

function summarizeSupabaseError(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const o = data as Record<string, unknown>;
  const parts = [
    typeof o.code === "string" ? o.code : "",
    typeof o.message === "string" ? o.message : "",
    typeof o.hint === "string" ? o.hint : ""
  ].filter(Boolean);
  return parts.join(" — ").slice(0, 220);
}

function supabaseHeaders(serviceRoleKey: string) {
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

  const searchParams = request.nextUrl.searchParams;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const keyword = (searchParams.get("keyword") ?? "").trim();

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,receipt_number,receipt_date,complaint_scope,receipt_channel_name,business_unit_name,sales_department_name,bond_department_name,complaint_content,birth_date,age_group,ai_category,ai_subcategory,complaint_type_minor,complaint_type_major,created_at"
  );
  params.set("order", "receipt_date.desc");
  params.set("limit", String(DEFAULT_LIMIT));

  if (from && to) {
    params.set("and", `(receipt_date.gte.${from},receipt_date.lte.${to})`);
  } else if (from) {
    params.set("receipt_date", `gte.${from}`);
  } else if (to) {
    params.set("receipt_date", `lte.${to}`);
  }
  if (keyword) {
    const escaped = keyword.replaceAll(",", "\\,").replaceAll("%", "\\%");
    params.set("or", `(receipt_number.ilike.*${escaped}*,complaint_content.ilike.*${escaped}*)`);
  }

  const res = await fetch(`${config.supabaseUrl}/rest/v1/complaint_records?${params.toString()}`, {
    method: "GET",
    headers: supabaseHeaders(config.serviceRoleKey)
  });
  const data = (await res.json()) as unknown;

  if (!res.ok) {
    const hint = summarizeSupabaseError(data);
    const message = hint ? `데이터 조회에 실패했습니다. (${hint})` : "데이터 조회에 실패했습니다.";
    return NextResponse.json({ ok: false, message, detail: data }, { status: res.status });
  }

  return NextResponse.json({
    ok: true,
    rows: Array.isArray(data) ? data : []
  });
}

export async function DELETE(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ ok: false, message: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 400 });
  }

  const body = (await request.json()) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ ok: false, message: "삭제할 id가 필요합니다." }, { status: 400 });
  }

  const res = await fetch(`${config.supabaseUrl}/rest/v1/complaint_records?id=eq.${encodeURIComponent(body.id)}`, {
    method: "DELETE",
    headers: {
      ...supabaseHeaders(config.serviceRoleKey),
      Prefer: "return=representation"
    }
  });

  const data = (await res.json().catch(() => [])) as unknown;
  if (!res.ok) {
    return NextResponse.json({ ok: false, message: "삭제에 실패했습니다.", detail: data }, { status: res.status });
  }

  return NextResponse.json({ ok: true, deleted: Array.isArray(data) ? data.length : 0 });
}

export async function PATCH(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ ok: false, message: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 400 });
  }

  const body = (await request.json()) as {
    id?: string;
    receipt_date?: string;
    complaint_scope?: string;
    receipt_channel_name?: string;
    complaint_content?: string;
  };

  if (!body.id) {
    return NextResponse.json({ ok: false, message: "수정할 id가 필요합니다." }, { status: 400 });
  }

  const payload = {
    receipt_date: body.receipt_date,
    complaint_scope: body.complaint_scope,
    receipt_channel_name: body.receipt_channel_name,
    complaint_content: body.complaint_content,
    updated_at: new Date().toISOString()
  };

  const res = await fetch(`${config.supabaseUrl}/rest/v1/complaint_records?id=eq.${encodeURIComponent(body.id)}`, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(config.serviceRoleKey),
      Prefer: "return=representation"
    },
    body: JSON.stringify(payload)
  });
  const data = (await res.json().catch(() => [])) as unknown;
  if (!res.ok) {
    return NextResponse.json({ ok: false, message: "수정 저장에 실패했습니다.", detail: data }, { status: res.status });
  }

  return NextResponse.json({ ok: true, updated: Array.isArray(data) ? data.length : 0 });
}
