/** AI 미사용/실패 시 본문+민원유형(소) 기반 라벨. 본문 키워드를 최우선해 소분류를 세분화한다. */

export type AiLabelStrict = { category: string; subcategory: string };

const MINOR_NEEDLES: Array<{ needles: string[]; label: AiLabelStrict }> = [
  { needles: ["계약사실", "부인"], label: { category: "영업", subcategory: "계약사실상이(부인)" } },
  { needles: ["차량인수"], label: { category: "영업", subcategory: "담보차량인수부인" } },
  { needles: ["담보차량", "결함"], label: { category: "영업", subcategory: "담보차량 결함" } },
  { needles: ["설명의무"], label: { category: "영업", subcategory: "설명의무 위반" } },
  { needles: ["불법영업"], label: { category: "영업", subcategory: "불법영업" } },
  { needles: ["판매과정"], label: { category: "영업", subcategory: "기타 판매과정 불만" } },
  { needles: ["독촉"], label: { category: "채권", subcategory: "과다/고압 독촉" } },
  { needles: ["가압류", "취하"], label: { category: "채권", subcategory: "가압류 취하 미흡" } },
  { needles: ["근저당", "해지"], label: { category: "채권", subcategory: "근저당 해지 절차" } },
  { needles: ["채권", "매각"], label: { category: "채권", subcategory: "채권 매각 관련" } },
  { needles: ["추심"], label: { category: "채권", subcategory: "채권추심관련 금지행위" } },
  { needles: ["고압적", "응대"], label: { category: "고객상담", subcategory: "담당자의 고압적 응대" } },
  { needles: ["연락불가"], label: { category: "고객상담", subcategory: "연락불가" } },
  { needles: ["수납", "결제"], label: { category: "제도정책", subcategory: "결제(수납)관련" } },
  { needles: ["개인정보", "유출"], label: { category: "제도정책", subcategory: "개인정보유출의심" } },
  { needles: ["중도상환", "수수료"], label: { category: "제도정책", subcategory: "중도상환(해지)수수료 관련" } },
  { needles: ["손해액", "감가"], label: { category: "제도정책", subcategory: "차량 손해액관련(반납평가, 감가 관련)" } }
];

/** 민원유형(소) 문자열 내 정교한 패턴만 매칭(영업/채권 포괄 단어 하나만으로는 특정 라벨을 주지 않음) */
export function aiLabelFromMinorStrict(rawMinor: string): AiLabelStrict | null {
  const minor = (rawMinor ?? "").replace(/\s+/g, "").trim();
  if (!minor) return null;
  for (const rule of MINOR_NEEDLES) {
    if (rule.needles.every((needle) => minor.includes(needle.replace(/\s+/g, "")))) return rule.label;
  }
  return null;
}

/**
 * 민원내용만으로 분류할 때는 채권·제도·상담 키워드를 먼저 보고,
 * 포괄적인 영업 표현(판매 불만 등)은 가장 뒤에서만 사용한다.
 */
export function classifyLabelFromComplaintBodyOnly(textRaw: string): AiLabelStrict | null {
  const t = textRaw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const has = (k: string) => t.includes(k);

  /** --- 채권 --- */
  if (
    has("경매") ||
    has("낙찰") ||
    has("매각처분") ||
    has("공매") ||
    (has("차량") && has("매각")) ||
    (has("연체") && has("매각"))
  )
    return { category: "채권", subcategory: "채권 매각 관련" };
  if (
    has("가압류") ||
    has("체납압류") ||
    has("부동산압류") ||
    (has("신청") && has("가압") && has("취하")) ||
    (has("해제") && has("가압"))
  )
    return { category: "채권", subcategory: "가압류 취하 미흡" };
  if (
    has("근저당") ||
    has("등기말소") ||
    (has("담보") && has("말소")) ||
    (has("근저당") && (has("해지") || has("말소"))) ||
    has("저당말소")
  )
    return { category: "채권", subcategory: "근저당 해지 절차" };
  if (
    has("추심") ||
    (has("채권") && has("위반")) ||
    has("불법추심") ||
    has("채권추심")
  )
    return { category: "채권", subcategory: "채권추심관련 금지행위" };
  if (
    has("독촉") ||
    has("고압") ||
    has("협박") ||
    has("야간전화") ||
    has("문자폭탄") ||
    has("연체통지") ||
    has("상습연락") ||
    (has("채권회수") || has("연체금") || has("상환독촉"))
  )
    return { category: "채권", subcategory: "과다/고압 독촉" };

  /** --- 제도정책 (영업 「설명」과 분리 가능한 조합만) --- */
  if (
    has("개인정보") ||
    has("유출") ||
    has("동의없이") ||
    has("정보유출") ||
    (has("제3자") && has("제공"))
  )
    return { category: "제도정책", subcategory: "개인정보유출의심" };

  /** 중도·수수료 민원: 설명 누락 성격보다 규제·금액 불만 우선 시 */
  const feePolicy =
    (has("중도상환") && (has("수수료") || has("위약금"))) ||
    has("해지수수료") ||
    (has("조기종료") && has("위약금")) ||
    (!has("설명의무") && !has("고지안") && (has("수수료") && has("해지")));
  if (feePolicy) return { category: "제도정책", subcategory: "중도상환(해지)수수료 관련" };

  const paymentPolicy =
    has("결제") ||
    has("입금오류") ||
    has("이체오류") ||
    has("수납") ||
    (has("미납") && (has("이체") || has("금융기관"))) ||
    has("납입확인");
  /** 연체 채무 독촉류는 채권쪽에서 이미 걸림. 단순 수납 처리만 제도 정책 */
  if (paymentPolicy && !has("연체통지")) return { category: "제도정책", subcategory: "결제(수납)관련" };

  if (
    has("반납평가") ||
    has("감가") ||
    has("손해액") ||
    has("잔존가치") ||
    has("중고차평가") ||
    has("차량평가") ||
    has("손해보전")
  )
    return { category: "제도정책", subcategory: "차량 손해액관련(반납평가, 감가 관련)" };

  /** --- 고객상담 --- */
  if (
    (has("담당자") || has("직원")) &&
    (has("고압") || has("불친절") || has("무례") || has("폭언") || has("욕설"))
  )
    return { category: "고객상담", subcategory: "담당자의 고압적 응대" };
  if (
    has("연락두절") ||
    has("유선불가") ||
    (has("연락") && has("두절")) ||
    has("통화연결실패") ||
    (has("고객센터") && has("접속불가"))
  )
    return { category: "고객상담", subcategory: "연락불가" };

  /** --- 영업: 구체 순 --- */
  if (has("불법영업") || has("무허가") || (has("사기") && (has("대출") || has("모집"))))
    return { category: "영업", subcategory: "불법영업" };
  if (has("계약부인") || has("계약안했다") || (has("부인") && (has("서명") || has("차용"))))
    return { category: "영업", subcategory: "계약사실상이(부인)" };
  if (has("차량인수") || has("인수거부") || (has("차량반환") && has("거부")))
    return { category: "영업", subcategory: "담보차량인수부인" };
  if (has("결함") || has("하자") || has("리콜") || (has("엔진") && has("고장"))) return { category: "영업", subcategory: "담보차량 결함" };
  if (
    has("설명의무") ||
    has("미고지") ||
    (has("고지") && (has("누락") || has("허위"))) ||
    (has("금리") && has("설명")) ||
    (has("중도상환") && has("설명")) ||
    has("설명 불충분")
  )
    return { category: "영업", subcategory: "설명의무 위반" };
  /** 영업 일반 불만은 문맥 키워드가 함께 있을 때만 */
  const salesCatch =
    has("판매과정") ||
    has("계약체결") ||
    has("대출심사불공정") ||
    has("영업직원오안내") ||
    has("심사지연민원") ||
    (has("불공정") && has("판매")) ||
    (has("대출실행") && has("민원"));
  if (salesCatch) return { category: "영업", subcategory: "기타 판매과정 불만" };

  /** --- 매우 폭넓은 잔 --- */
  if ((has("계약") || has("대출계약")) && has("부인")) return { category: "영업", subcategory: "계약사실상이(부인)" };

  return null;
}

/** 빈 내용 또는 마지막 수단만: 과거 포괄 힌트는 최후에만 매칭 */
export function classifyLabelMinorLastResort(rawMinor?: string): AiLabelStrict | null {
  const trimmed = String(rawMinor ?? "").trim();
  if (!trimmed) return null;
  const minor = trimmed.replace(/\s+/g, "");
  if (/^(영업|판매)$/u.test(trimmed)) return { category: "영업", subcategory: "기타 판매과정 불만" };
  if (/^(채권|추심|독촉)$/u.test(trimmed)) return { category: "채권", subcategory: "과다/고압 독촉" };
  if (/^(제도|정책|수납|결제)$/u.test(trimmed)) return { category: "제도정책", subcategory: "결제(수납)관련" };
  if (minor.includes("영업") || minor.includes("판매")) {
    return { category: "영업", subcategory: "기타 판매과정 불만" };
  }
  if (minor.includes("채권")) return { category: "채권", subcategory: "과다/고압 독촉" };
  return null;
}

/**
 * 순서: ①민원내용 패턴 → ②민원유형(소) 세부 패턴 → ③최후 보조(포괄 단어 단독 등)
 */
export function fallbackComplaintAiLabel(rawText: string, minorHint?: string): AiLabelStrict {
  const t = rawText.replace(/\s+/g, " ").trim();
  const m = String(minorHint ?? "").trim();
  if (!t && !m) return { category: "기타", subcategory: "미분류" };
  let out = classifyLabelFromComplaintBodyOnly(t);
  if (out) return out;
  out = aiLabelFromMinorStrict(m) ?? null;
  if (out) return out;
  out = classifyLabelMinorLastResort(m);
  if (out) return out;
  return { category: "기타", subcategory: t ? `기타-${t.slice(0, 24)}` : "기타" };
}

/** 차트 폴백 문자열(ai_subcategory 대체 형식 준수) */
export function fallbackComplaintSubtypeString(raw: string, minorHint?: string): string {
  const { subcategory } = fallbackComplaintAiLabel(raw ?? "", minorHint);
  return subcategory;
}
