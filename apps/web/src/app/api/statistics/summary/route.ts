import { NextRequest, NextResponse } from "next/server";
import { fallbackComplaintSubtypeString } from "@/lib/complaint-label-fallback";
import { normalizeSupabaseOrigin } from "@/lib/supabase-env";

type RecordRow = {
  id: string;
  receipt_date: string;
  complaint_scope: string;
  receipt_channel_name: string;
  complaint_content: string;
  birth_date?: string | null;
  age_group?: string | null;
  ai_category?: string | null;
  ai_subcategory?: string | null;
  complaint_type_minor?: string | null;
  complaint_type_major?: string | null;
  sales_department_name?: string | null;
  bond_department_name?: string | null;
};

type MonthRollupEntry = { total: number; external: number; internal: number };
type ParsedResultRollup = {
  month_rollup?: Record<string, MonthRollupEntry>;
  month_age_rollup?: Record<string, Record<string, number>>;
};

function getSupabaseConfig() {
  const supabaseUrl = normalizeSupabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}

function supabaseHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };
}

function formatYearMonthLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const next = new Date(y, m, 1);
  return { from: start.toISOString().slice(0, 10), toExclusive: next.toISOString().slice(0, 10) };
}

function groupCount(rows: RecordRow[], keySelector: (row: RecordRow) => string) {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const key = keySelector(row) || "기타";
    map.set(key, (map.get(key) ?? 0) + 1);
  });
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseMonthRollup(raw: unknown): ParsedResultRollup {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const month_rollup_raw = o.month_rollup;
  const month_age_rollup_raw = o.month_age_rollup;
  const month_rollup: Record<string, MonthRollupEntry> = {};
  const month_age_rollup: Record<string, Record<string, number>> = {};

  if (month_rollup_raw && typeof month_rollup_raw === "object") {
    for (const [k, v] of Object.entries(month_rollup_raw as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      if (isNum(r.total) && isNum(r.external) && isNum(r.internal)) {
        month_rollup[k] = { total: r.total, external: r.external, internal: r.internal };
      }
    }
  }
  if (month_age_rollup_raw && typeof month_age_rollup_raw === "object") {
    for (const [k, v] of Object.entries(month_age_rollup_raw as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const one: Record<string, number> = {};
      for (const [g, n] of Object.entries(v as Record<string, unknown>)) {
        if (isNum(n)) one[g] = n;
      }
      if (Object.keys(one).length > 0) month_age_rollup[k] = one;
    }
  }
  return { month_rollup, month_age_rollup };
}

export async function GET(request: NextRequest) {
  const month =
    request.nextUrl.searchParams.get("month") ??
    formatYearMonthLocal(new Date());
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ ok: false, message: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 400 });
  }

  const currentRange = monthRange(month);
  const [cy, cm] = month.split("-").map(Number);
  const prevMonth = formatYearMonthLocal(new Date(cy, cm - 2, 1));
  const prevRange = monthRange(prevMonth);

  const selectFields =
    "id,receipt_date,complaint_scope,receipt_channel_name,complaint_content,birth_date,age_group,ai_category,ai_subcategory,complaint_type_minor,complaint_type_major,sales_department_name,bond_department_name";

  const currentParams = new URLSearchParams();
  currentParams.set("select", selectFields);
  currentParams.append("receipt_date", `gte.${currentRange.from}`);
  currentParams.append("receipt_date", `lt.${currentRange.toExclusive}`);
  currentParams.set("limit", "5000");

  const prevParams = new URLSearchParams();
  prevParams.set("select", "id");
  prevParams.append("receipt_date", `gte.${prevRange.from}`);
  prevParams.append("receipt_date", `lt.${prevRange.toExclusive}`);
  prevParams.set("limit", "5000");

  const rollupParams = new URLSearchParams();
  rollupParams.set("select", "parsed_result");
  rollupParams.set("file_type", "eq.excel");
  rollupParams.set("order", "created_at.desc");
  rollupParams.set("limit", "8");

  const [currentRes, prevRes, rollupRes] = await Promise.all([
    fetch(`${config.supabaseUrl}/rest/v1/complaint_records?${currentParams.toString()}`, {
      method: "GET",
      headers: supabaseHeaders(config.serviceRoleKey)
    }),
    fetch(`${config.supabaseUrl}/rest/v1/complaint_records?${prevParams.toString()}`, {
      method: "GET",
      headers: supabaseHeaders(config.serviceRoleKey)
    }),
    fetch(`${config.supabaseUrl}/rest/v1/source_files?${rollupParams.toString()}`, {
      method: "GET",
      headers: supabaseHeaders(config.serviceRoleKey)
    })
  ]);

  const currentRows = (await currentRes.json()) as unknown;
  const prevRows = (await prevRes.json()) as unknown;
  const rollupRows = (await rollupRes.json()) as unknown;
  if (!currentRes.ok || !prevRes.ok) {
    return NextResponse.json({ ok: false, message: "통계 데이터 조회에 실패했습니다." }, { status: 500 });
  }

  const rows = (Array.isArray(currentRows) ? currentRows : []) as RecordRow[];
  const prevTotalFromDb = Array.isArray(prevRows) ? prevRows.length : 0;

  let latestRollup: ParsedResultRollup = {};
  if (rollupRes.ok && Array.isArray(rollupRows)) {
    for (const row of rollupRows as Array<{ parsed_result?: unknown }>) {
      const parsed = parseMonthRollup(row.parsed_result);
      if (Object.keys(parsed.month_rollup ?? {}).length > 0 || Object.keys(parsed.month_age_rollup ?? {}).length > 0) {
        latestRollup = parsed;
        break;
      }
    }
  }

  const normScope = (s: string | undefined) => (s ?? "").trim();
  const totalFromDb = rows.length;
  const externalFromDb = rows.filter((row) => normScope(row.complaint_scope) === "대외").length;
  const internalFromDb = rows.filter((row) => normScope(row.complaint_scope) === "대내").length;
  const currentRoll = latestRollup.month_rollup?.[month];
  const prevRoll = latestRollup.month_rollup?.[prevMonth];
  const total = currentRoll?.total ?? totalFromDb;
  const external = currentRoll?.external ?? externalFromDb;
  const internal = currentRoll?.internal ?? internalFromDb;
  const prevTotal = prevRoll?.total ?? prevTotalFromDb;
  const diffRate = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;

  const ageFromRollup = latestRollup.month_age_rollup?.[month];
  const ageGroups =
    ageFromRollup && Object.keys(ageFromRollup).length > 0
      ? Object.entries(ageFromRollup)
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count)
      : groupCount(rows, (row) => {
          const g = (row.age_group ?? "").trim();
          return g || "미상";
        });

  const externalRows = rows.filter((row) => normScope(row.complaint_scope) === "대외");
  const businessMinor = groupCount(externalRows, (row) => row.complaint_type_minor ?? "미분류");
  const productMajor = groupCount(externalRows, (row) => row.complaint_type_major ?? "미분류");
  const salesDept = groupCount(externalRows, (row) => row.sales_department_name ?? "미지정");
  const bondDept = groupCount(externalRows, (row) => row.bond_department_name ?? "미지정");
  const complaintTypes = groupCount(externalRows, (row) => {
    const sub = (row.ai_subcategory ?? "").trim();
    const cat = (row.ai_category ?? "").trim();
    if (!sub) return "미분류";
    if (sub === "기타") return cat ? `${cat} 기타` : "기타";
    return sub;
  });
  const complaintTypesSafe = groupCount(externalRows, (row) => {
    const sub = (row.ai_subcategory ?? "").trim();
    const cat = (row.ai_category ?? "").trim();
    if (sub) return sub === "기타" ? (cat ? `${cat} 기타` : "기타") : sub;
    return fallbackComplaintSubtypeString(row.complaint_content ?? "", row.complaint_type_minor ?? "");
  });

  return NextResponse.json({
    ok: true,
    month,
    kpi: {
      total,
      external,
      internal,
      prevTotal,
      diffRate: Number(diffRate.toFixed(1))
    },
    charts: {
      ageGroups,
      businessMinor,
      productMajor,
      salesDept,
      bondDept,
      complaintTypes: complaintTypesSafe.length > 0 ? complaintTypesSafe : complaintTypes
    }
  });
}
