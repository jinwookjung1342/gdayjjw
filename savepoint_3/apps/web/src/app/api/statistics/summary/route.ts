import { NextRequest, NextResponse } from "next/server";

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

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

function classifyComplaintTypeFromText(raw: string): string {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  const has = (k: string) => t.includes(k);
  if (!t) return "미분류";
  if (has("계약") || has("부인")) return "계약사실상이(부인)";
  if (has("차량인수") || (has("담보차량") && has("인수"))) return "담보차량인수부인";
  if (has("결함") || has("하자")) return "담보차량 결함";
  if (has("설명") || has("고지")) return "설명의무 위반";
  if (has("불법영업")) return "불법영업";
  if (has("독촉") || has("고압")) return "과다/고압 독촉";
  if (has("가압류") && has("취하")) return "가압류 취하 미흡";
  if (has("근저당") && (has("해지") || has("말소"))) return "근저당 해지 절차";
  if (has("채권") && has("매각")) return "채권 매각 관련";
  if (has("추심")) return "채권추심관련 금지행위";
  if ((has("담당자") || has("상담")) && (has("고압") || has("불친절"))) return "담당자의 고압적 응대";
  if (has("연락") && (has("안됨") || has("불가") || has("두절"))) return "연락불가";
  if (has("결제") || has("수납")) return "결제(수납)관련";
  if (has("개인정보") || has("유출")) return "개인정보유출의심";
  if (has("중도상환") || has("해지수수료")) return "중도상환(해지)수수료 관련";
  if (has("감가") || has("반납평가") || has("손해액")) return "차량 손해액관련(반납평가, 감가 관련)";
  return `기타-${t.slice(0, 20)}`;
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

  const [currentRes, prevRes] = await Promise.all([
    fetch(`${config.supabaseUrl}/rest/v1/complaint_records?${currentParams.toString()}`, {
      method: "GET",
      headers: supabaseHeaders(config.serviceRoleKey)
    }),
    fetch(`${config.supabaseUrl}/rest/v1/complaint_records?${prevParams.toString()}`, {
      method: "GET",
      headers: supabaseHeaders(config.serviceRoleKey)
    })
  ]);

  const currentRows = (await currentRes.json()) as unknown;
  const prevRows = (await prevRes.json()) as unknown;
  if (!currentRes.ok || !prevRes.ok) {
    return NextResponse.json({ ok: false, message: "통계 데이터 조회에 실패했습니다." }, { status: 500 });
  }

  const rows = (Array.isArray(currentRows) ? currentRows : []) as RecordRow[];
  const prevTotal = Array.isArray(prevRows) ? prevRows.length : 0;

  const normScope = (s: string | undefined) => (s ?? "").trim();
  const total = rows.length;
  const external = rows.filter((row) => normScope(row.complaint_scope) === "대외").length;
  const internal = rows.filter((row) => normScope(row.complaint_scope) === "대내").length;
  const diffRate = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;

  const ageGroups = groupCount(rows, (row) => {
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
    return classifyComplaintTypeFromText(row.complaint_content ?? "");
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
