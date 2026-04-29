"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { normalizeReceiptDate } from "@/lib/receipt-date";
import { readMonthAgeRollover, readMonthRollover } from "@/lib/month-rollup";
import { fallbackComplaintSubtypeString } from "@/lib/complaint-label-fallback";
import { useSearchParams } from "next/navigation";

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
  const searchParams = useSearchParams();
  const [month, setMonth] = useState("");
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isLocalMode, setIsLocalMode] = useState(false);

  useEffect(() => {
    const qm = (searchParams.get("month") ?? "").trim();
    if (/^\d{4}-\d{2}$/.test(qm)) {
      setMonth(qm);
      return;
    }
    setMonth(defaultStatisticsMonth());
  }, [searchParams]);

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
  const chartInsights = useMemo(() => {
    if (!data || month.length < 7) {
      return { ageGroups: "", businessMinor: "", productMajor: "", complaintTypes: "" };
    }
    const prev = buildLocalSummary(previousMonthKey(month)).charts;
    return {
      ageGroups: computeChartInsight(data.charts.ageGroups ?? [], prev.ageGroups ?? []),
      businessMinor: computeChartInsight(data.charts.businessMinor ?? [], prev.businessMinor ?? []),
      productMajor: computeChartInsight(data.charts.productMajor ?? [], prev.productMajor ?? []),
      complaintTypes: computeChartInsight(data.charts.complaintTypes ?? [], prev.complaintTypes ?? []),
    };
  }, [data, month]);

  if (!ready) {
    return (
      <section className="space-y-6">
        <div>
          <h3 className="text-2xl font-bold text-slate-950">민원통계</h3>
          <p className="mt-1 text-sm text-slate-500">월별 민원 발생 현황과 대외·대내 민원 분석</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          불러오는 중...
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-2xl font-bold text-slate-950">민원통계</h3>
          <p className="mt-1 text-sm text-slate-500">월별 민원 발생 현황과 대외·대내 민원 분석</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {isLocalMode ? (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-800">로컬 모드</span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-800">DB 모드</span>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-sm text-slate-600">
              <span className="sr-only md:not-sr-only md:inline">연도</span>
              <select
                value={selYear}
                onChange={(e) => setYearPart(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
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
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
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

      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard title="전체민원" value={data?.kpi.total ?? 0} />
        <KpiCard title="대외민원" value={data?.kpi.external ?? 0} caption="금감원 / 소보원" captionClass="text-indigo-700" />
        <KpiCard title="대내민원" value={data?.kpi.internal ?? 0} caption="홈페이지 / 고객센터" captionClass="text-emerald-700" />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">전월 대비 증감률</p>
          <p className={`mt-2 text-3xl font-black ${diffColor}`}>
            {data ? formatMoMPercent(data.kpi.diffRate) : "0%"}
          </p>
          <p className="mt-3 text-xs font-bold text-slate-400">(현월 − 전월) / 전월</p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          통계 계산 중...
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <AgeBracketChartCard items={data?.charts.ageGroups ?? []} insight={chartInsights.ageGroups} />
          <ExternalDonutCard
            title="업무별 분석 (대외민원 한정)"
            items={data?.charts.businessMinor ?? []}
            emptyDetail="해당 월에 접수된 대외민원이 없거나, 민원유형(소) 정보가 없습니다."
            cellKeyPrefix="biz"
            insight={chartInsights.businessMinor}
          />
          <ExternalDonutCard
            title="상품별 분석 (대외민원 한정)"
            items={data?.charts.productMajor ?? []}
            emptyDetail="해당 월에 접수된 대외민원이 없거나, 민원유형(대) 정보가 없습니다."
            cellKeyPrefix="prd"
            insight={chartInsights.productMajor}
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
            month={month}
            items={data?.charts.complaintTypes ?? []}
            insight={chartInsights.complaintTypes}
            className="lg:col-span-2"
          />
        </div>
      )}
    </section>
  );
}

function KpiCard({
  title,
  value,
  caption,
  captionClass
}: {
  title: string;
  value: number;
  caption?: string;
  captionClass?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">
        {value}
        <span className="text-xl font-black text-slate-600">건</span>
      </p>
      {caption ? (
        <p className={`mt-3 text-xs font-bold ${captionClass ?? "text-slate-500"}`}>{caption}</p>
      ) : null}
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

function AgeBracketChartCard({ items, insight }: { items: ChartItem[]; insight?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const total = items.reduce((s, i) => s + i.count, 0);
  const sortedByCount = [...items].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const top = sortedByCount[0];
  const topPct = total > 0 && top ? Number(((top.count / total) * 100).toFixed(1)) : 0;
  const pieData = sortChartItemsByAgeOrder(items).map((item) => ({ name: item.label, value: item.count }));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h4 className="text-sm font-bold text-slate-900">연령별 분석</h4>
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
      {insight ? (
        <p className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-xs leading-relaxed text-indigo-900">{insight}</p>
      ) : null}
    </div>
  );
}

/** 대외민원 한정 · 민원유형(소)/(대) 등 건수 기준 도넛 + 최다 유형 비율 */
function ExternalDonutCard({
  title,
  items,
  emptyDetail,
  cellKeyPrefix,
  className,
  insight
}: {
  title: string;
  items: ChartItem[];
  emptyDetail: string;
  cellKeyPrefix: string;
  className?: string;
  insight?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const total = items.reduce((s, i) => s + i.count, 0);
  const sortedByCount = [...items].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const top = sortedByCount[0];
  const topPct = total > 0 && top ? Number(((top.count / total) * 100).toFixed(1)) : 0;
  const pieData = sortedByCount.map((item) => ({ name: item.label, value: item.count }));

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className ?? ""}`}>
      <h4 className="text-sm font-bold text-slate-900">{title}</h4>
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
      {insight ? (
        <p className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-xs leading-relaxed text-indigo-900">{insight}</p>
      ) : null}
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

function ComplaintTypeSection({
  month,
  items,
  insight,
  className
}: {
  month: string;
  items: ChartItem[];
  insight?: string;
  className?: string;
}) {
  const grouped = groupComplaintTypeByMajor(items);
  const contentsByMajor = useMemo(() => buildComplaintContentsByMajorAndLabel(month), [month]);
  return (
    <section className={`space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className ?? ""}`}>
      <h4 className="text-sm font-bold text-slate-900">민원유형별 분류 (대외민원 한정)</h4>
      <p className="text-[11px] leading-snug text-slate-500">
        표의 항목명을 누르면 해당 소분류에 포함된 민원내용(브라우저에 저장된 업로드 기준)을 펼쳐 볼 수 있습니다.
      </p>
      {insight ? (
        <p className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-xs leading-relaxed text-indigo-900">{insight}</p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <ComplaintTypeDonutCard month={month} title="영업" items={grouped.영업} contentsByLabel={contentsByMajor.영업} cellKeyPrefix="ct-sales" />
        <ComplaintTypeDonutCard month={month} title="채권" items={grouped.채권} contentsByLabel={contentsByMajor.채권} cellKeyPrefix="ct-debt" />
        <ComplaintTypeDonutCard month={month} title="제도정책" items={grouped.제도정책} contentsByLabel={contentsByMajor.제도정책} cellKeyPrefix="ct-policy" />
        <ComplaintTypeDonutCard month={month} title="기타" items={grouped.기타} contentsByLabel={contentsByMajor.기타} cellKeyPrefix="ct-etc" />
      </div>
    </section>
  );
}

/** 민원유형별 분류 섹션 전용: 도넛 + 하단 표(범례 미표시) */
function ComplaintTypeDonutCard({
  month,
  title,
  items,
  contentsByLabel,
  cellKeyPrefix
}: {
  month: string;
  title: string;
  items: ChartItem[];
  contentsByLabel: Map<string, string[]>;
  cellKeyPrefix: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => setOpenLabel(null), [month]);
  const total = items.reduce((s, i) => s + i.count, 0);
  const sortedByCount = [...items].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const top = sortedByCount[0];
  const topPct = total > 0 && top ? Number(((top.count / total) * 100).toFixed(1)) : 0;
  const pieData = sortedByCount.map((item) => ({ name: item.label, value: item.count }));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h5 className="text-sm font-bold text-slate-900">{title}</h5>
      {!mounted ? (
        <div className="mt-4 h-[260px] animate-pulse rounded-lg bg-slate-100" />
      ) : items.length === 0 || total === 0 ? (
        <p className="mt-6 py-8 text-center text-sm text-slate-500">해당 대분류 데이터 없음</p>
      ) : (
        <>
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-center">
            <p className="text-xl font-semibold tracking-tight text-slate-900">
              {top.label} <span className="text-indigo-600">{topPct}%</span>
            </p>
          </div>
          <div className="mt-4 h-[230px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  isAnimationActive={false}
                  cx="50%"
                  cy="46%"
                  innerRadius={54}
                  outerRadius={84}
                  paddingAngle={2}
                  stroke="#fff"
                  strokeWidth={1}
                >
                  {pieData.map((_, index) => (
                    <Cell key={`${cellKeyPrefix}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 overflow-hidden rounded-md border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">항목</th>
                  <th className="px-2 py-1.5 text-right font-medium">건수</th>
                </tr>
              </thead>
              <tbody>
                {sortedByCount.map((item) => {
                  const open = openLabel === item.label;
                  const detailList = contentsByLabel.get(item.label) ?? [];
                  return (
                    <Fragment key={`${title}-${item.label}`}>
                      <tr className="border-t border-slate-100">
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => setOpenLabel((prev) => (prev === item.label ? null : item.label))}
                            className="flex w-full items-start gap-1 text-left text-slate-700 hover:text-indigo-700"
                          >
                            <span className="mt-0.5 shrink-0 text-[10px] text-slate-400" aria-hidden>
                              {open ? "▾" : "▸"}
                            </span>
                            <span>{item.label}</span>
                          </button>
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium text-slate-900">{item.count}건</td>
                      </tr>
                      {open ? (
                        <tr key={`${title}-${item.label}-detail`} className="border-t border-slate-100 bg-slate-50/80">
                          <td colSpan={2} className="px-2 py-2">
                            {detailList.length === 0 ? (
                              <p className="text-[11px] leading-relaxed text-slate-500">
                                이 브라우저에 저장된 해당 월·해당 항목 민원내용이 없습니다. 통계가 DB만으로 로드된 경우이거나, 월별 데이터
                                입력에서 업로드한 기록이 없을 수 있습니다.
                              </p>
                            ) : (
                              <ul className="max-h-52 space-y-2 overflow-y-auto text-[11px] leading-relaxed text-slate-700">
                                {detailList.map((line, idx) => (
                                  <li key={`${item.label}-c-${idx}`} className="border-l-2 border-indigo-200 pl-2">
                                    {line}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
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
      bondDept: groupSimple(externalRows, (row) => (row.bond_department_name ?? "").trim() || "미지정"),
      complaintTypes: groupSimple(externalRows, (row) => complaintTypeLabelForRow(row))
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

function toMap(items: ChartItem[]): Map<string, number> {
  return new Map(items.map((it) => [it.label, it.count]));
}

function sumCounts(items: ChartItem[]): number {
  return items.reduce((acc, it) => acc + it.count, 0);
}

function computeChartInsight(current: ChartItem[], prev: ChartItem[]): string {
  const curTotal = sumCounts(current);
  const prevTotal = sumCounts(prev);
  if (curTotal === 0 && prevTotal === 0) return "전월 및 당월 모두 집계 건수가 없어 비교 인사이트가 없습니다.";
  if (curTotal > 0 && prevTotal === 0) {
    const topOnly = [...current].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0];
    if (!topOnly) return "전월 비교 기준 데이터가 없어 당월 패턴을 우선 관찰해 주세요.";
    return `「${topOnly.label}」 문의 비중이 가장 높게 나타났습니다.`;
  }
  if (curTotal === 0 && prevTotal > 0) return "당월 집계가 없어 전월 대비 감소 상태입니다. 데이터 입력 누락 여부를 점검해 주세요.";

  const curSorted = [...current].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const top = curSorted[0];
  const topPct = curTotal > 0 ? ((top.count / curTotal) * 100).toFixed(1) : "0.0";

  const prevMap = toMap(prev);
  const growth = current
    .map((it) => ({ label: it.label, diff: it.count - (prevMap.get(it.label) ?? 0), count: it.count }))
    .sort((a, b) => b.diff - a.diff || b.count - a.count);
  const g = growth[0];

  if (!g || g.diff <= 0) {
    return `「${top.label}」 비중이 ${topPct}%로 가장 높고, 전월과 유사한 분포를 보였습니다.`;
  }
  return `「${g.label}」 항목이 전월 대비 ${g.diff > 0 ? `+${g.diff}` : g.diff}건으로 가장 크게 증가했습니다.`;
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

function complaintTypeLabelForRow(row: LocalRow): string {
  const sub = (row.ai_subcategory ?? "").trim();
  const cat = (row.ai_category ?? "").trim();
  if (!sub) return fallbackComplaintSubtypeString(row.complaint_content ?? "", row.complaint_type_minor ?? "");
  if (sub === "기타") return cat ? `${cat} 기타` : "기타";
  return sub;
}

function buildComplaintContentsByMajorAndLabel(month: string): Record<
  "영업" | "채권" | "제도정책" | "기타",
  Map<string, string[]>
> {
  const mk = (): Map<string, string[]> => new Map();
  const out: Record<"영업" | "채권" | "제도정책" | "기타", Map<string, string[]>> = {
    영업: mk(),
    채권: mk(),
    제도정책: mk(),
    기타: mk()
  };
  if (month.length < 7) return out;
  const rows = readLocalRows().filter((row) => rowInMonth(row, month));
  const externalRows = rows.filter((row) => normScope(row.complaint_scope) === "대외");
  for (const row of externalRows) {
    const label = complaintTypeLabelForRow(row);
    const major = complaintTypeMajor(label);
    const text = (row.complaint_content ?? "").trim() || "내용 없음";
    const bucket = out[major];
    const next = [...(bucket.get(label) ?? []), text];
    bucket.set(label, next);
  }
  return out;
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
