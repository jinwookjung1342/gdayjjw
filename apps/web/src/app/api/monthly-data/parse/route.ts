import { NextResponse } from "next/server";
import { normalizeSupabaseOrigin } from "@/lib/supabase-env";

/** Vercel 등에서 doc-ai 호출이 길어질 때 기본 10초 제한을 피하기 위함(플랜별 상한 있음). */
export const maxDuration = 60;
import { normalizeReceiptDate } from "@/lib/receipt-date";
import {
  aiLabelFromMinorStrict,
  classifyLabelFromComplaintBodyOnly,
  fallbackComplaintAiLabel
} from "@/lib/complaint-label-fallback";

type ParsePreviewRow = {
  receipt_number: string;
  excel_row: Record<string, unknown>;
  word_file_name: string;
  word_sections: Record<string, string>;
};

type UnifiedRecord = {
  receipt_number: string;
  excel_row: Record<string, unknown>;
  complaint_scope: string;
  word_file_name: string | null;
  word_sections: Record<string, string>;
  word_matched?: boolean;
};

type ParseResponse = {
  ok: boolean;
  excel_total: number;
  word_total: number;
  matched_total: number;
  external_total?: number;
  internal_total?: number;
  external_with_word_total?: number;
  unmatched_word_files: string[];
  preview_rows: ParsePreviewRow[];
  unified_records?: UnifiedRecord[];
  excel_columns: string[];
  date_column?: string | null;
  month_rollup?: Record<string, { total: number; external: number; internal: number }>;
  month_age_rollup?: Record<string, Record<string, number>>;
};

type SupabaseInsertResponse<T> = T[] | { message?: string; error?: string };
type AiLabel = { category: string; subcategory: string };

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

function toIsoDate(value: unknown): string {
  const n = normalizeReceiptDate(value);
  if (n) return n;
  return new Date().toISOString().slice(0, 10);
}

function routeLabel(excel: Record<string, unknown>): string {
  return String(
    excel["접수경로구분명"] ?? excel["접수경로분류명"] ?? excel["접수경로"] ?? "기타"
  );
}

function normalizeChannel(raw: unknown): "금융감독원" | "한국소비자보호원" | "기타" {
  const value = String(raw ?? "").trim();
  if (value.includes("금융감독원") || value.includes("금감원")) return "금융감독원";
  if (
    value.includes("한국소비자보호원") ||
    value.includes("한국소비자원") ||
    value.includes("소비자보호원") ||
    value.includes("소비자원")
  ) {
    return "한국소비자보호원";
  }
  return "기타";
}

function normalizeBoolean(raw: unknown): boolean | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (["Y", "YES", "TRUE", "예", "해당", "1"].includes(value.toUpperCase())) return true;
  if (["N", "NO", "FALSE", "아니오", "없음", "0"].includes(value.toUpperCase())) return false;
  return null;
}

const CLASSIFICATION_GUIDE = [
  { category: "영업", subcategories: ["계약사실상이(부인)", "담보차량인수부인", "담보차량 결함", "설명의무 위반", "불법영업", "기타 판매과정 불만"] },
  { category: "채권", subcategories: ["과다/고압 독촉", "가압류 취하 미흡", "근저당 해지 절차", "채권 매각 관련", "채권추심관련 금지행위"] },
  { category: "고객상담", subcategories: ["담당자의 고압적 응대", "연락불가"] },
  { category: "제도정책", subcategories: ["결제(수납)관련", "개인정보유출의심", "중도상환(해지)수수료 관련", "차량 손해액관련(반납평가, 감가 관련)"] },
  { category: "기타", subcategories: ["기타"] }
] as const;

const GENERIC_AI_PAIRS = [
  ["영업", "기타 판매과정 불만"],
  ["채권", "과다/고압 독촉"],
  ["제도정책", "결제(수납)관련"]
] as const;

const AI_CATEGORY_DB = new Set(["영업", "채권", "고객상담", "제도정책", "기타"]);

function sanitizeAiCategoryForDb(category: string): "영업" | "채권" | "고객상담" | "제도정책" | "기타" {
  const t = String(category ?? "").trim();
  if (AI_CATEGORY_DB.has(t)) return t as "영업" | "채권" | "고객상담" | "제도정책" | "기타";
  return "기타";
}

function truncStr(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function dedupeByReceiptNumber<T extends { receipt_number: string }>(rows: T[]): { rows: T[]; dropped: number } {
  const byReceipt = new Map<string, T>();
  for (const row of rows) {
    // 동일 접수번호가 여러 번 들어오면 마지막 행으로 정규화(Upsert 1회 보장)
    byReceipt.set(row.receipt_number, row);
  }
  return { rows: Array.from(byReceipt.values()), dropped: rows.length - byReceipt.size };
}

async function classifyComplaintWithAI(text: string, minorHint?: string): Promise<AiLabel> {
  const normalized = text.replace(/\s+/g, " ").trim();
  const hint = (minorHint ?? "").trim();
  if (!normalized) return fallbackComplaintAiLabel("", hint);

  const systemPrompt =
    "민원을 taxonomy의 대분류(category)·소분류(subcategory)로 분류한다. JSON만 {\"category\":\"...\",\"subcategory\":\"...\"}.\n" +
    "민원내용 우선으로 문맥에 맞게 가장 구체적인 소분류 하나를 선택한다.\n" +
    "영업·채권·제도정책 대분류를 택했다면 해당 대분류의 subcategories 중 반드시 표에 들어있는 문자열 하나를 소분류에 사용한다.\n" +
    "같은 대분류의 모든 건을 한두 개 소분류로 몰아넣지 말고 표기된 여러 세부항목 중 민원 요지와 가까운 것으로 나눈다.\n" +
    "예: 채권은 독촉·매각·가압류·근저당·추심금지 등으로, 영업은 계약·차량결함·설명의무 등으로 구분 우선이다.\n" +
    "`기타 판매과정 불만`, `과다/고압 독촉`, `결제(수납)관련`은 다른 소분류에 더 들어맞을 때 선택하지 않는다.\n" +
    "민원유형(소) hint는 참고만(약 20%) 한다. 문자열 빈 채 다른 소분류로 충분하면 hint를 따라 전부 같은 라벨로 넣지 않는다.";

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackComplaintAiLabel(normalized, hint);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.05,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              taxonomy: CLASSIFICATION_GUIDE,
              complaint_content: normalized,
              complaint_type_minor_hint: hint
            })
          }
        ]
      })
    });
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = raw ? (JSON.parse(raw) as { category?: string; subcategory?: string }) : {};
    const category = (parsed.category ?? "").trim();
    const subcategory = (parsed.subcategory ?? "").trim();
    if (category && subcategory) {
      const fromBody = classifyLabelFromComplaintBodyOnly(normalized);
      const aiIsGeneric = GENERIC_AI_PAIRS.some(([c, s]) => c === category && s === subcategory);
      if (fromBody && aiIsGeneric && (fromBody.category !== category || fromBody.subcategory !== subcategory)) {
        return fromBody;
      }
      const byMinorStrict = aiLabelFromMinorStrict(hint);
      if (byMinorStrict && (category === "기타" || subcategory.startsWith("기타-"))) return byMinorStrict;
      return { category, subcategory };
    }
  } catch {
    // Fallback used below
  }
  return fallbackComplaintAiLabel(normalized, hint);
}

async function persistToSupabase(parseData: ParseResponse, excelFileName: string, wordFileNames: string[]) {
  const unified = parseData.unified_records ?? [];
  const aiLabelsByReceipt: Record<string, AiLabel> = {};
  await Promise.all(
    unified
      .filter((row) => row.receipt_number)
      .map(async (row) => {
        const excel = row.excel_row ?? {};
        const scope = row.complaint_scope === "대외" ? "대외" : "대내";
        const ws = row.word_sections ?? {};
        const complaintContent = excelText(excel, ["민원내용", "민원 내용"], ws.complainant_summary ?? "내용 미입력");
        const minorHint = excelText(excel, ["민원유형(소)", "민원유형소", "민원유형 소", "민원유형_소"], "");
        const ai = scope === "대외" ? await classifyComplaintWithAI(complaintContent, minorHint) : { category: "기타", subcategory: "기타" };
        aiLabelsByReceipt[row.receipt_number] = ai;
      })
  );

  try {
  const supabaseUrl = normalizeSupabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      persisted: false,
      persisted_count: 0,
      message: "Supabase 환경변수가 없어 DB 저장은 건너뛰었습니다.",
      ai_labels_by_receipt: aiLabelsByReceipt
    };
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };

  const monthKey = new Date().toISOString().slice(0, 7);
  const batchRes = await fetch(`${supabaseUrl}/rest/v1/complaint_upload_batches`, {
    method: "POST",
    headers,
    body: JSON.stringify([{ month_key: monthKey, memo: `Excel:${excelFileName}` }])
  });
  const batchJson = (await batchRes.json()) as SupabaseInsertResponse<{ id: string }>;
  if (!batchRes.ok || !Array.isArray(batchJson) || !batchJson[0]?.id) {
    throw new Error("업로드 배치 저장에 실패했습니다.");
  }
  const uploadBatchId = batchJson[0].id;

  const sourcePayload = [
    {
      upload_batch_id: uploadBatchId,
      file_type: "excel",
      file_name: excelFileName,
      storage_path: `local/${excelFileName}`,
      parsed_status: "parsed",
      parsed_result: {
        rows: parseData.excel_total,
        month_rollup: parseData.month_rollup ?? {},
        month_age_rollup: parseData.month_age_rollup ?? {}
      }
    },
    ...wordFileNames.map((name) => ({
      upload_batch_id: uploadBatchId,
      file_type: "word",
      file_name: name,
      storage_path: `local/${name}`,
      parsed_status: "parsed",
      parsed_result: {}
    }))
  ];
  await fetch(`${supabaseUrl}/rest/v1/source_files`, {
    method: "POST",
    headers,
    body: JSON.stringify(sourcePayload)
  });

  const complaintRows = await Promise.all(unified.filter((row) => row.receipt_number).map(async (row) => {
      const excel = row.excel_row ?? {};
      const channelName = routeLabel(excel);
      const scope = row.complaint_scope === "대외" ? "대외" : "대내";
      const channel = scope === "대외" ? normalizeChannel(channelName) : "기타";
      const ws = row.word_sections ?? {};
      const complaintContent = excelText(excel, ["민원내용", "민원 내용"], ws.complainant_summary ?? "내용 미입력");
      const ai = aiLabelsByReceipt[row.receipt_number] ?? { category: "기타", subcategory: "기타" };
      aiLabelsByReceipt[row.receipt_number] = ai;
      const complaintTypeMinor = excelText(excel, ["민원유형(소)", "민원유형소", "민원유형 소", "민원유형_소"], "");
      const complaintTypeMajor = excelText(excel, ["민원유형", "민원 유형"], "");
      return {
        receipt_number: String(row.receipt_number).trim(),
        receipt_date: toIsoDate(excel["접수일자"] ?? excel["접수일"]),
        receipt_channel_name: truncStr(channelName || "기타", 100),
        complaint_channel: channel,
        complaint_scope: scope,
        birth_date: excel["생년월일"] ? toIsoDate(excel["생년월일"]) : null,
        age_group: truncStr(String(excel["연령대"] ?? "").trim(), 40) || null,
        complaint_type_major: truncStr(complaintTypeMajor, 100),
        complaint_type_minor: truncStr(complaintTypeMinor, 100),
        business_unit_name: truncStr(String(excel["업무"] ?? ""), 120),
        sales_department_name: truncStr(String(excel["영업부서명"] ?? ""), 120),
        bond_department_name: truncStr(String(excel["채권부서명"] ?? ""), 120),
        complaint_content: complaintContent,
        ai_category: sanitizeAiCategoryForDb(ai.category),
        ai_subcategory: truncStr(ai.subcategory, 100),
        complainant_summary: ws.complainant_summary ?? null,
        similar_case_content: ws.similar_case_content ?? null,
        company_opinion: ws.company_opinion ?? null,
        violation_and_action: ws.violation_and_action ?? null,
        future_action_plan: ws.future_action_plan ?? null,
        is_third_party: normalizeBoolean(ws.is_third_party),
        updated_at: new Date().toISOString()
      };
    }));

  if (complaintRows.length === 0) {
    return {
      persisted: true,
      persisted_count: 0,
      message: "저장 가능한 접수번호가 없어 DB 저장 건수는 0건입니다.",
      ai_labels_by_receipt: aiLabelsByReceipt
    };
  }

  const deduped = dedupeByReceiptNumber(complaintRows);
  const rowsToSave = deduped.rows;

  const tooLongReceipt = rowsToSave.find((r) => r.receipt_number.length > 32);
  if (tooLongReceipt) {
    throw new Error(
      `접수번호가 DB 허용 길이(32자)를 초과했습니다: "${tooLongReceipt.receipt_number.slice(0, 48)}…" (${tooLongReceipt.receipt_number.length}자). 필요하면 Supabase에서 receipt_number 컬럼 길이를 늘리세요.`
    );
  }

  /** PostgREST 대량 단일 요청 한도 피함 + 오류 메시지에 code/message 포함 */
  const chunkSize = 200;
  let persistedCount = 0;
  for (let offset = 0; offset < rowsToSave.length; offset += chunkSize) {
    const chunk = rowsToSave.slice(offset, offset + chunkSize);
    const complaintRes = await fetch(`${supabaseUrl}/rest/v1/complaint_records?on_conflict=receipt_number`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(chunk)
    });
    const rawText = await complaintRes.text();
    let complaintParsed: unknown;
    try {
      complaintParsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      throw new Error(
        `민원 데이터 저장 응답 파싱 실패 (행 ${offset + 1}~${offset + chunk.length}): ${rawText.slice(0, 500)}`
      );
    }
    if (!complaintRes.ok || !Array.isArray(complaintParsed)) {
      const supaDetail =
        complaintParsed !== null &&
        typeof complaintParsed === "object" &&
        ("message" in complaintParsed || "hint" in complaintParsed || "details" in complaintParsed)
          ? JSON.stringify(complaintParsed)
          : rawText.slice(0, 1200);
      throw new Error(`민원 데이터 저장에 실패했습니다 (행 ${offset + 1}~${offset + chunk.length} 묶음). ${supaDetail}`);
    }
    persistedCount += complaintParsed.length;
  }

  return {
    persisted: true,
    persisted_count: persistedCount,
    message:
      deduped.dropped > 0
        ? `${persistedCount}건 DB 저장 완료 (중복 접수번호 ${deduped.dropped}건은 마지막 행 기준으로 정규화)`
        : `${persistedCount}건 DB 저장 완료`,
    ai_labels_by_receipt: aiLabelsByReceipt
  };
  } catch (error) {
    return {
      persisted: false,
      persisted_count: 0,
      message: error instanceof Error ? error.message : "DB 저장 중 오류가 발생했습니다.",
      ai_labels_by_receipt: aiLabelsByReceipt
    };
  }
}

function normalizeDocAiBase(raw: string | undefined): string {
  const trimmed = (raw ?? "").replace(/^\uFEFF/, "").trim();
  return trimmed || "http://localhost:8000";
}

/** DOC_AI_API_BASE_URL 이 호스트만 오거나, 실수로 전체 경로까지 적힌 경우 모두 처리 */
function resolveDocAiParseUrl(base: string): string | null {
  const b = base.trim().replace(/\/+$/, "");
  if (!b) return null;
  if (/\/parse\/monthly-data$/i.test(b)) return b;
  return `${b}/parse/monthly-data`;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const excelFile = form.get("excelFile");
    const wordFiles = form.getAll("wordFiles");

    if (!(excelFile instanceof File)) {
      return NextResponse.json({ ok: false, message: "Excel 파일이 필요합니다." }, { status: 400 });
    }

    const docAiUrl = normalizeDocAiBase(process.env.DOC_AI_API_BASE_URL);
    const isProd = process.env.NODE_ENV === "production";
    const isLocalDocAi = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(docAiUrl);
    if (isProd && isLocalDocAi) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "DOC_AI_API_BASE_URL이 로컬(localhost)로 설정되어 있습니다. 배포 환경에서는 외부 접근 가능한 doc-ai URL(예: Render)을 설정해야 합니다."
        },
        { status: 500 }
      );
    }

    const parseUrlString = resolveDocAiParseUrl(docAiUrl);
    if (!parseUrlString) {
      return NextResponse.json(
        { ok: false, message: "DOC_AI_API_BASE_URL이 비어 있습니다." },
        { status: 500 }
      );
    }

    let docAiParsed: URL;
    try {
      docAiParsed = new URL(parseUrlString);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          message:
            "DOC_AI_API_BASE_URL이 올바른 URL이 아닙니다. 예: https://your-service.onrender.com (끝에 /parse 붙이지 말 것)"
        },
        { status: 500 }
      );
    }
    if (!/^https?:$/i.test(docAiParsed.protocol)) {
      return NextResponse.json(
        { ok: false, message: "DOC_AI_API_BASE_URL은 http 또는 https 로 시작해야 합니다." },
        { status: 500 }
      );
    }

    const forwardForm = new FormData();
    forwardForm.append("excel_file", excelFile, excelFile.name);
    wordFiles.forEach((file) => {
      if (file instanceof File) {
        forwardForm.append("word_files", file, file.name);
      }
    });

    const response = await fetch(docAiParsed.toString(), {
      method: "POST",
      body: forwardForm
    });

    const rawBody = await response.text();
    let data: ParseResponse | { detail?: string };
    try {
      data = rawBody ? (JSON.parse(rawBody) as ParseResponse | { detail?: string }) : { detail: "빈 응답" };
    } catch {
      const snippet = rawBody.slice(0, 280).replace(/\s+/g, " ");
      return NextResponse.json(
        {
          ok: false,
          message: docAiUpstreamLooksHtml(snippet)
            ? "doc-ai가 HTML을 반환했습니다(Render 슬립/502·잘못된 URL·경로). DOC_AI_API_BASE_URL과 Render 로그를 확인하세요."
            : `doc-ai 응답이 JSON이 아닙니다. (${snippet.slice(0, 120)}…)`,
          excel_total: 0,
          word_total: 0,
          matched_total: 0,
          unmatched_word_files: [],
          preview_rows: [],
          excel_columns: []
        },
        { status: 502 }
      );
    }

    if (!response.ok) {
      const detail = String((data as { detail?: string }).detail ?? "문서 파싱 중 오류가 발생했습니다.");
      const is404 = response.status === 404 || detail === "Not Found";
      const hint = is404
        ? ` (시도한 URL: ${docAiParsed.toString()} — Vercel의 DOC_AI_API_BASE_URL은 https://서비스.onrender.com 처럼 호스트만; /parse 를 붙이지 마세요.)`
        : "";
      return NextResponse.json(
        { ok: false, message: detail + hint },
        { status: response.status >= 400 && response.status < 600 ? response.status : 502 }
      );
    }

    const parseData = data as ParseResponse;
    const persistResult = await persistToSupabase(
      parseData,
      excelFile.name,
      wordFiles.filter((file): file is File => file instanceof File).map((file) => file.name)
    );
    return NextResponse.json({ ...parseData, ...persistResult });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        message: `파싱 API 오류: ${msg}. doc-ai(Render) 가동·방화벽·DOC_AI_API_BASE_URL 을 확인하세요.`
      },
      { status: 500 }
    );
  }
}

function docAiUpstreamLooksHtml(snippet: string): boolean {
  return /<\s*html[\s>]/i.test(snippet) || /<\s*!doctype\s+html/i.test(snippet);
}
