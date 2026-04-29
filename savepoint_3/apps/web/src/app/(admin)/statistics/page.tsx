"use client";

import { useEffect, useMemo, useState } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { normalizeReceiptDate } from "@/lib/receipt-date";
import { readMonthAgeRollover, readMonthRollover } from "@/lib/month-rollup";

type ChartItem = { label: string; count: number };
type Summary = {
  ok: boolean;
  month: string;
  kpi: { total: number; external: number; internal: number; prevTotal: number; diffRate: number };
  charts: {
    ageGroups: ChartItem[];
    businessMinor: ChartItem[];
    productMajor: ChartItem[];
    salesDept: ChartItem[];
    bondDept: ChartItem[];
    complaintTypes: ChartItem[];
  };
};

type LocalRow = {
  receipt_date: string;
  complaint_scope: string;
  receipt_channel_name: string;
  complaint_content: string;
  birth_date?: string | null;
  /** 엑셀 「연령대」 열 — 연령별 차트 집계에 사용 */
  age_group?: string | null;
  ai_category?: string | null;
  ai_subcategory?: string | null;
  complaint_type_minor?: string | null;
  complaint_type_major?: string | null;
  sales_department_name?: string | null;
  bond_department_name?: string | null;
  /** 월별 집계 시 접수일이 비어 있으면 업로드 시각 기준으로 포함 */
  created_at?: string;
};

const LOCAL_RECORDS_KEY = "jb_monthly_data_records";

const CHART_COLORS = ["#2554d7", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899"];

/** 로컬 달력 기준 YYYY-MM (UTC toISOString 금지 — 전월 키가 한 달 밀림) */
function formatYearMonthLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 콤보박스 기본값: 현재 달의 전달 (4월이면 3월, 1월이면 전년 12월) */
function defaultStatisticsMonth(): string {
  const d = new Date();
  return formatYearMonthLocal(new Date(d.getFullYear(), d.getMonth() - 1, 1));
}

/** 서버·클라 첫 렌더 동일하게 유지 (new Date() 금지). 비어 있으면 고정 플레이스홀더만 사용 */
function monthParts(ym: string): { year: string; mm: string } {
  if (ym.length >= 7) {
    return { year: ym.slice(0, 4), mm: ym.slice(5, 7) };
  }
  return { year: "2000", mm: "01" };
}

/** 연도 목록 — 렌더 중 current year 사용 시 SSR/CSR 불일치 유발하므로 고정 구간 */
function buildYearOptions(): number[] {
  return Array.from({ length: 21 }, (_, i) => 2015 + i);
}

export default function StatisticsPage() {
  const [month, setMonth] = useState("");
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isLocalMode, setIsLocalMode] = useState(false);

  useEffect(() => {
    setMonth(defaultStatisticsMonth());
  }, []);

  useEffect(() => {
    if (month.length < 7) return;
    void loadSummary();
  }, [month]);

  async function loadSummary() {
    setLoading(true);
    setError("");
    try {
      const fromExcel = readMonthRollover()[month];
      if (fromExcel && fromExcel.total > 0) {
        const prevKey = previousMonthKey(month);
        const prevRoll = readMonthRollover()[prevKey];
        const prevTotal = prevRoll?.total ?? 0;
        const diffRate = prevTotal > 0 ? ((fromExcel.total - prevTotal) / prevTotal) * 100 : 0;
        const charts = buildLocalSummary(month).charts;
        setData({
          ok: true,
          month,
          kpi: {
            total: fromExcel.total,
            external: fromExcel.external,
            internal: fromExcel.internal,
            prevTotal,
            diffRate: Number(diffRate.toFixed(1))
          },
          charts
        });
        setIsLocalMode(true);
        setError("");
        setLoading(false);
        return;
      }

      const local = buildLocalSummary(month);
      const response = await fetch(`/api/statistics/summary?month=${month}`);
      const body = (await response.json()) as Summary & { message?: string };
      if (!response.ok || !body.ok) {
        setData(local);
        setIsLocalMode(true);
        setError(body.message ?? "DB 통계 조회에 실패하여 로컬 데이터 기준으로 표시합니다.");
        setLoading(false);
        return;
      }
      if (local.kpi.total > 0) {
        setData(local);
        setIsLocalMode(true);
        setError("");
      } else {
        setData(body);
        setIsLocalMode(false);
        setError("");
      }
      setLoading(false);
    } catch {
      setData(buildLocalSummary(month));
      setIsLocalMode(true);
      setError("DB 연결이 없어 로컬 데이터 기준으로 표시합니다.");
      setLoading(false);
    }
  }

  const diffColor = useMemo(() => {
    if (!data) return "text-slate-600";
    if (data.kpi.diffRate > 0) return "text-red-600";
    if (data.kpi.diffRate < 0) return "text-blue-600";
    return "text-slate-600";
  }, [data]);

  const { year: selYear, mm: selMm } = monthParts(month);

  function setYearPart(nextYear: string) {
    setMonth(`${nextYear}-${selMm}`);
  }

  function setMonthPart(nextMm: string) {
    setMonth(`${selYear}-${nextMm}`);
  }

  const ready = month.length >= 7;

  if (!ready) {
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold text-slate-900">민원통계</h3>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">불러오는 중...</div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-slate-900">민원통계</h3>
        <div className="flex items-center gap-2">
          {isLocalMode ? (
            <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">로컬 모드</span>
          ) : (
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">DB 모드</span>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-sm text-slate-600">
              <span className="sr-only md:not-sr-only md:inline">연도</span>
              <select
                value={selYear}
                onChange={(e) => setYearPart(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
              >
                {buildYearOptions().map((y) => (
                  <option key={y} value={String(y)}>
                    {y}년
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-sm text-slate-600">
              <span className="sr-only md:not-sr-only md:inline">월</span>
              <select
                value={selMm}
                onChange={(e) => setMonthPart(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
              >
                {Array.from({ length: 12 }, (_, i) => {
                  const mm = String(i + 1).padStart(2, "0");
                  return (
                    <option key={mm} value={mm}>
                      {mm}월
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-amber-700">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard title="전체민원" value={data?.kpi.total ?? 0} />
        <KpiCard title="대외민원" value={data?.kpi.external ?? 0} />
        <KpiCard title="대내민원" value={data?.kpi.internal ?? 0} />
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">전월 대비 증감률</p>
          <p className={`mt-1 text-2xl font-semibold ${diffColor}`}>
            {data ? formatMoMPercent(data.kpi.diffRate) : "0%"}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">통계 계산 중...</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <AgeBracketChartCard items={data?.charts.ageGroups ?? []} />
          <ExternalDonutCard
            title="업무별 분석 (대외민원 한정)"
            items={data?.charts.businessMinor ?? []}
            emptyDetail="해당 월에 접수된 대외민원이 없거나, 민원유형(소) 정보가 없습니다."
            cellKeyPrefix="biz"
          />
          <ExternalDonutCard
            title="상품별 분석 (대외민원 한정)"
            items={data?.charts.productMajor ?? []}
            emptyDetail="해당 월에 접수된 대외민원이 없거나, 민원유형(대) 정보가 없습니다."
            cellKeyPrefix="prd"
          />
          <ExternalDonutCard
            title="영업부서별 분석 (대외민원 한정)"
            items={data?.charts.salesDept ?? []}
            emptyDetail="해당 월에 접수된 대외민원이 없거나, 영업부서명이 없습니다."
            cellKeyPrefix="sales"
          />
          <ExternalDonutCard
            title="채권부서별 분석 (대외민원 한정)"
            items={data?.charts.bondDept ?? []}
            emptyDetail="해당 월에 접수된 대외민원이 없거나, 채권부서명이 없습니다."
            cellKeyPrefix="bond"
            className="lg:col-span-2"
          />
          <ComplaintTypeSection
            items={data?.charts.complaintTypes ?? []}
            className="lg:col-span-2"
          />
        </div>
      )}
    </section>
  );
}

function KpiCard({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

/** 범례·도넛 세그먼트 순서: 20대 → … → 미상 */
function ageLabelSortKey(label: string): number {
  const t = label.trim();
  if (t === "미상") return 9999;
  if (/^\d+대\s*이상/.test(t)) {
    const n = /^(\d+)대/.exec(t);
    return n ? Number(n[1]) + 0.5 : 6000;
  }
  const decade = /^(\d+)대$/.exec(t);
  if (decade) return Number(decade[1]);
  const loose = /^(\d+)대/.exec(t);
  if (loose) return Number(loose[1]) + 0.25;
  return 6500;
}

function sortChartItemsByAgeOrder(items: ChartItem[]): ChartItem[] {
  return [...items].sort((a, b) => {
    const d = ageLabelSortKey(a.label) - ageLabelSortKey(b.label);
    if (d !== 0) return d;
    return a.label.localeCompare(b.label);
  });
}

function AgeBracketChartCard({ items }: { items: ChartItem[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const total = items.reduce((s, i) => s + i.count, 0);
  const sortedByCount = [...items].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const top = sortedByCount[0];
  const topPct = total > 0 && top ? Number(((top.count / total) * 100).toFixed(1)) : 0;
  const pieData = sortChartItemsByAgeOrder(items).map((item) => ({ name: item.label, value: item.count }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-slate-900">연령별 분석</h4>
      {!mounted ? (
        <div className="mt-4 h-[260px] animate-pulse rounded-lg bg-slate-100" />
      ) : items.length === 0 || total === 0 ? (
        <p className="mt-6 py-8 text-center text-sm text-slate-500">
          데이터 없음
          <span className="mt-1 block text-xs text-slate-400">
            해당 월에 접수일자가 맞는 민원이 없거나, 연령대가 비어 있습니다. (비어 있으면 「미상」으로 집계)
          </span>
        </p>
      ) : (
        <>
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-center">
            <p className="text-xl font-semibold tracking-tight text-slate-900">
              {top.label}{" "}
              <span className="text-indigo-600">{topPct}%</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-500">해당 월 전체 민원 중 건수 최다 연령대 비율</p>
          </div>
          <div className="mt-4 h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  isAnimationActive={false}
                  cx="50%"
                  cy="46%"
                  innerRadius={62}
                  outerRadius={94}
                  paddingAngle={2}
                  stroke="#fff"
                  strokeWidth={1}
                >
                  {pieData.map((_, index) => (
                    <Cell key={`age-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }} />
                <Legend
                  layout="horizontal"
                  verticalAlign="bottom"
                  align="center"
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

/** 대외민원 한정 · 민원유형(소)/(대) 등 건수 기준 도넛 + 최다 유형 비율 */
function ExternalDonutCard({
  title,
  items,
  emptyDetail,
  cellKeyPrefix,
  className
}: {
  title: string;
  items: ChartItem[];
  emptyDetail: string;
  cellKeyPrefix: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const total = items.reduce((s, i) => s + i.count, 0);
  const sortedByCount = [...items].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const top = sortedByCount[0];
  const topPct = total > 0 && top ? Number(((top.count / total) * 100).toFixed(1)) : 0;
  const pieData = sortedByCount.map((item) => ({ name: item.label, value: item.count }));

  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 ${className ?? ""}`}>
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      {!mounted ? (
        <div className="mt-4 h-[260px] animate-pulse rounded-lg bg-slate-100" />
      ) : items.length === 0 || total === 0 ? (
        <p className="mt-6 py-8 text-center text-sm text-slate-500">
          데이터 없음
          <span className="mt-1 block text-xs text-slate-400">{emptyDetail}</span>
        </p>
      ) : (
        <>
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-center">
            <p className="text-xl font-semibold tracking-tight text-slate-900">
              {top.label}{" "}
              <span className="text-indigo-600">{topPct}%</span>
            </p>
          </div>
          <div className="mt-4 h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  isAnimationActive={false}
                  cx="50%"
                  cy="46%"
                  innerRadius={62}
                  outerRadius={94}
                  paddingAngle={2}
                  stroke="#fff"
                  strokeWidth={1}
                >
                  {pieData.map((_, index) => (
                    <Cell key={`${cellKeyPrefix}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }} />
                <Legend
                  layout="horizontal"
                  verticalAlign="bottom"
                  align="center"
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function complaintTypeMajor(sub: string): "영업" | "채권" | "제도정책" | "기타" {
  const s = (sub ?? "").trim();
  if (!s) return "기타";
  const sales = new Set([
    "계약사실상이(부인)",
    "담보차량인수부인",
    "담보차량 결함",
    "설명의무 위반",
    "불법영업",
    "기타 판매과정 불만"
  ]);
  const debt = new Set(["과다/고압 독촉", "가압류 취하 미흡", "근저당 해지 절차", "채권 매각 관련", "채권추심관련 금지행위"]);
  const policy = new Set(["결제(수납)관련", "개인정보유출의심", "중도상환(해지)수수료 관련", "차량 손해액관련(반납평가, 감가 관련)"]);
  if (sales.has(s)) return "영업";
  if (debt.has(s)) return "채권";
  if (policy.has(s)) return "제도정책";
  return "기타";
}

function groupComplaintTypeByMajor(items: ChartItem[]): Record<"영업" | "채권" | "제도정책" | "기타", ChartItem[]> {
  const map: Record<"영업" | "채권" | "제도정책" | "기타", Map<string, number>> = {
    영업: new Map<string, number>(),
    채권: new Map<string, number>(),
    제도정책: new Map<string, number>(),
    기타: new Map<string, number>()
  };
  for (const it of items) {
    const major = complaintTypeMajor(it.label);
    map[major].set(it.label, (map[major].get(it.label) ?? 0) + it.count);
  }
  return {
    영업: Array.from(map.영업.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    채권: Array.from(map.채권.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    제도정책: Array.from(map.제도정책.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    기타: Array.from(map.기타.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  };
}

function ComplaintTypeSection({ items, className }: { items: ChartItem[]; className?: string }) {
  const grouped = groupComplaintTypeByMajor(items);
  return (
    <section className={`space-y-3 rounded-xl border border-slate-200 bg-white p-4 ${className ?? ""}`}>
      <h4 className="text-sm font-semibold text-slate-900">민원유형별 분류 (대외민원 한정)</h4>
      <div className="grid gap-3 md:grid-cols-2">
        <ExternalDonutCard title="영업" items={grouped.영업} emptyDetail="해당 대분류 데이터 없음" cellKeyPrefix="ct-sales" />
        <ExternalDonutCard title="채권" items={grouped.채권} emptyDetail="해당 대분류 데이터 없음" cellKeyPrefix="ct-debt" />
        <ExternalDonutCard title="제도정책" items={grouped.제도정책} emptyDetail="해당 대분류 데이터 없음" cellKeyPrefix="ct-policy" />
        <ExternalDonutCard title="기타" items={grouped.기타} emptyDetail="해당 대분류 데이터 없음" cellKeyPrefix="ct-etc" />
      </div>
    </section>
  );
}

function normScope(s: string | undefined): string {
  return (s ?? "").trim();
}

function rowInMonth(row: LocalRow, month: string): boolean {
  const fixed = normalizeReceiptDate(row.receipt_date);
  if (fixed.length >= 7 && fixed.slice(0, 7) === month) return true;
  const raw = row.receipt_date ?? "";
  if (raw.length >= 7 && raw.slice(0, 7) === month) return true;
  if (!fixed && row.created_at && row.created_at.length >= 7 && row.created_at.slice(0, 7) === month) {
    return true;
  }
  return false;
}

function buildLocalSummary(month: string): Summary {
  const all = readLocalRows();
  const rows = all.filter((row) => rowInMonth(row, month));
  const prevKey = previousMonthKey(month);
  const prevRows = all.filter((row) => rowInMonth(row, prevKey));

  const total = rows.length;
  const external = rows.filter((row) => normScope(row.complaint_scope) === "대외").length;
  const internal = rows.filter((row) => normScope(row.complaint_scope) === "대내").length;
  const prevTotal = prevRows.length;
  const diffRate = prevTotal > 0 ? Number((((total - prevTotal) / prevTotal) * 100).toFixed(1)) : 0;

  const externalRows = rows.filter((row) => normScope(row.complaint_scope) === "대외");

  return {
    ok: true,
    month,
    kpi: { total, external, internal, prevTotal, diffRate },
    charts: {
      ageGroups: ageChartItemsForMonth(month),
      businessMinor: groupSimple(externalRows, (row) => (row.complaint_type_minor ?? "").trim() || "미분류"),
      productMajor: groupSimple(externalRows, (row) => (row.complaint_type_major ?? "").trim() || "미분류"),
      salesDept: groupSimple(externalRows, (row) => (row.sales_department_name ?? "").trim() || "미지정"),
      bondDept: groupSimple(externalRows, (row) => (row.bond_department_name ?? "").trim() || "미지정"),
      complaintTypes: groupSimple(externalRows, (row) => {
        const sub = (row.ai_subcategory ?? "").trim();
        const cat = (row.ai_category ?? "").trim();
        if (!sub) return classifyComplaintTypeFromText(row.complaint_content ?? "");
        if (sub === "기타") return cat ? `${cat} 기타` : "기타";
        return sub;
      })
    }
  };
}

/** 전월 YYYY-MM — 증감률 (현월 전체민원 − 전월 전체민원) / 전월 전체민원 */
function previousMonthKey(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  return formatYearMonthLocal(new Date(year, monthNum - 2, 1));
}

function formatMoMPercent(rate: number): string {
  const r = Number(rate.toFixed(1));
  if (Object.is(r, -0) || r === 0) return "0%";
  const sign = r > 0 ? "+" : "";
  return `${sign}${r}%`;
}

function readLocalRows(): LocalRow[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(LOCAL_RECORDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function groupSimple(rows: LocalRow[], selector: (row: LocalRow) => string): ChartItem[] {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const key = selector(row) || "기타";
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

/** doc-ai `month_age_rollup` 우선: KPI·월 집계와 같은 엑셀 행·접수일 기준 전체 건수 */
function ageChartItemsForMonth(month: string): ChartItem[] {
  const roll = readMonthAgeRollover()[month];
  if (roll && typeof roll === "object") {
    const entries = Object.entries(roll).filter(([, n]) => Number(n) > 0);
    const sum = entries.reduce((s, [, n]) => s + Number(n), 0);
    if (sum > 0) {
      return entries
        .map(([label, count]) => ({ label, count: Number(count) }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    }
  }
  const rows = readLocalRows().filter((row) => rowInMonth(row, month));
  return groupAgeBracket(rows);
}

/** 엑셀 「연령대」열 (빈 값은 미상) — 로컬 행만 있을 때 (rollup 없음) */
function groupAgeBracket(rows: LocalRow[]): ChartItem[] {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const bucket = (row.age_group ?? "").trim() || "미상";
    map.set(bucket, (map.get(bucket) ?? 0) + 1);
  });
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
