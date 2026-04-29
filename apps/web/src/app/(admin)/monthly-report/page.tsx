"use client";

import html2canvas from "html2canvas";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeReceiptDate } from "@/lib/receipt-date";
import { aggregateComplaintKeywords } from "@/lib/issue-keywords";
import { readMonthRollover } from "@/lib/month-rollup";
import { FSS_REPLY_SECTION_LABELS, getFsscParagraphTriple, pickFirstFsscSubstantiveCase } from "@/lib/fss-case-example";

const LOCAL_RECORDS_KEY = "jb_monthly_data_records";
const FSSC_EDIT_STORAGE_PREFIX = "jb_monthly_issues_fssc_edit_";
const MONTHLY_PPT_STORAGE_PREFIX = "jb_monthly_report_ppt_";

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

type KeywordItem = { word: string; count: number };

type StoredPpt = {
  name: string;
  mime: string;
  dataBase64: string;
  updated_at: string;
};

type FsscEditDraft = { source_receipt: string; paragraphs: [string, string, string]; updated_at: string };

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
  if (!fixed && row.created_at && row.created_at.length >= 7 && row.created_at.slice(0, 7) === month) return true;
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
    if (!o || !Array.isArray(o.paragraphs) || o.paragraphs.length !== 3) return null;
    return o;
  } catch {
    return null;
  }
}

function normalizeChannelShort(name: string): "금융감독원" | "소비자원" | "기타" {
  const n = (name ?? "").trim();
  if (n.includes("금융감독원") || n.includes("금감원")) return "금융감독원";
  if (n.includes("소비자")) return "소비자원";
  return "기타";
}

function readStoredPpt(month: string): StoredPpt | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(`${MONTHLY_PPT_STORAGE_PREFIX}${month}`);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as StoredPpt;
    if (!p?.name || !p?.dataBase64) return null;
    return p;
  } catch {
    return null;
  }
}

function writeStoredPpt(month: string, ppt: StoredPpt) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${MONTHLY_PPT_STORAGE_PREFIX}${month}`, JSON.stringify(ppt));
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const txt = String(r.result ?? "");
      const base64 = txt.includes(",") ? txt.split(",")[1] : txt;
      resolve(base64);
    };
    r.onerror = () => reject(new Error("파일 읽기 실패"));
    r.readAsDataURL(file);
  });
}

function downloadBase64(name: string, mime: string, b64: string) {
  const a = document.createElement("a");
  a.href = `data:${mime};base64,${b64}`;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export default function MonthlyReportPage() {
  const [month, setMonth] = useState("");
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState("");
  const [generating, setGenerating] = useState(false);
  const [exportingHtml, setExportingHtml] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const statsFrameRef = useRef<HTMLIFrameElement | null>(null);
  const issuesFrameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setMonth(defaultReportMonth());
    setReady(true);
  }, []);

  const allRows = useMemo(() => readLocalRows().filter((r) => rowInMonth(r, month)), [month]);
  const externalRows = useMemo(() => allRows.filter((r) => normScope(r.complaint_scope) === "대외"), [allRows]);

  const prevKey = useMemo(() => {
    if (month.length < 7) return "";
    const [y, m] = month.split("-").map(Number);
    return formatYearMonthLocal(new Date(y, m - 2, 1));
  }, [month]);

  const kpi = useMemo(() => {
    const roll = readMonthRollover();
    const curRoll = roll[month];
    const prevRoll = roll[prevKey];
    const total = curRoll?.total ?? allRows.length;
    const external = curRoll?.external ?? externalRows.length;
    const internal = curRoll?.internal ?? Math.max(total - external, 0);
    const prevTotal = prevRoll?.total ?? readLocalRows().filter((r) => rowInMonth(r, prevKey)).length;
    const diffRate = prevTotal > 0 ? Number((((total - prevTotal) / prevTotal) * 100).toFixed(1)) : 0;
    const ch = { 금융감독원: 0, 소비자원: 0, 기타: 0 };
    for (const row of externalRows) ch[normalizeChannelShort(row.receipt_channel_name)] += 1;
    return { total, external, internal, prevTotal, diffRate, ch };
  }, [month, prevKey, allRows.length, externalRows]);

  const keywords = useMemo(() => aggregateComplaintKeywords(externalRows).slice(0, 10), [externalRows]);

  const fssCase = useMemo(() => pickFirstFsscSubstantiveCase(externalRows, month, rowInMonth), [externalRows, month]);
  const fssTriple = useMemo(() => {
    if (!fssCase) return ["", "", ""] as [string, string, string];
    const auto = getFsscParagraphTriple(fssCase.word_sections);
    const draft = loadFsscDraft(month);
    if (draft && draft.source_receipt === (fssCase.receipt_number ?? "")) return draft.paragraphs;
    return auto;
  }, [fssCase, month]);

  const topTypeLabels = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of externalRows) {
      const key = (row.ai_subcategory ?? row.ai_category ?? row.complaint_type_minor ?? "기타").trim() || "기타";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([label, count]) => `${label}(${count})`);
  }, [externalRows]);

  const aiSourceText = useMemo(() => {
    const lines: string[] = [];
    lines.push(`[월보 원문 데이터] ${month}`);
    lines.push(`- 전체민원: ${kpi.total}건 / 대외: ${kpi.external}건 / 대내: ${kpi.internal}건`);
    lines.push(`- 전월(${prevKey}) 대비 증감률: ${kpi.diffRate >= 0 ? "+" : ""}${kpi.diffRate}%`);
    lines.push(`- 대외 접수경로: 금융감독원 ${kpi.ch.금융감독원}건, 한국소비자원 ${kpi.ch.소비자원}건, 기타 ${kpi.ch.기타}건`);
    lines.push(`- 대외 민원 키워드(빈도): ${keywords.map((k) => `#${k.word}(${k.count})`).join(", ") || "없음"}`);
    lines.push(`- 대외 민원 유형 상위: ${topTypeLabels.join(", ") || "없음"}`);
    if (fssCase) {
      lines.push(`- 금감원 회신 주요 사례 접수번호: ${fssCase.receipt_number ?? "-"}`);
      for (let i = 0; i < FSS_REPLY_SECTION_LABELS.length; i += 1) {
        const title = FSS_REPLY_SECTION_LABELS[i][1];
        lines.push(`[${title}]`);
        lines.push(fssTriple[i] || "없음");
      }
    } else {
      lines.push("- 금감원 회신 주요 사례: 해당 없음");
    }
    lines.push("");
    lines.push("[요청]");
    lines.push("위 원문을 최대한 유지하고, 과장 없이 월보 보고용 PPT를 6~8장으로 구성해 주세요.");
    lines.push("슬라이드마다 제목/핵심 메시지/근거 수치/원문 인용(필요 시) 형식으로 작성해 주세요.");
    return lines.join("\n");
  }, [month, kpi, prevKey, keywords, topTypeLabels, fssCase, fssTriple]);

  const storedPpt = useMemo(() => (month.length >= 7 ? readStoredPpt(month) : null), [month, flash]);

  const statsUrl = month.length >= 7 ? `/embed/statistics?month=${month}` : "/embed/statistics";
  const issuesUrl = month.length >= 7 ? `/embed/monthly-issues?month=${month}` : "/embed/monthly-issues";

  async function handleCopyAiText() {
    await navigator.clipboard.writeText(aiSourceText);
    setFlash("원문이 복사되었습니다.");
    window.setTimeout(() => setFlash(""), 1800);
  }

  async function handleUploadPpt(file: File | null) {
    if (!file) return;
    const b64 = await toBase64(file);
    writeStoredPpt(month, {
      name: file.name,
      mime: file.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      dataBase64: b64,
      updated_at: new Date().toISOString(),
    });
    setFlash("PPT가 저장되었습니다.");
    window.setTimeout(() => setFlash(""), 1800);
  }

  async function captureIframeAsPngChunks(frame: HTMLIFrameElement | null, maxSlides = 4): Promise<string[]> {
    if (!frame?.contentDocument) {
      throw new Error("미리보기 iframe이 아직 로드되지 않았습니다.");
    }
    const doc = frame.contentDocument;
    const target = doc.documentElement as HTMLElement;
    const canvas = await html2canvas(target, {
      useCORS: true,
      scale: 1,
      backgroundColor: "#ffffff",
      windowWidth: Math.max(target.scrollWidth, 1280),
      windowHeight: Math.max(target.scrollHeight, 720),
    });
    const chunks: string[] = [];
    const pieceCount = Math.max(1, Math.min(maxSlides, Math.ceil(canvas.height / 1100)));
    const pieceHeight = Math.ceil(canvas.height / pieceCount);
    for (let i = 0; i < pieceCount; i += 1) {
      const y = i * pieceHeight;
      const h = Math.min(pieceHeight, canvas.height - y);
      const sub = document.createElement("canvas");
      sub.width = canvas.width;
      sub.height = h;
      const ctx = sub.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      chunks.push(sub.toDataURL("image/png"));
    }
    return chunks;
  }

  async function handleGenerateAndStorePpt() {
    setGenerating(true);
    try {
      const statsImages = await captureIframeAsPngChunks(statsFrameRef.current, 4);
      const issuesImages = await captureIframeAsPngChunks(issuesFrameRef.current, 2);

      const response = await fetch("/api/monthly-report/ppt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          statsImages,
          issuesImages,
          keywords: keywords as KeywordItem[],
          fssCase: fssCase
            ? {
                receiptNumber: fssCase.receipt_number ?? "",
                channel: fssCase.receipt_channel_name ?? "",
                paragraphs: fssTriple,
              }
            : null,
          summary: {
            total: kpi.total,
            external: kpi.external,
            internal: kpi.internal,
            prevKey,
            diffRate: kpi.diffRate,
            channels: kpi.ch,
            keywords: keywords.map((k) => `#${k.word}(${k.count})`),
            topTypes: topTypeLabels,
          },
        }),
      });
      if (!response.ok) throw new Error("PPT 생성 API 호출 실패");
      const body = (await response.json()) as { ok: boolean; fileName: string; base64: string; mime: string };
      if (!body.ok || !body.base64) throw new Error("PPT 생성 응답이 올바르지 않습니다.");

      writeStoredPpt(month, {
        name: body.fileName || `${month}-월보발송.pptx`,
        mime: body.mime || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        dataBase64: body.base64,
        updated_at: new Date().toISOString(),
      });
      setFlash("화면 스냅샷 기반 PPT가 생성되어 저장되었습니다.");
      window.setTimeout(() => setFlash(""), 2000);
    } catch {
      setFlash("PPT 생성에 실패했습니다. 미리보기 로딩 후 다시 시도하세요.");
      window.setTimeout(() => setFlash(""), 2500);
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadOfflineHtml() {
    setExportingHtml(true);
    try {
      const [statsImages, issuesImages] = await Promise.all([
        captureIframeAsPngChunks(statsFrameRef.current, 4),
        captureIframeAsPngChunks(issuesFrameRef.current, 2),
      ]);
      const keywordRows = keywords.map((k) => `<li>#${escapeHtml(k.word)} (${k.count})</li>`).join("");
      const fssBlocks = FSS_REPLY_SECTION_LABELS.map(
        ([, title], i) => `
        <section class="card">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml((fssTriple[i] || "—").replace(/\n/g, " "))}</p>
        </section>`
      ).join("");
      const imagesHtml = [...statsImages, ...issuesImages]
        .map((src, i) => `<img src="${src}" alt="월보 이미지 ${i + 1}" class="shot" />`)
        .join("");
      const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${month} 월보 오프라인 보고서</title>
      <style>
      body{font-family:Arial,'Malgun Gothic',sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px}
      .wrap{max-width:1200px;margin:0 auto}.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;margin-bottom:14px}
      .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.kpi .card b{font-size:24px}
      h1{margin:0 0 4px 0}.muted{color:#64748b;font-size:13px}.shot{width:100%;border:1px solid #e2e8f0;border-radius:10px;margin:10px 0}
      ul{margin:8px 0 0 16px} li{line-height:1.5}
      </style></head><body><div class="wrap">
      <h1>${month} 월보 오프라인 보고서</h1><p class="muted">인터넷 연결 없이 열람 가능한 단일 HTML</p>
      <section class="kpi">
        <div class="card"><div class="muted">전체민원</div><b>${kpi.total}건</b></div>
        <div class="card"><div class="muted">대외민원</div><b>${kpi.external}건</b></div>
        <div class="card"><div class="muted">대내민원</div><b>${kpi.internal}건</b></div>
        <div class="card"><div class="muted">전월 대비</div><b>${kpi.diffRate >= 0 ? "+" : ""}${kpi.diffRate}%</b></div>
      </section>
      <section class="card"><h2>민원내용 키워드 (빈도)</h2><ul>${keywordRows || "<li>없음</li>"}</ul></section>
      ${fssBlocks}
      <section class="card"><h2>민원통계/이달의 민원 캡처</h2>${imagesHtml}</section>
      </div></body></html>`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      downloadBlob(`${month}-월보-오프라인.html`, blob);
      setFlash("오프라인 HTML이 다운로드되었습니다.");
      window.setTimeout(() => setFlash(""), 1800);
    } catch {
      setFlash("오프라인 HTML 생성에 실패했습니다.");
      window.setTimeout(() => setFlash(""), 2200);
    } finally {
      setExportingHtml(false);
    }
  }

  async function handleDownloadPdf() {
    setExportingPdf(true);
    try {
      const [{ jsPDF }, statsImages, issuesImages] = await Promise.all([
        import("jspdf"),
        captureIframeAsPngChunks(statsFrameRef.current, 4),
        captureIframeAsPngChunks(issuesFrameRef.current, 2),
      ]);
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = 297;
      const pageH = 210;
      const addTitle = (title: string) => {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(14);
        pdf.text(title, 10, 10);
      };
      addTitle(`${month} 민원통계`);
      const shots = [...statsImages, ...issuesImages];
      shots.forEach((img, i) => {
        if (i > 0) pdf.addPage("a4", "landscape");
        addTitle(i < statsImages.length ? `${month} 민원통계 (${i + 1}/${statsImages.length})` : `${month} 이달의 민원`);
        pdf.addImage(img, "PNG", 8, 16, pageW - 16, pageH - 24, undefined, "FAST");
      });
      pdf.addPage("a4", "landscape");
      addTitle(`${month} 민원내용 키워드/주요사례`);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.text(`키워드: ${keywords.map((k) => `#${k.word}(${k.count})`).join(", ") || "없음"}`, 10, 22, { maxWidth: 275 });
      let y = 34;
      FSS_REPLY_SECTION_LABELS.forEach(([, title], idx) => {
        pdf.setFont("helvetica", "bold");
        pdf.text(title, 10, y);
        y += 6;
        pdf.setFont("helvetica", "normal");
        const txt = (fssTriple[idx] || "—").replace(/\n/g, " ");
        const lines = pdf.splitTextToSize(txt, 275) as string[];
        const use = lines.slice(0, 14);
        pdf.text(use, 10, y);
        y += use.length * 5 + 4;
      });
      pdf.save(`${month}-월보-오프라인.pdf`);
      setFlash("PDF가 다운로드되었습니다.");
      window.setTimeout(() => setFlash(""), 1800);
    } catch {
      setFlash("PDF 생성에 실패했습니다.");
      window.setTimeout(() => setFlash(""), 2200);
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-2xl font-bold text-slate-950">월보발송</h3>
          <p className="mt-1 text-sm text-slate-500">민원통계 + 이달의 민원 통합 미리보기 및 외부 AI PPT 제작</p>
        </div>
        <label className="flex flex-col text-xs font-medium text-slate-600">
          <span className="mb-1">기준 월</span>
          {ready ? (
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm"
            />
          ) : (
            <div className="h-10 w-44 animate-pulse rounded-xl bg-slate-100" />
          )}
        </label>
      </div>

      {flash ? <p className="text-sm font-semibold text-emerald-700">{flash}</p> : null}

      <div className="grid grid-cols-4 gap-4">
        <StatCard title="전체민원" value={`${kpi.total}건`} />
        <StatCard title="대외민원" value={`${kpi.external}건`} />
        <StatCard title="대내민원" value={`${kpi.internal}건`} />
        <StatCard title="전월 대비" value={`${kpi.diffRate >= 0 ? "+" : ""}${kpi.diffRate}%`} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h4 className="text-sm font-bold text-slate-900">월보 통합 미리보기</h4>
        <p className="mt-2 text-xs text-slate-500">민원통계 / 이달의 민원 화면을 원본 스타일 그대로 임베드합니다.</p>
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
            <p className="mb-2 text-xs font-bold text-slate-600">민원통계</p>
            <iframe ref={statsFrameRef} src={statsUrl} className="h-[760px] w-full rounded-lg bg-white" />
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
            <p className="mb-2 text-xs font-bold text-slate-600">이달의 민원</p>
            <iframe ref={issuesFrameRef} src={issuesUrl} className="h-[980px] w-full rounded-lg bg-white" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h4 className="text-sm font-bold text-slate-900">금감원 회신 주요 사례</h4>
        {!fssCase ? (
          <p className="mt-3 text-sm text-slate-500">해당 월에 조건을 만족하는 사례가 없습니다.</p>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-xs font-semibold text-slate-500">
              접수번호 {fssCase.receipt_number ?? "-"} · {fssCase.receipt_channel_name}
            </p>
            {FSS_REPLY_SECTION_LABELS.map(([sid, title], idx) => (
              <div key={sid} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                <p className="text-[15px] font-extrabold text-slate-900">{title}</p>
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">{fssTriple[idx] || "—"}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h4 className="text-sm font-bold text-slate-900">외부 AI PPT 제작</h4>
        <p className="mt-2 text-xs text-slate-500">
          자동 생성 시 민원통계는 3~4장으로 분할, 키워드 1장, 금감원 회신 주요 사례 1~2장으로 제작합니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleGenerateAndStorePpt}
            disabled={generating}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-slate-900"
          >
            {generating ? "PPT 생성 중..." : "PPT 자동 생성"}
          </button>
          <button
            type="button"
            onClick={handleCopyAiText}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            원문 복사
          </button>
        </div>
        <textarea
          value={aiSourceText}
          readOnly
          rows={12}
          className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h4 className="text-sm font-bold text-slate-900">PPT 업로드 / 다운로드</h4>
        <p className="mt-2 text-xs text-slate-500">제작 버튼으로 PPT를 만든 뒤 바로 다운로드하거나, 외부 파일을 업로드해 월별 저장할 수 있습니다.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleGenerateAndStorePpt}
            disabled={generating}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating ? "PPT 제작 중..." : "PPT 제작"}
          </button>
          <label className="inline-flex cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            PPT 업로드
            <input
              type="file"
              accept=".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="hidden"
              onChange={(e) => void handleUploadPpt(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            disabled={!storedPpt}
            onClick={() => storedPpt && downloadBase64(storedPpt.name, storedPpt.mime, storedPpt.dataBase64)}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            PPT 다운로드
          </button>
          <span className="text-xs text-slate-500">
            {storedPpt ? `저장 파일: ${storedPpt.name}` : "저장된 PPT 없음"}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <h4 className="text-sm font-bold text-slate-900">오프라인 공유 파일</h4>
        <p className="mt-2 text-xs text-slate-500">인터넷 없는 망에서도 열 수 있도록 HTML / PDF 파일을 바로 생성합니다.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleDownloadOfflineHtml}
            disabled={exportingHtml}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exportingHtml ? "HTML 생성 중..." : "오프라인 HTML 다운로드"}
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={exportingPdf}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exportingPdf ? "PDF 생성 중..." : "PDF 다운로드"}
          </button>
        </div>
      </div>
    </section>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
    </div>
  );
}
