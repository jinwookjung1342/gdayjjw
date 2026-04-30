"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeReceiptDate } from "@/lib/receipt-date";
import {
  readMonthAgeRollover,
  writeMonthAgeRollover,
  writeMonthRollover,
  type MonthRollupEntry
} from "@/lib/month-rollup";
import { buildWordCombinedText } from "@/lib/issue-keywords";

type UnifiedRecord = {
  receipt_number: string;
  excel_row: Record<string, unknown>;
  complaint_scope: string;
  word_file_name: string | null;
  word_sections: Record<string, string>;
  word_matched?: boolean;
};

type ParseResult = {
  ok: boolean;
  excel_total: number;
  word_total: number;
  matched_total: number;
  external_total?: number;
  internal_total?: number;
  external_with_word_total?: number;
  unmatched_word_files: string[];
  preview_rows: Array<{
    receipt_number: string;
    excel_row: Record<string, unknown>;
    word_file_name: string;
    word_sections: Record<string, string>;
  }>;
  unified_records?: UnifiedRecord[];
  excel_columns: string[];
  /** 엑셀 접수일자·접수경로 기준 월별 집계 (YYYY-MM → 건수) — 민원통계 KPI와 동일 */
  month_rollup?: Record<string, MonthRollupEntry>;
  /** 동일 접수일 규칙으로 월별 연령대 건수 (전체 행·대내·대외 포함) */
  month_age_rollup?: Record<string, Record<string, number>>;
  /** 민원내용 AI 분류 결과 (접수번호별) */
  ai_labels_by_receipt?: Record<string, { category: string; subcategory: string }>;
  persisted?: boolean;
  persisted_count?: number;
  message?: string;
};

type ComplaintRecord = {
  id: string;
  receipt_number: string;
  receipt_date: string;
  complaint_scope: string;
  receipt_channel_name: string;
  business_unit_name: string | null;
  sales_department_name: string | null;
  bond_department_name: string | null;
  complaint_content: string;
  birth_date?: string | null;
  /** 엑셀 「연령대」 */
  age_group?: string | null;
  ai_category?: string | null;
  ai_subcategory?: string | null;
  complaint_type_minor?: string | null;
  complaint_type_major?: string | null;
  /** 회신서(Word) 추출 섹션 텍스트 합본 — 이달의 민원 키워드에 사용 */
  word_combined_text?: string | null;
  /** 회신서(Word) doc-ai 섹션별 본문 — 금감원 회신 주요 사례 등에 사용 */
  word_sections?: Record<string, string> | null;
  created_at: string;
};

const LOCAL_RECORDS_KEY = "jb_monthly_data_records";

async function safeParseJson<T>(response: Response): Promise<{ data: T | null; parseError: string }> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      data: null,
      parseError:
        "서버 응답이 비어 있습니다. doc-ai(FastAPI)가 http://127.0.0.1:8000 에서 실행 중인지 확인하세요."
    };
  }
  try {
    return { data: JSON.parse(text) as T, parseError: "" };
  } catch {
    return { data: null, parseError: "응답을 JSON으로 읽을 수 없습니다. 서버 연결/타임아웃을 확인하세요." };
  }
}

export default function MonthlyDataPage() {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [wordFiles, setWordFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);
  const [records, setRecords] = useState<ComplaintRecord[]>([]);
  const [fetchingRecords, setFetchingRecords] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [keyword, setKeyword] = useState("");
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);
  const [isLocalMode, setIsLocalMode] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Pick<ComplaintRecord, "receipt_date" | "complaint_scope" | "receipt_channel_name" | "complaint_content">>({
    receipt_date: "",
    complaint_scope: "대내",
    receipt_channel_name: "",
    complaint_content: ""
  });
  const [saveLoading, setSaveLoading] = useState(false);

  const hasFiles = useMemo(() => !!excelFile, [excelFile]);

  useEffect(() => {
    if (!loading) {
      setElapsedSec(0);
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    setLoading(false);
    void loadRecords();
  }, []);

  async function runUpload() {
    if (loading) return;
    if (!excelFile) {
      setError("엑셀 파일을 먼저 선택해주세요. (같은 파일을 다시 고르려면 한 번 지웠다가 다시 선택하세요.)");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("excelFile", excelFile);
      wordFiles.forEach((file) => formData.append("wordFiles", file));

      const response = await fetch("/api/monthly-data/parse", {
        method: "POST",
        body: formData
      });
      const { data: body, parseError } = await safeParseJson<ParseResult & { message?: string }>(response);
      if (parseError || !body) {
        setError(parseError);
        return;
      }
      if (!response.ok || !body.ok) {
        setError(body.message ?? "업로드 처리 중 오류가 발생했습니다.");
        return;
      }

      setResult(body);
      if (body.month_rollup && Object.keys(body.month_rollup).length > 0) {
        writeMonthRollover(body.month_rollup);
      }
      if (body.month_age_rollup && Object.keys(body.month_age_rollup).length > 0) {
        writeMonthAgeRollover({ ...readMonthAgeRollover(), ...body.month_age_rollup });
      }
      if (body.unified_records && body.unified_records.length > 0) {
        upsertLocalRecords(parseUnifiedToLocalRecords(body.unified_records, body.ai_labels_by_receipt));
      } else if (body.preview_rows?.length) {
        upsertLocalRecords(parsePreviewRowsToLocalRecords(body.preview_rows));
      }
      await loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청 중 오류가 발생했습니다. 네트워크·서버(doc-ai) 상태를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRecords() {
    setFetchingRecords(true);
    const query = new URLSearchParams();
    if (fromDate) query.set("from", fromDate);
    if (toDate) query.set("to", toDate);
    if (keyword.trim()) query.set("keyword", keyword.trim());

    try {
      const response = await fetch(`/api/monthly-data/records?${query.toString()}`);
      const { data: body, parseError } = await safeParseJson<{
        ok: boolean;
        rows?: ComplaintRecord[];
        message?: string;
      }>(response);
      if (parseError || !body) {
        const filteredLocal = filterLocalRecords(readLocalRecords(), fromDate, toDate, keyword);
        setRecords(filteredLocal);
        setIsLocalMode(true);
        setError(parseError);
        setFetchingRecords(false);
        return;
      }
      if (!response.ok || !body.ok) {
        const filteredLocal = filterLocalRecords(readLocalRecords(), fromDate, toDate, keyword);
        setRecords(filteredLocal);
        setIsLocalMode(true);
        setError(body.message ?? "DB 조회에 실패하여 로컬 데이터로 표시합니다.");
        setFetchingRecords(false);
        return;
      }
      const merged = mergeApiRowsWithLocal(body.rows ?? []);
      setRecords(filterLocalRecords(merged, fromDate, toDate, keyword));
      setIsLocalMode(false);
      setError("");
      setFetchingRecords(false);
    } catch {
      const filteredLocal = filterLocalRecords(readLocalRecords(), fromDate, toDate, keyword);
      setRecords(filteredLocal);
      setIsLocalMode(true);
      setError("DB 연결이 없어 로컬 데이터로 표시합니다.");
      setFetchingRecords(false);
    }
  }

  async function onDeleteRecord(id: string) {
    const confirmed = window.confirm("선택한 행을 삭제하시겠습니까?");
    if (!confirmed) return;

    setDeleteLoadingId(id);
    if (isLocalMode) {
      const remaining = readLocalRecords().filter((row) => row.id !== id);
      writeLocalRecords(remaining);
      setDeleteLoadingId(null);
      await loadRecords();
      return;
    }

    try {
      const response = await fetch("/api/monthly-data/records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      const { data: body, parseError } = await safeParseJson<{ ok: boolean; message?: string }>(response);
      if (parseError || !body) {
        setError(parseError);
        setDeleteLoadingId(null);
        return;
      }
      if (!response.ok || !body.ok) {
        setError(body.message ?? "행 삭제에 실패했습니다.");
        setDeleteLoadingId(null);
        return;
      }
      setDeleteLoadingId(null);
      await loadRecords();
    } catch {
      setError("삭제 요청 중 오류가 발생했습니다.");
      setDeleteLoadingId(null);
    }
  }

  async function onClearLocalRecords() {
    const confirmed = window.confirm("로컬 모드에 저장된 누적 데이터를 모두 삭제할까요?");
    if (!confirmed) return;
    writeLocalRecords([]);
    await loadRecords();
  }

  function onStartEdit(record: ComplaintRecord) {
    setEditId(record.id);
    setEditForm({
      receipt_date: record.receipt_date ?? "",
      complaint_scope: record.complaint_scope ?? "대내",
      receipt_channel_name: record.receipt_channel_name ?? "",
      complaint_content: record.complaint_content ?? ""
    });
  }

  function onCancelEdit() {
    setEditId(null);
    setSaveLoading(false);
  }

  async function onSaveEdit(id: string) {
    setSaveLoading(true);
    if (isLocalMode) {
      const updated = readLocalRecords().map((row) =>
        row.id === id
          ? {
              ...row,
              receipt_date: editForm.receipt_date,
              complaint_scope: editForm.complaint_scope,
              receipt_channel_name: editForm.receipt_channel_name,
              complaint_content: editForm.complaint_content
            }
          : row
      );
      writeLocalRecords(updated);
      setSaveLoading(false);
      setEditId(null);
      await loadRecords();
      return;
    }

    try {
      const response = await fetch("/api/monthly-data/records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...editForm })
      });
      const { data: body, parseError } = await safeParseJson<{ ok: boolean; message?: string }>(response);
      if (parseError || !body) {
        setError(parseError);
        setSaveLoading(false);
        return;
      }
      if (!response.ok || !body.ok) {
        setError(body.message ?? "수정 저장에 실패했습니다.");
        setSaveLoading(false);
        return;
      }
      setSaveLoading(false);
      setEditId(null);
      await loadRecords();
    } catch {
      setError("수정 저장 요청 중 오류가 발생했습니다.");
      setSaveLoading(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-slate-950">월별 데이터 입력</h3>
        <p className="mt-1 text-sm text-slate-500">Excel·Word 업로드 후 접수번호 기준 통합</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Excel 파일 (1개)</label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setExcelFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Word 회신서 (여러 개)</label>
            <input
              type="file"
              multiple
              accept=".docx"
              onChange={(e) => setWordFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-700"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <button
            type="button"
            onClick={() => void runUpload()}
            disabled={loading}
            title={loading ? "처리 중입니다" : "엑셀 파일이 선택돼 있어야 합니다(클릭 시 안내)"}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-80"
          >
            {loading ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                파싱 중... ({elapsedSec}초)
              </>
            ) : (
              "업로드 및 매핑 실행"
            )}
          </button>
          <div className="text-xs text-slate-500">
            {loading ? (
              <p>서버에서 파일을 분석 중입니다. 30초 이상 걸릴 수 있습니다.</p>
            ) : (
              <>
                <p>엑셀은 필수입니다. Word는 선택(없으면 엑셀만 파싱, 대외 민원+Word 자동매칭은 생략).</p>
                <p>기관접수번호(엑셀)와 접수번호(Word 본문)를 자동 매핑합니다.</p>
              </>
            )}
          </div>
        </div>
        {!hasFiles ? (
          <p className="text-sm text-amber-700">엑셀을 먼저 선택하세요. 실행을 누르면 미선택 시 안내 문구가 뜹니다.</p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>

      {result ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <StatCard title="엑셀 전체" value={result.excel_total} subtitle="동일 접수번호 중복 시 행수 기준" />
            <StatCard title="대외민원" value={result.external_total ?? 0} subtitle="접수경로 구분(전체 행)" />
            <StatCard
              title="대내민원"
              value={Math.max(0, result.excel_total - (result.external_total ?? 0))}
              subtitle="엑셀 전체 − 대외(접수경로)"
            />
            <StatCard title="대외+Word연결" value={result.external_with_word_total ?? 0} subtitle="회신서 매칭 성공" />
            <StatCard title="Word→엑셀 검증" value={result.matched_total} subtitle="접수번호 일치 건수" />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h4 className="text-sm font-semibold text-slate-900">DB 저장 결과</h4>
            <p className="mt-2 text-sm text-slate-600">
              {typeof result.persisted_count === "number"
                ? `${result.persisted_count}건 저장됨 (${result.persisted ? "성공" : "저장 건너뜀/실패"})`
                : "저장 결과 정보 없음"}
            </p>
            {result.message ? <p className="mt-1 text-xs text-slate-500">{result.message}</p> : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h4 className="text-sm font-semibold text-slate-900">미매핑 Word 파일</h4>
            <p className="mt-2 text-sm text-slate-600">
              {result.unmatched_word_files.length > 0 ? result.unmatched_word_files.join(", ") : "없음"}
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3">접수번호</th>
                  <th className="px-4 py-3">Word 파일</th>
                  <th className="px-4 py-3">Excel 매핑 여부</th>
                </tr>
              </thead>
              <tbody>
                {result.preview_rows.map((row, index) => (
                  <tr key={`${row.word_file_name}-${index}`} className="border-t border-slate-100">
                    <td className="px-4 py-3">{row.receipt_number || "-"}</td>
                    <td className="px-4 py-3">{row.word_file_name}</td>
                    <td className="px-4 py-3">{Object.keys(row.excel_row ?? {}).length > 0 ? "성공" : "실패"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="text-base font-semibold text-slate-900">누적 데이터 조회</h4>
            <p className="mt-0.5 max-w-md text-[11px] leading-snug text-slate-500">
              {isLocalMode
                ? "Supabase가 없거나 DB 조회가 실패해 브라우저(로컬 저장)에 쌓인 민원만 보여 줍니다."
                : "프로젝트 .env에 Supabase가 있고, 방금 /api/monthly-data/records 조회가 성공한 경우입니다. (업로드/파싱과는 별개 표시)"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isLocalMode ? (
              <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">로컬 모드</span>
            ) : (
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">DB 모드</span>
            )}
            <button
              type="button"
              onClick={() => void loadRecords()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              새로고침
            </button>
            {isLocalMode ? (
              <button
                type="button"
                onClick={() => void onClearLocalRecords()}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                로컬 전체삭제
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-slate-500">접수일자 시작</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">접수일자 종료</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs text-slate-500">접수번호/민원내용 검색</label>
            <div className="flex gap-2">
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="예: 2025A0001, 중도상환"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void loadRecords()}
                className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white"
              >
                검색
              </button>
            </div>
          </div>
        </div>

        {!isLocalMode && !fetchingRecords && records.length === 0 ? (
          <p className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-3 text-[11px] leading-relaxed text-amber-900">
            서버(DB)에는 아직 저장된 민원 행이 없거나, 검색 조건에 맞는 행이 없습니다. Supabase 대시보드의{" "}
            <span className="font-semibold">complaint_records</span> 테이블에 행이 있는지 확인하세요. 여기가 0이면
            월별 업로드가 <span className="font-semibold">다른 Supabase 프로젝트</span>(또는 로컬 .env)로 들어갔을 수
            있습니다. Vercel 프로젝트 → Settings → Environment Variables의{" "}
            <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span>·
            <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span>가 그 프로젝트와 짝이 맞는지 봐 주세요.
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2">접수일자</th>
                <th className="px-3 py-2">접수번호</th>
                <th className="px-3 py-2">구분</th>
                <th className="px-3 py-2">접수경로</th>
                <th className="px-3 py-2">민원내용</th>
                <th className="px-3 py-2">작업</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    {editId === record.id ? (
                      <input
                        type="date"
                        value={editForm.receipt_date}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, receipt_date: e.target.value }))}
                        className="w-32 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    ) : (
                      record.receipt_date ?? "-"
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium">{record.receipt_number}</td>
                  <td className="px-3 py-2">
                    {editId === record.id ? (
                      <select
                        value={editForm.complaint_scope}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, complaint_scope: e.target.value }))}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="대내">대내</option>
                        <option value="대외">대외</option>
                      </select>
                    ) : (
                      record.complaint_scope
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editId === record.id ? (
                      <input
                        value={editForm.receipt_channel_name}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, receipt_channel_name: e.target.value }))}
                        className="w-36 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    ) : (
                      record.receipt_channel_name
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editId === record.id ? (
                      <textarea
                        value={editForm.complaint_content}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, complaint_content: e.target.value }))}
                        className="h-20 w-80 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    ) : (
                      <p className="line-clamp-2 max-w-md">{record.complaint_content}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {editId === record.id ? (
                        <>
                          <button
                            type="button"
                            disabled={saveLoading}
                            onClick={() => void onSaveEdit(record.id)}
                            className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                          >
                            {saveLoading ? "저장 중..." : "저장"}
                          </button>
                          <button
                            type="button"
                            onClick={onCancelEdit}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                          >
                            취소
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onStartEdit(record)}
                            className="rounded-md border border-blue-300 px-2 py-1 text-xs font-semibold text-blue-700"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            disabled={deleteLoadingId === record.id}
                            onClick={() => void onDeleteRecord(record.id)}
                            className="rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-600 disabled:opacity-60"
                          >
                            {deleteLoadingId === record.id ? "삭제 중..." : "삭제"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {records.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
                    {fetchingRecords
                      ? "조회 중..."
                      : isLocalMode
                        ? "저장된 데이터가 없습니다. (로컬 모드: 이 브라우저에만 쌓인 데이터만 조회)"
                        : "조회 결과가 없습니다."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function StatCard({ title, value, subtitle }: { title: string; value: number; subtitle?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {subtitle ? <p className="mt-1 text-[11px] leading-snug text-slate-400">{subtitle}</p> : null}
    </div>
  );
}

function routeLabelFromExcel(excel: Record<string, unknown>): string {
  return String(
    excel["접수경로구분명"] ?? excel["접수경로분류명"] ?? excel["접수경로"] ?? "기타"
  );
}

function normalizedHeaderKey(raw: string): string {
  return String(raw ?? "")
    .replace(/[\s()_\-./]/g, "")
    .trim()
    .toLowerCase();
}

function excelText(excel: Record<string, unknown>, candidates: string[], fallback = ""): string {
  for (const key of candidates) {
    const value = excel[key];
    if (value != null && String(value).trim()) return String(value);
  }
  const normalizedToValue = new Map<string, unknown>();
  for (const [k, v] of Object.entries(excel)) normalizedToValue.set(normalizedHeaderKey(k), v);
  for (const key of candidates) {
    const value = normalizedToValue.get(normalizedHeaderKey(key));
    if (value != null && String(value).trim()) return String(value);
  }
  return fallback;
}

function parseUnifiedToLocalRecords(
  unified: UnifiedRecord[],
  aiMap?: Record<string, { category: string; subcategory: string }>
): ComplaintRecord[] {
  return unified.map((row) => {
    const excel = row.excel_row ?? {};
    const rawDate = excel["접수일자"] ?? excel["접수일"];
    const ai = aiMap?.[row.receipt_number];
    return {
      id: `local-${row.receipt_number}`,
      receipt_number: row.receipt_number,
      receipt_date: normalizeReceiptDate(rawDate),
      complaint_scope: row.complaint_scope,
      receipt_channel_name: routeLabelFromExcel(excel),
      business_unit_name: String(excel["업무"] ?? ""),
      sales_department_name: String(excel["영업부서명"] ?? ""),
      bond_department_name: String(excel["채권부서명"] ?? ""),
      complaint_content: excelText(excel, ["민원내용", "민원 내용"], row.word_sections?.complainant_summary ?? "내용 미입력"),
      birth_date: excel["생년월일"] ? String(excel["생년월일"]).replaceAll(".", "-").slice(0, 10) : null,
      age_group: String(excel["연령대"] ?? "").trim() || null,
      ai_category: ai?.category ?? null,
      ai_subcategory: ai?.subcategory ?? null,
      complaint_type_minor: excelText(excel, ["민원유형(소)", "민원유형소", "민원유형 소", "민원유형_소"], ""),
      complaint_type_major: excelText(excel, ["민원유형", "민원 유형"], ""),
      word_sections: sanitizeWordSectionsPayload(row.word_sections),
      word_combined_text: buildWordCombinedText(row.word_sections ?? {}),
      created_at: new Date().toISOString()
    };
  });
}

function sanitizeWordSectionsPayload(ws: Record<string, string> | undefined): Record<string, string> | null {
  if (!ws || typeof ws !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ws)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : null;
}

function parsePreviewRowsToLocalRecords(rows: ParseResult["preview_rows"]): ComplaintRecord[] {
  return rows
    .filter((row) => row.receipt_number)
    .map((row) => {
      const excel = row.excel_row ?? {};
      const routeText = routeLabelFromExcel(excel);
      const external =
        routeText.includes("금융감독원") ||
        routeText.includes("금감원") ||
        routeText.includes("한국소비자원") ||
        routeText.includes("한국소비자보호원") ||
        routeText.includes("소비자보호원") ||
        routeText.includes("소비자원");
      const rawDate = excel["접수일자"] ?? excel["접수일"];
      return {
        id: `local-${row.receipt_number}`,
        receipt_number: row.receipt_number,
        receipt_date: normalizeReceiptDate(rawDate),
        complaint_scope: external ? "대외" : "대내",
        receipt_channel_name: routeText || "기타",
        business_unit_name: String(excel["업무"] ?? ""),
        sales_department_name: String(excel["영업부서명"] ?? ""),
        bond_department_name: String(excel["채권부서명"] ?? ""),
        complaint_content: excelText(excel, ["민원내용", "민원 내용"], row.word_sections?.complainant_summary ?? "내용 미입력"),
        birth_date: excel["생년월일"] ? String(excel["생년월일"]).replaceAll(".", "-").slice(0, 10) : null,
        age_group: String(excel["연령대"] ?? "").trim() || null,
        complaint_type_minor: excelText(excel, ["민원유형(소)", "민원유형소", "민원유형 소", "민원유형_소"], ""),
        complaint_type_major: excelText(excel, ["민원유형", "민원 유형"], ""),
        word_sections: sanitizeWordSectionsPayload(row.word_sections),
        word_combined_text: buildWordCombinedText(row.word_sections ?? {}),
        created_at: new Date().toISOString()
      };
    });
}

function readLocalRecords(): ComplaintRecord[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(LOCAL_RECORDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ComplaintRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Supabase에 아직 없는 건(로컬에만 있는 접수번호)을 테이블에 같이 보여 주기 */
function mergeApiRowsWithLocal(apiRows: ComplaintRecord[]): ComplaintRecord[] {
  const byReceipt = new Map<string, ComplaintRecord>();
  for (const r of apiRows) {
    byReceipt.set(r.receipt_number, r);
  }
  for (const r of readLocalRecords()) {
    if (!byReceipt.has(r.receipt_number)) {
      byReceipt.set(r.receipt_number, r);
    }
  }
  return Array.from(byReceipt.values());
}

function writeLocalRecords(rows: ComplaintRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_RECORDS_KEY, JSON.stringify(rows));
}

function upsertLocalRecords(newRows: ComplaintRecord[]) {
  const existing = readLocalRecords();
  const byReceipt = new Map(existing.map((row) => [row.receipt_number, row]));
  newRows.forEach((row) => byReceipt.set(row.receipt_number, row));
  writeLocalRecords(Array.from(byReceipt.values()));
}

function filterLocalRecords(rows: ComplaintRecord[], from: string, to: string, keyword: string) {
  const q = keyword.trim().toLowerCase();
  return rows
    .filter((row) => {
      const date = row.receipt_date || "";
      if (from && date && date < from) return false;
      if (to && date && date > to) return false;
      if (!q) return true;
      return row.receipt_number.toLowerCase().includes(q) || row.complaint_content.toLowerCase().includes(q);
    })
    .sort((a, b) => (a.receipt_date < b.receipt_date ? 1 : -1));
}
