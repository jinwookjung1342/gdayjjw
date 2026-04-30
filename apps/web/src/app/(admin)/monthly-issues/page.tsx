"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeReceiptDate } from "@/lib/receipt-date";
import { aggregateComplaintKeywords } from "@/lib/issue-keywords";
import { useSearchParams } from "next/navigation";
import {
  FSS_REPLY_SECTION_LABELS,
  getFsscParagraphTriple,
  normalizeSoftWrappedText,
  parseWordSectionsFlexible,
  pickFirstFsscSubstantiveCase,
} from "@/lib/fss-case-example";

const LOCAL_RECORDS_KEY = "jb_monthly_data_records";
const FSSC_EDIT_STORAGE_PREFIX = "jb_monthly_issues_fssc_edit_";
const INSIGHT_STORAGE_PREFIX = "jb_monthly_issues_insight_";

type IssueRow = {
  receipt_number?: string;
  receipt_date: string;
  complaint_scope: string;
  receipt_channel_name: string;
  complaint_content: string;
  word_combined_text?: string | null;
  word_sections?: Record<string, string> | null;
  ai_category?: string | null;
  ai_subcategory?: string | null;
  complaint_type_minor?: string | null;
  created_at?: string;
};

type FsscEditDraft = {
  source_receipt: string;
  paragraphs: [string, string, string];
  updated_at: string;
};

function formatYearMonthLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function defaultReportMonth(): string {
  const d = new Date();
  return formatYearMonthLocal(new Date(d.getFullYear(), d.getMonth() - 1, 1));
}

function normScope(s: string | undefined): string {
  return (s ?? "").trim();
}

function rowInMonth(row: IssueRow, month: string): boolean {
  const fixed = normalizeReceiptDate(row.receipt_date);
  if (fixed.length >= 7 && fixed.slice(0, 7) === month) return true;
  const raw = row.receipt_date ?? "";
  if (raw.length >= 7 && raw.slice(0, 7) === month) return true;
  if (!fixed && row.created_at && row.created_at.length >= 7 && row.created_at.slice(0, 7) === month) {
    return true;
  }
  return false;
}

function readLocalRows(): IssueRow[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(LOCAL_RECORDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as IssueRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadFsscDraft(month: string): FsscEditDraft | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(`${FSSC_EDIT_STORAGE_PREFIX}${month}`);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as FsscEditDraft;
    if (!o || typeof o.source_receipt !== "string" || !Array.isArray(o.paragraphs) || o.paragraphs.length !== 3) {
      return null;
    }
    return {
      source_receipt: o.source_receipt,
      paragraphs: [String(o.paragraphs[0] ?? ""), String(o.paragraphs[1] ?? ""), String(o.paragraphs[2] ?? "")],
      updated_at: typeof o.updated_at === "string" ? o.updated_at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function saveFsscDraft(month: string, draft: FsscEditDraft) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${FSSC_EDIT_STORAGE_PREFIX}${month}`, JSON.stringify(draft));
}

function loadInsightText(month: string): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(`${INSIGHT_STORAGE_PREFIX}${month}`) ?? "";
}

function persistInsightText(month: string, text: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${INSIGHT_STORAGE_PREFIX}${month}`, text);
}

export default function MonthlyIssuesPage() {
  const searchParams = useSearchParams();
  const [month, setMonth] = useState("");
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editBuf, setEditBuf] = useState<[string, string, string]>(["", "", ""]);
  const [savedFlash, setSavedFlash] = useState(false);
  const [insightStored, setInsightStored] = useState("");
  const [insightDraft, setInsightDraft] = useState("");
  const [insightEditing, setInsightEditing] = useState(false);
  const [insightSavedFlash, setInsightSavedFlash] = useState(false);

  useEffect(() => {
    const qm = (searchParams.get("month") ?? "").trim();
    if (/^\d{4}-\d{2}$/.test(qm)) {
      setMonth(qm);
      setReady(true);
      return;
    }
    setMonth(defaultReportMonth());
    setReady(true);
  }, [searchParams]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_RECORDS_KEY) setTick((t) => t + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const externalRows = useMemo(() => {
    if (month.length < 7) return [];
    return readLocalRows().filter((row) => rowInMonth(row, month) && normScope(row.complaint_scope) === "대외");
  }, [month, ready, tick]);

  const keywords = useMemo(() => aggregateComplaintKeywords(externalRows).slice(0, 10), [externalRows]);

  const fssCaseRow = useMemo(() => {
    if (month.length < 7) return null;
    return pickFirstFsscSubstantiveCase(readLocalRows(), month, rowInMonth);
  }, [month, ready, tick]);

  const autoTriple = useMemo(() => {
    if (!fssCaseRow) return ["", "", ""] as [string, string, string];
    return getFsscParagraphTriple(fssCaseRow.word_sections);
  }, [fssCaseRow]);

  const draftFromStorage = useMemo(() => (month.length >= 7 ? loadFsscDraft(month) : null), [month, tick, ready]);

  const displayTriple = useMemo((): [string, string, string] => {
    if (!fssCaseRow) return ["", "", ""];
    const dr = draftFromStorage;
    if (dr && dr.source_receipt === (fssCaseRow.receipt_number ?? "")) {
      return [
        normalizeSoftWrappedText(dr.paragraphs[0] ?? ""),
        normalizeSoftWrappedText(dr.paragraphs[1] ?? ""),
        normalizeSoftWrappedText(dr.paragraphs[2] ?? ""),
      ];
    }
    return autoTriple;
  }, [fssCaseRow, autoTriple, draftFromStorage]);

  const hasWordSectionsInStore = useMemo(() => {
    if (month.length < 7) return false;
    const rows = readLocalRows().filter((r) => rowInMonth(r, month) && normScope(r.complaint_scope) === "대외");
    return rows.some((r) => Object.keys(parseWordSectionsFlexible(r.word_sections)).length > 0);
  }, [month, ready, tick]);

  useEffect(() => {
    setEditing(false);
  }, [month, fssCaseRow?.receipt_number]);

  useEffect(() => {
    if (month.length < 7) return;
    const t = loadInsightText(month);
    setInsightStored(t);
    setInsightDraft(t);
    setInsightEditing(false);
  }, [month]);

  function handleInsightSave() {
    if (month.length < 7) return;
    persistInsightText(month, insightDraft);
    setInsightStored(insightDraft);
    setInsightEditing(false);
    setInsightSavedFlash(true);
    setTick((x) => x + 1);
    window.setTimeout(() => setInsightSavedFlash(false), 2000);
  }

  function handleInsightCancel() {
    setInsightDraft(insightStored);
    setInsightEditing(false);
  }

  if (!ready || month.length < 7) {
    return (
      <section className="space-y-6">
        <div className="h-9 w-48 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
      </section>
    );
  }

  const topKw = keywords[0];
  const remainingKw = keywords.slice(1);

  function handleStartEdit() {
    if (!fssCaseRow) return;
    setEditBuf([...displayTriple]);
    setEditing(true);
  }

  function handleSaveEdit() {
    if (!fssCaseRow || month.length < 7) return;
    const rn = fssCaseRow.receipt_number ?? "";
    saveFsscDraft(month, {
      source_receipt: rn,
      paragraphs: [
        normalizeSoftWrappedText(editBuf[0] ?? ""),
        normalizeSoftWrappedText(editBuf[1] ?? ""),
        normalizeSoftWrappedText(editBuf[2] ?? ""),
      ],
      updated_at: new Date().toISOString(),
    });
    setEditing(false);
    setTick((t) => t + 1);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <h3 className="text-2xl font-bold text-slate-950">이달의 민원</h3>
        <label className="flex flex-col text-xs font-medium text-slate-600">
          <span className="mb-1">기준 월</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm"
          />
        </label>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h4 className="text-sm font-bold text-slate-900">이달의 민원 인사이트</h4>
          <div className="flex flex-wrap gap-2">
            {!insightEditing ? (
              <button
                type="button"
                onClick={() => {
                  setInsightDraft(insightStored);
                  setInsightEditing(true);
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50"
              >
                수정
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleInsightCancel}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleInsightSave}
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-slate-900"
                >
                  {insightSavedFlash ? "저장됨" : "저장"}
                </button>
              </>
            )}
          </div>
        </div>
        {insightEditing ? (
          <textarea
            value={insightDraft}
            onChange={(e) => setInsightDraft(e.target.value)}
            rows={8}
            placeholder="이번 달 민원 흐름·특이사항·보고용 메모 등을 자유롭게 입력하세요."
            className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        ) : (
          <div className="mt-4 min-h-[5rem] rounded-xl border border-dashed border-slate-100 bg-slate-50/40 px-4 py-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
            {insightStored.trim() ? insightStored : "아직 작성된 내용이 없습니다. 「수정」을 눌러 입력할 수 있습니다."}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h4 className="text-sm font-bold text-slate-900">민원내용 키워드 (빈도)</h4>

        {keywords.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">
            해당 월 대외민원이 없거나 키워드를 추출할 수 없습니다.「월별 데이터 입력」에서 엑셀(+ Word) 업로드를 한 뒤 다시 확인하세요.
          </p>
        ) : (
          <>
            {topKw ? (
              <div className="mt-6 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/90 to-white px-5 py-6 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">많이 포함된 키워드</p>
                <p className="mt-3 text-4xl font-black tracking-tight text-slate-950 md:text-[2.75rem]">{topKw.word}</p>
                <p className="mt-2 text-sm text-slate-600">
                  <span className="font-bold text-indigo-700">{topKw.count}건</span>의 대외민원에 포함됨
                </p>
              </div>
            ) : null}

            {remainingKw.length > 0 ? (
              <div className="mt-5 max-h-[7.25rem] overflow-hidden">
                <div className="flex flex-wrap gap-1.5">
                  {remainingKw.map((k) => (
                    <span
                      key={k.word}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-800"
                    >
                      #{k.word}
                      <span className="font-black text-indigo-600">{k.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h4 className="text-sm font-bold text-slate-900">금감원 회신 주요 사례</h4>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!fssCaseRow || editing}
              onClick={handleStartEdit}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              수정
            </button>
            <button
              type="button"
              disabled={!fssCaseRow || !editing}
              onClick={() => setEditing(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              취소
            </button>
            <button
              type="button"
              disabled={!fssCaseRow || !editing}
              onClick={handleSaveEdit}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {savedFlash ? "저장됨" : "저장"}
            </button>
          </div>
        </div>

        {!fssCaseRow ? (
          <div className="mt-5 rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-4 text-sm text-amber-900">
            {!hasWordSectionsInStore
              ? "Word 회신서에서 추출한 섹션이 아직 저장되지 않았습니다.「월별 데이터 입력」에서 엑셀과 Word를 함께 파싱·저장한 뒤, 이 페이지를 새로 고침하세요."
              : '조건을 만족하는 사례가 없습니다. (금융감독원·한국소비자원 접수건 중 Word 매핑, 그리고 "민원의 주장 요지" 등 3단락이 모두 해당사항 없음이 아닌 건 필요)'}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-baseline gap-2 border-b border-slate-100 pb-3 text-xs text-slate-600">
              <span className="rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-800">
                {String(fssCaseRow.receipt_channel_name ?? "").trim()}
              </span>
              <span className="font-mono font-semibold text-slate-800">접수번호 {fssCaseRow.receipt_number ?? "—"}</span>
            </div>

            {FSS_REPLY_SECTION_LABELS.map(([sid, title], idx) => (
              <div key={sid} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                <p className="text-[15px] font-extrabold leading-snug text-slate-900">{title}</p>
                {editing ? (
                  <textarea
                    value={editBuf[idx]}
                    onChange={(e) => {
                      const next = [...editBuf] as [string, string, string];
                      next[idx] = e.target.value;
                      setEditBuf(next);
                    }}
                    rows={6}
                    className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-800"
                  />
                ) : (
                  <p className="mt-2.5 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">
                    {(displayTriple[idx] || "").trim() || "—"}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
