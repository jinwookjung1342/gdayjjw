"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
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

function monthParts(ym: string): { year: string; mm: string } {
  const safe = ym.length >= 7 ? ym : formatYearMonthLocal(new Date());
  return { year: safe.slice(0, 4), mm: safe.slice(5, 7) };
}

function buildYearOptions(): number[] {
  const y = new Date().getFullYear();
  return Array.from({ length: 21 }, (_, i) => y - 10 + i);
}

export default function StatisticsPage() {
  const [month, setMonth] = useState(() => formatYearMonthLocal(new Date()));
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isLocalMode, setIsLocalMode] = useState(false);

  useEffect(() => {
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

      <p className="text-xs leading-relaxed text-slate-500">
        <strong>엑셀을 업로드한 뒤</strong> 저장되는 집계에 따르면, 전체민원/대외/대내민원은{" "}
        <strong>엑셀 &apos;접수일자&apos; 열</strong>이 선택한 연·월에 들어가는 <strong>모든 행</strong>을 기준으로 합니다. 대내민원은
        전체민원−대외민원입니다. 연령별 분석은 <strong>엑셀 &apos;연령대&apos; 열</strong> 기준이며, 접수일이 해당 월인 <strong>전체 행</strong>(대내·대외·접수경로 무관)과 동일합니다.
        (doc-ai가 시트 전체를 읽어 월별로 집계합니다. 업로드 전에는 아래 그래프만 로컬/DB 기준일 수 있습니다.)
      </p>

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
          <ChartCard title="채권부서별 분석 (대외)" items={data?.charts.bondDept ?? []} className="lg:col-span-2" />
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
  const total = items.reduce((s, i) => s + i.count, 0);
  const sortedByCount = [...items].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const top = sortedByCount[0];
  const topPct = total > 0 && top ? Number(((top.count / total) * 100).toFixed(1)) : 0;
  const pieData = sortChartItemsByAgeOrder(items).map((item) => ({ name: item.label, value: item.count }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-slate-900">연령별 분석</h4>
      {items.length === 0 || total === 0 ? (
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
  cellKeyPrefix
}: {
  title: string;
  items: ChartItem[];
  emptyDetail: string;
  cellKeyPrefix: string;
}) {
  const total = items.reduce((s, i) => s + i.count, 0);
  const sortedByCount = [...items].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const top = sortedByCount[0];
  const topPct = total > 0 && top ? Number(((top.count / total) * 100).toFixed(1)) : 0;
  const pieData = sortedByCount.map((item) => ({ name: item.label, value: item.count }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      {items.length === 0 || total === 0 ? (
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

function ChartCard({
  title,
  items,
  emptyHint,
  className
}: {
  title: string;
  items: ChartItem[];
  emptyHint?: string;
  className?: string;
}) {
  const chartData = items.map((item) => ({ name: item.label, 건수: item.count }));

  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 ${className ?? ""}`}>
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-6 py-8 text-center text-sm text-slate-500">
          데이터 없음
          {emptyHint ? <span className="mt-1 block text-xs text-slate-400">{emptyHint}</span> : null}
        </p>
      ) : (
        <div className="mt-3 h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={70} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                formatter={(value: number) => [`${value}건`, ""]}
              />
              <Legend />
              <Bar dataKey="건수" radius={[4, 4, 0, 0]}>
                {chartData.map((_, index) => (
                  <Cell key={`c-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
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
      bondDept: groupSimple(externalRows, (row) => (row.bond_department_name ?? "").trim() || "미지정")
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
