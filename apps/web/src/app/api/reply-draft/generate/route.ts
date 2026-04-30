import { NextRequest, NextResponse } from "next/server";
import { normalizeSupabaseOrigin } from "@/lib/supabase-env";

type ComplaintRow = {
  receipt_number: string;
  receipt_date: string;
  complaint_content: string;
  complaint_type_major?: string | null;
  ai_category?: string | null;
  is_third_party?: boolean | null;
  litigation_related?: string | null;
  urgent_processing_required?: boolean | null;
  complainant_summary?: string | null;
  similar_case_content?: string | null;
  company_opinion?: string | null;
  violation_and_action?: string | null;
  future_action_plan?: string | null;
};

function getSupabaseConfig() {
  const supabaseUrl = normalizeSupabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}

function headers(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };
}

function fallbackGuide(input: string, refs: ComplaintRow[]) {
  const first = refs[0];
  const thirdParty = first?.is_third_party === true ? "해당" : first?.is_third_party === false ? "비해당" : "확인 필요";
  const urgent = first?.urgent_processing_required === true ? "긴급" : "일반";
  return {
    section1: `제3자 여부: ${thirdParty}\n소송 관련사항: ${first?.litigation_related?.trim() || "현재 확인된 소송사항 없음"}\n긴급 처리 필요 여부: ${urgent}`,
    section2: first?.complainant_summary?.trim() || input,
    section3: first?.similar_case_content?.trim() || "유사 민원 사례를 내부 기준으로 추가 점검 예정입니다.",
    section4: first?.company_opinion?.trim() || "민원인의 주장 사실관계를 점검하고 관련 규정 및 계약서 기준으로 회신 예정입니다.",
    section5: first?.violation_and_action?.trim() || "현재 내부 조사 중이며 위규(법) 등 부당행위 발견 시 즉시 조치할 계획입니다.",
    section6: first?.future_action_plan?.trim() || "민원인 요청사항에 대해 검토 결과를 서면으로 안내하고 재발 방지 방안을 병행하겠습니다.",
    section7: "문의처: 민원관리 담당부서(연락처 기입)",
    section8: "참고사항: 관련 계약서, 녹취, 상담 이력, 내부 처리 로그 첨부 예정"
  };
}

export async function POST(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ ok: false, message: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 400 });
  }

  const body = (await request.json()) as {
    complaintText?: string;
    selectedReceiptNumbers?: string[];
  };
  const complaintText = String(body.complaintText ?? "").trim();
  const selected = Array.isArray(body.selectedReceiptNumbers)
    ? body.selectedReceiptNumbers.map((s) => String(s).trim()).filter(Boolean)
    : [];

  if (complaintText.length < 5) {
    return NextResponse.json({ ok: false, message: "민원 내용을 5자 이상 입력해 주세요." }, { status: 400 });
  }
  if (selected.length === 0) {
    return NextResponse.json({ ok: false, message: "유사 Word 사례를 1건 이상 선택해 주세요." }, { status: 400 });
  }

  const inClause = `in.(${selected.map((r) => `"${r.replaceAll("\"", "\\\"")}"`).join(",")})`;
  const params = new URLSearchParams();
  params.set(
    "select",
    "receipt_number,receipt_date,complaint_content,complaint_type_major,ai_category,is_third_party,litigation_related,urgent_processing_required,complainant_summary,similar_case_content,company_opinion,violation_and_action,future_action_plan"
  );
  params.set("receipt_number", inClause);
  params.set("limit", String(Math.min(selected.length, 20)));

  const res = await fetch(`${config.supabaseUrl}/rest/v1/complaint_records?${params.toString()}`, {
    method: "GET",
    headers: headers(config.serviceRoleKey)
  });
  const rows = (await res.json()) as unknown;
  if (!res.ok || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ ok: false, message: "선택한 유사 사례를 불러오지 못했습니다." }, { status: 500 });
  }
  const refs = rows as ComplaintRow[];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: true, guide: fallbackGuide(complaintText, refs), mode: "fallback" });
  }

  const refBrief = refs.map((r) => ({
    receipt_number: r.receipt_number,
    receipt_date: r.receipt_date,
    complaint_type_major: r.complaint_type_major ?? "",
    ai_category: r.ai_category ?? "",
    is_third_party: r.is_third_party,
    litigation_related: r.litigation_related ?? "",
    urgent_processing_required: r.urgent_processing_required,
    complainant_summary: r.complainant_summary ?? "",
    similar_case_content: r.similar_case_content ?? "",
    company_opinion: r.company_opinion ?? "",
    violation_and_action: r.violation_and_action ?? "",
    future_action_plan: r.future_action_plan ?? ""
  }));

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "너는 금융 민원 회신서 작성 보조자다. 반드시 JSON만 출력한다. 키는 section1~section8.\n" +
              "한국어로 작성하고 각 section은 2~6문장으로 실무 문체를 유지한다. 과장/환각 금지. 입력 근거가 없으면 '추가 확인 필요'라고 명시."
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "선택된 유사 사례를 반영해 민원회신서 초안작성 가이드를 8개 단락으로 작성",
              target_sections: [
                "1. 제3자여부, 소송관련사항, 긴급 처리를 요하는 사항",
                "2. 민원인 주장 요지",
                "3. 동일 내용 민원 및 처리 내용",
                "4. 민원인의 주장/요구사항에 대한 당사 의견",
                "5. 내부 조사결과 위규(법) 등 부당행위 및 조치",
                "6. 민원인 요청사항에 대한 의견 및 향후 처리방안",
                "7. 검토의견 문의처",
                "8. 기타 참고사항"
              ],
              complaint_input: complaintText,
              selected_similar_cases: refBrief
            })
          }
        ]
      })
    });
    const aiJson = (await aiRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = aiJson.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const guide = {
      section1: String(parsed.section1 ?? ""),
      section2: String(parsed.section2 ?? ""),
      section3: String(parsed.section3 ?? ""),
      section4: String(parsed.section4 ?? ""),
      section5: String(parsed.section5 ?? ""),
      section6: String(parsed.section6 ?? ""),
      section7: String(parsed.section7 ?? ""),
      section8: String(parsed.section8 ?? "")
    };
    if (!guide.section1 || !guide.section2 || !guide.section3 || !guide.section4 || !guide.section5 || !guide.section6 || !guide.section7 || !guide.section8) {
      return NextResponse.json({ ok: true, guide: fallbackGuide(complaintText, refs), mode: "fallback" });
    }
    return NextResponse.json({ ok: true, guide, mode: "ai" });
  } catch {
    return NextResponse.json({ ok: true, guide: fallbackGuide(complaintText, refs), mode: "fallback" });
  }
}
