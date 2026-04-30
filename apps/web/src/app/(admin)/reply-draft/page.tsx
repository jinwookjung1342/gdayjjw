"use client";

import { useMemo, useState } from "react";

type SearchRow = {
  id: string;
  receipt_number: string;
  receipt_date: string;
  complaint_type_major: string;
  ai_category: string;
  similarity: number;
  summary: string;
  sections?: {
    complainant_summary?: string;
    similar_case_content?: string;
    company_opinion?: string;
    violation_and_action?: string;
    future_action_plan?: string;
  };
};

type Guide = {
  section1: string;
  section2: string;
  section3: string;
  section4: string;
  section5: string;
  section6: string;
  section7: string;
  section8: string;
};

const PRODUCT_OPTIONS = ["전체", "PL", "리스", "중고차", "기타"];
const CATEGORY_OPTIONS = ["전체", "영업", "채권", "고객상담", "제도정책", "기타"];

const SECTION_TITLES: Array<[keyof Guide, string]> = [
  ["section1", "1. 제3자여부, 소송관련사항, 긴급 처리를 요하는 사항"],
  ["section2", "2. 민원인 주장 요지"],
  ["section3", "3. 동일 내용 민원 및 처리 내용"],
  ["section4", "4. 민원인의 주장 및 요구사항에 대한 당사의 구체적 의견"],
  ["section5", "5. 내부 조사결과 위규(법) 등 부당행위 및 조치 내용"],
  ["section6", "6. 민원인의 요청사항에 대한 의견 및 향후 처리방안"],
  ["section7", "7. 검토의견 등에 대한 문의처"],
  ["section8", "8. 기타 동 민원 관련 참고사항"]
];

export default function ReplyDraftPage() {
  const [query, setQuery] = useState("");
  const [productType, setProductType] = useState("전체");
  const [category, setCategory] = useState("전체");
  const [searchRows, setSearchRows] = useState<SearchRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [modeText, setModeText] = useState("");
  const [previewRow, setPreviewRow] = useState<SearchRow | null>(null);
  const [openingReceipt, setOpeningReceipt] = useState("");
  const [sourceOpenInfo, setSourceOpenInfo] = useState("");

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  async function onSearch() {
    setError("");
    setGuide(null);
    if (query.trim().length < 5) {
      setError("민원 내용을 5자 이상 입력해 주세요.");
      return;
    }
    setSearching(true);
    try {
      const res = await fetch("/api/reply-draft/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, productType, category, limit: 10 })
      });
      const body = (await res.json()) as { ok?: boolean; rows?: SearchRow[]; message?: string };
      if (!res.ok || !body.ok) {
        setError(body.message ?? "유사사례 검색에 실패했습니다.");
        setSearching(false);
        return;
      }
      setSearchRows(Array.isArray(body.rows) ? body.rows : []);
      setSelected((body.rows ?? []).slice(0, 1).map((r) => r.receipt_number));
      if ((body.rows ?? []).length === 0) {
        setError("검색 조건에 맞는 유사사례를 찾지 못했습니다.");
      }
      setSearching(false);
    } catch {
      setError("네트워크 오류로 유사사례 검색에 실패했습니다.");
      setSearching(false);
    }
  }

  async function onGenerateGuide() {
    setError("");
    if (query.trim().length < 5) {
      setError("먼저 민원 내용을 입력해 주세요.");
      return;
    }
    if (selected.length === 0) {
      setError("유사 사례를 1건 이상 선택해 주세요.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/reply-draft/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complaintText: query, selectedReceiptNumbers: selected })
      });
      const body = (await res.json()) as { ok?: boolean; guide?: Guide; mode?: string; message?: string };
      if (!res.ok || !body.ok || !body.guide) {
        setError(body.message ?? "초안작성 가이드 생성에 실패했습니다.");
        setGenerating(false);
        return;
      }
      setGuide(body.guide);
      setModeText(body.mode === "ai" ? "AI 분석 기반 가이드" : "기본 템플릿 가이드");
      setGenerating(false);
    } catch {
      setError("네트워크 오류로 초안작성 가이드 생성에 실패했습니다.");
      setGenerating(false);
    }
  }

  function toggleReceipt(receiptNumber: string) {
    setSelected((prev) =>
      prev.includes(receiptNumber) ? prev.filter((n) => n !== receiptNumber) : [...prev, receiptNumber]
    );
  }

  async function openSourceWord(row: SearchRow) {
    setOpeningReceipt(row.receipt_number);
    setSourceOpenInfo("");
    try {
      const res = await fetch(`/api/reply-draft/source-file?receiptNumber=${encodeURIComponent(row.receipt_number)}`);
      const body = (await res.json()) as { ok?: boolean; url?: string; message?: string };
      if (res.ok && body.ok && body.url) {
        window.open(body.url, "_blank", "noopener,noreferrer");
      } else {
        setSourceOpenInfo(body.message ?? "원본 Word 파일 열기에 실패했습니다.");
      }
    } catch {
      setSourceOpenInfo("원본 Word 파일 열기 중 네트워크 오류가 발생했습니다.");
    } finally {
      setOpeningReceipt("");
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-slate-950">민원회신서 초안 작성</h3>
        <p className="mt-1 text-sm text-slate-500">민원 내용을 입력하면 등록된 Word 회신서에서 유사 사례를 찾아 가이드형 초안을 생성합니다.</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="text-lg font-bold text-slate-900">검색조건 입력</h4>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={5}
          placeholder="예) 계약 당시 상품 설명을 충분히 듣지 못했다는 민원 내용"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-800"
        />
        <div className="grid gap-3 md:grid-cols-2">
          <select
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
          >
            {PRODUCT_OPTIONS.map((o) => (
              <option key={o} value={o}>
                상품분류: {o}
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o} value={o}>
                카테고리: {o}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => void onSearch()}
          disabled={searching}
          className="w-full rounded-xl bg-slate-950 px-4 py-3 text-base font-bold text-white disabled:opacity-60"
        >
          {searching ? "유사사례 검색 중..." : "유사사례 검색"}
        </button>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-lg font-bold text-slate-900">검색결과</h4>
          <p className="text-xs text-slate-500">체크한 사례를 기준으로 초안작성 가이드를 생성합니다.</p>
        </div>
        {searchRows.length === 0 ? (
          <p className="text-sm text-slate-500">검색 결과가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {searchRows.map((row) => (
              <label
                key={row.id}
                className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(row.receipt_number)}
                      onChange={() => toggleReceipt(row.receipt_number)}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPreviewRow(row);
                        setSourceOpenInfo("");
                      }}
                      className="font-bold text-slate-900 underline-offset-2 hover:text-indigo-700 hover:underline"
                      title="클릭하면 해당 Word 추출 단락을 확인할 수 있습니다."
                    >
                      {row.receipt_number}
                    </button>
                    <p className="text-xs text-slate-500">{row.receipt_date}</p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-700">{row.summary}</p>
                </div>
                <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">유사도 {row.similarity}%</span>
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => void onGenerateGuide()}
          disabled={generating || selected.length === 0}
          className="w-full rounded-xl bg-indigo-700 px-4 py-3 text-base font-bold text-white disabled:opacity-60"
        >
          {generating ? "초안작성 가이드 생성 중..." : "초안작성 가이드 생성"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {guide ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-bold text-slate-900">가이드형 초안</h4>
            <span className="text-xs font-semibold text-indigo-700">{modeText}</span>
          </div>
          {SECTION_TITLES.map(([key, title]) => (
            <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h5 className="text-sm font-bold text-slate-900">{title}</h5>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{guide[key] || "-"}</p>
            </div>
          ))}
        </div>
      ) : null}

      {previewRow ? (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-bold text-slate-900">유사 사례 상세: {previewRow.receipt_number}</h4>
              <p className="mt-1 text-xs text-slate-500">
                원본 파일 저장소 연결 전 단계라, DB에 저장된 Word 추출 단락을 표시합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPreviewRow(null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              닫기
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openSourceWord(previewRow)}
              disabled={openingReceipt === previewRow.receipt_number}
              className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
            >
              {openingReceipt === previewRow.receipt_number ? "원본 Word 여는 중..." : "원본 Word 열기(선택)"}
            </button>
            {sourceOpenInfo ? <p className="text-xs text-amber-700">{sourceOpenInfo}</p> : null}
          </div>
          <div className="mt-4 space-y-3">
            <DetailBlock
              title="2. 민원인 주장 요지"
              text={previewRow.sections?.complainant_summary ?? ""}
            />
            <DetailBlock
              title="3. 동일 내용 민원 및 처리 내용"
              text={previewRow.sections?.similar_case_content ?? ""}
            />
            <DetailBlock
              title="4. 민원인의 주장/요구사항에 대한 당사 의견"
              text={previewRow.sections?.company_opinion ?? ""}
            />
            <DetailBlock
              title="5. 위규(법) 등 부당행위 및 조치"
              text={previewRow.sections?.violation_and_action ?? ""}
            />
            <DetailBlock
              title="6. 향후 처리방안"
              text={previewRow.sections?.future_action_plan ?? ""}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DetailBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h5 className="text-sm font-bold text-slate-900">{title}</h5>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
        {text.trim() ? text : "저장된 내용이 없습니다."}
      </p>
    </div>
  );
}
