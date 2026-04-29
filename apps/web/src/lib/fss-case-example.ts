/**
 * 금감원/한국소비자원 회신 WORD에서 추출한 3단락( doc-ai SECTION 키와 동일 )용.
 */

export const FSS_REPLY_SECTION_IDS = ["complainant_summary", "company_opinion", "future_action_plan"] as const;

export type FssReplyWordSections = Partial<Record<(typeof FSS_REPLY_SECTION_IDS)[number], string>>;

/** 화면에 표시하는 제목 문구 — Word 회신서 단락 제목과 대응 */
export const FSS_REPLY_SECTION_LABELS: readonly [
  typeof FSS_REPLY_SECTION_IDS[number],
  string,
][] = [
  ["complainant_summary", "민원의 주장 요지"],
  ["company_opinion", "민원의 주장 및 요구사항에 대한 당사의 구체적 의견"],
  ["future_action_plan", "민원인의 요청사항에 대한 당사의 의견 및 향후 처리방안"],
];

export function parseWordSectionsFlexible(raw: unknown): FssReplyWordSections {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: FssReplyWordSections = {};
  for (const k of FSS_REPLY_SECTION_IDS) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** "해당사항 없음" 등 무의미 플레이스홀더 여부 */
export function isPlaceholderParagraph(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (/^[.\-‐–—\s]+$/.test(t)) return true;
  if (/^(해당\s*사항\s*없음|해당사항\s*없음|해당없음)$/i.test(t)) return true;
  if (/^없음\.?$/i.test(t)) return true;
  if (/^[\s\S]{0,2}$/.test(t) && /^[.。\-]+$/.test(t)) return true;
  return false;
}

/** 금융감독원·한국소비자원 접수건 (접수경로분류명 값 기준·문자 포함도 허용) */
export function isFsscChannel(receiptChannelName: string): boolean {
  const n = receiptChannelName.replace(/\s+/g, " ").trim();
  return n.includes("금융감독원") || n.includes("한국소비자원");
}

/** Word 매핑·3단락 추출 존재 + 3단 모두 플레이스홀더 아님 */
export function rowHasSubstFssSections(ws: FssReplyWordSections | undefined | null): boolean {
  if (!ws) return false;
  for (const id of FSS_REPLY_SECTION_IDS) {
    const v = ws[id]?.trim() ?? "";
    if (!v || isPlaceholderParagraph(v)) return false;
  }
  return true;
}

function isHardBreakLine(line: string): boolean {
  const s = line.trim();
  if (!s) return true;
  // 번호/목록/제목류는 줄바꿈 유지
  if (/^(?:\d+[.)]|[-*•]|※)\s*/.test(s)) return true;
  if (/^\[.*\]$/.test(s)) return true;
  return false;
}

function isBulletLeadLine(line: string): boolean {
  return /^[①-⑩]\s*/.test(line.trim());
}

/**
 * Word 강제 줄바꿈으로 잘린 문장을 자동 병합.
 * - 목록/번호/헤더성 줄은 줄바꿈 유지
 * - 일반 본문 줄바꿈은 공백 1칸으로 병합
 */
export function normalizeSoftWrappedText(text: string): string {
  const srcLines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];

  for (const raw of srcLines) {
    const line = raw.trim();
    if (!line) {
      out.push("");
      continue;
    }

    if (out.length === 0) {
      out.push(line);
      continue;
    }

    const prev = out[out.length - 1] ?? "";
    const prevIsBulletLead = isBulletLeadLine(prev);
    const lineIsBulletLead = isBulletLeadLine(line);

    // ①/② 등 새 번호 시작은 항상 새 줄
    if (lineIsBulletLead) {
      out.push(line);
      continue;
    }

    // 이전 줄이 ①/② 제목 시작줄이면, 다음 일반 줄은 같은 항목 본문으로 붙인다.
    if (prevIsBulletLead && !isHardBreakLine(line)) {
      out[out.length - 1] = `${prev} ${line}`.replace(/\s+/g, " ").trim();
      continue;
    }

    if (!prev || isHardBreakLine(prev) || isHardBreakLine(line)) {
      out.push(line);
      continue;
    }

    // 일반 본문은 같은 문단으로 간주하고 붙여쓴다.
    out[out.length - 1] = `${prev} ${line}`.replace(/\s+/g, " ").trim();
  }

  // 빈 줄 정리(연속 빈 줄 1개만 허용)
  const compact: string[] = [];
  for (const l of out) {
    if (!l) {
      if (compact.length > 0 && compact[compact.length - 1] !== "") compact.push("");
      continue;
    }
    compact.push(l);
  }
  return compact.join("\n").trim();
}

/** Word 섹션에서 3단락 텍스트 (순서 고정) */
export function getFsscParagraphTriple(ws: unknown): [string, string, string] {
  const p = parseWordSectionsFlexible(ws);
  return [
    normalizeSoftWrappedText(p.complainant_summary ?? ""),
    normalizeSoftWrappedText(p.company_opinion ?? ""),
    normalizeSoftWrappedText(p.future_action_plan ?? ""),
  ];
}

/** 해당 월 대외 중 금감원/소비 대외 + Word 3단 모두 실질 내용인 첫 건 */
export function pickFirstFsscSubstantiveCase<
  T extends {
    complaint_scope?: string;
    receipt_channel_name?: string | null;
    word_sections?: unknown;
  }
>(
  rows: T[],
  month: string,
  rowInMonth: (row: T, month: string) => boolean
): T | null {
  for (const row of rows) {
    if (normScope(row.complaint_scope) !== "대외") continue;
    if (!rowInMonth(row, month)) continue;
    if (!isFsscChannel(String(row.receipt_channel_name ?? ""))) continue;
    const ws = parseWordSectionsFlexible(row.word_sections);
    if (rowHasSubstFssSections(ws)) return row;
  }
  return null;
}

function normScope(s: string | undefined): string {
  return (s ?? "").trim();
}
