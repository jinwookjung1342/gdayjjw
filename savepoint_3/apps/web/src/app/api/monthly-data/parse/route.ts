import { NextResponse } from "next/server";
import { normalizeReceiptDate } from "@/lib/receipt-date";

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
};

type SupabaseInsertResponse<T> = T[] | { message?: string; error?: string };
type AiLabel = { category: string; subcategory: string };

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

function classifyComplaintFallback(text: string): AiLabel {
  const t = text.replace(/\s+/g, " ").trim();
  const has = (k: string) => t.includes(k);
  if (has("계약") || has("부인")) return { category: "영업", subcategory: "계약사실상이(부인)" };
  if (has("차량인수") || (has("담보차량") && has("인수"))) return { category: "영업", subcategory: "담보차량인수부인" };
  if (has("결함") || has("하자")) return { category: "영업", subcategory: "담보차량 결함" };
  if (has("설명") || has("고지")) return { category: "영업", subcategory: "설명의무 위반" };
  if (has("불법영업")) return { category: "영업", subcategory: "불법영업" };
  if (has("독촉") || has("고압")) return { category: "채권", subcategory: "과다/고압 독촉" };
  if (has("가압류") && has("취하")) return { category: "채권", subcategory: "가압류 취하 미흡" };
  if (has("근저당") && (has("해지") || has("말소"))) return { category: "채권", subcategory: "근저당 해지 절차" };
  if (has("채권") && has("매각")) return { category: "채권", subcategory: "채권 매각 관련" };
  if (has("추심")) return { category: "채권", subcategory: "채권추심관련 금지행위" };
  if ((has("담당자") || has("상담")) && (has("고압") || has("불친절"))) return { category: "고객상담", subcategory: "담당자의 고압적 응대" };
  if (has("연락") && (has("안됨") || has("불가") || has("두절"))) return { category: "고객상담", subcategory: "연락불가" };
  if (has("결제") || has("수납")) return { category: "제도정책", subcategory: "결제(수납)관련" };
  if (has("개인정보") || has("유출")) return { category: "제도정책", subcategory: "개인정보유출의심" };
  if (has("중도상환") || has("해지수수료")) return { category: "제도정책", subcategory: "중도상환(해지)수수료 관련" };
  if (has("감가") || has("반납평가") || has("손해액")) return { category: "제도정책", subcategory: "차량 손해액관련(반납평가, 감가 관련)" };
  return { category: "기타", subcategory: t ? `기타-${t.slice(0, 24)}` : "기타" };
}

async function classifyComplaintWithAI(text: string): Promise<AiLabel> {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return { category: "기타", subcategory: "기타" };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return classifyComplaintFallback(normalized);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "민원 텍스트를 대분류/소분류로 분류한다. 반드시 JSON {\"category\":\"...\",\"subcategory\":\"...\"}. 안내된 분류표 외에 맞지 않으면 category는 '기타', subcategory는 자유 텍스트 1개."
          },
          {
            role: "user",
            content: JSON.stringify({
              taxonomy: CLASSIFICATION_GUIDE,
              complaint_content: normalized
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
    if (category && subcategory) return { category, subcategory };
  } catch {
    // Fallback used below
  }
  return classifyComplaintFallback(normalized);
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
        const complaintContent = String(excel["민원내용"] ?? ws.complainant_summary ?? "내용 미입력");
        const ai = scope === "대외" ? await classifyComplaintWithAI(complaintContent) : { category: "기타", subcategory: "기타" };
        aiLabelsByReceipt[row.receipt_number] = ai;
      })
  );

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
      parsed_result: { rows: parseData.excel_total }
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
      const complaintContent = String(excel["민원내용"] ?? ws.complainant_summary ?? "내용 미입력");
      const ai = aiLabelsByReceipt[row.receipt_number] ?? { category: "기타", subcategory: "기타" };
      aiLabelsByReceipt[row.receipt_number] = ai;
      return {
        receipt_number: row.receipt_number,
        receipt_date: toIsoDate(excel["접수일자"] ?? excel["접수일"]),
        receipt_channel_name: channelName || "기타",
        complaint_channel: channel,
        complaint_scope: scope,
        birth_date: excel["생년월일"] ? toIsoDate(excel["생년월일"]) : null,
        age_group: String(excel["연령대"] ?? "").trim() || null,
        complaint_type_major: String(excel["민원유형"] ?? ""),
        complaint_type_minor: String(excel["민원유형(소)"] ?? ""),
        business_unit_name: String(excel["업무"] ?? ""),
        sales_department_name: String(excel["영업부서명"] ?? ""),
        bond_department_name: String(excel["채권부서명"] ?? ""),
        complaint_content: complaintContent,
        ai_category: ai.category,
        ai_subcategory: ai.subcategory,
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

  const complaintRes = await fetch(`${supabaseUrl}/rest/v1/complaint_records?on_conflict=receipt_number`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(complaintRows)
  });
  const complaintJson = (await complaintRes.json()) as SupabaseInsertResponse<{ id: string }>;
  if (!complaintRes.ok || !Array.isArray(complaintJson)) {
    throw new Error("민원 데이터 저장에 실패했습니다.");
  }

  return {
    persisted: true,
    persisted_count: complaintJson.length,
    message: `${complaintJson.length}건 DB 저장 완료`,
    ai_labels_by_receipt: aiLabelsByReceipt
  };
}

export async function POST(request: Request) {
  const form = await request.formData();
  const excelFile = form.get("excelFile");
  const wordFiles = form.getAll("wordFiles");

  if (!(excelFile instanceof File)) {
    return NextResponse.json({ ok: false, message: "Excel 파일이 필요합니다." }, { status: 400 });
  }

  const docAiUrl = process.env.DOC_AI_API_BASE_URL ?? "http://localhost:8000";
  const forwardForm = new FormData();
  forwardForm.append("excel_file", excelFile, excelFile.name);
  wordFiles.forEach((file) => {
    if (file instanceof File) {
      forwardForm.append("word_files", file, file.name);
    }
  });

  const response = await fetch(`${docAiUrl}/parse/monthly-data`, {
    method: "POST",
    body: forwardForm
  });

  const rawBody = await response.text();
  let data: ParseResponse | { detail?: string };
  try {
    data = rawBody ? (JSON.parse(rawBody) as ParseResponse | { detail?: string }) : { detail: "빈 응답" };
  } catch {
    data = { detail: "JSON 파싱 실패" };
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: String((data as { detail?: string }).detail ?? "문서 파싱 중 오류가 발생했습니다.")
      },
      { status: response.status }
    );
  }

  const parseData = data as ParseResponse;
  try {
    const persistResult = await persistToSupabase(
      parseData,
      excelFile.name,
      wordFiles.filter((file): file is File => file instanceof File).map((file) => file.name)
    );
    return NextResponse.json({ ...parseData, ...persistResult });
  } catch (error) {
    return NextResponse.json({
      ...parseData,
      persisted: false,
      persisted_count: 0,
      message: error instanceof Error ? error.message : "DB 저장 중 오류가 발생했습니다."
    });
  }
}
