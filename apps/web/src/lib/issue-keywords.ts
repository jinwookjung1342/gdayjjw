/** 이달의 민원: 회신서(Word) 합본·민원내용 텍스트에서 건당 키워드 추출 후 집계 */

const KW_STOP = new Set([
  "및",
  "등",
  "에",
  "의",
  "을",
  "를",
  "이",
  "가",
  "은",
  "는",
  "도",
  "만",
  "로",
  "으로",
  "에서",
  "에게",
  "수",
  "것",
  "대한",
  "관련",
  "있습니다",
  "합니다",
  "위와",
  "같이",
  "있음",
  "없음",
  "있고",
  "및특히",
  "민원인",
  "민원",
  "민원제기",
  "제기",
  "접수",
  "회신",
  "검토",
  "바랍니다",
  "통해",
  "경우",
  "사항",
  "내용",
  "요청",
  "추후",
  "당사",
  "귀하",
  "본인",
  "해당",
  "따라",
  "별도",
  "기타",
  "사실",
  "추가",
  "민원인의",
  "주장",
  "요지",
  "요구사항",
  "처리방안",
  "의견",
  "구체적",
  "향후",
  "방안",
  "대출",
  "계약",
  "절차",
  "당시",
  "관련",
  "진행",
  "정상",
  "완료",
  "실행",
  "확인"
]);

const KO_PARTICLE_SUFFIX = /(에서|에게|으로|로|까지|부터|보다|처럼|만|도|의|을|를|이|가|은|는)$/;

const ISSUE_PATTERNS: Array<{ keyword: string; test: RegExp[] }> = [
  {
    keyword: "전자금융사기피해",
    test: [/전자금융\s*사기/, /사기\s*피해/, /보이스\s*피싱|피싱/]
  },
  {
    keyword: "비대면 본인확인절차",
    test: [/비대면/, /본인\s*확인/, /휴대전화\s*본인인증|OCR|1원\s*송금/]
  },
  {
    keyword: "대출무효_채무부존재",
    test: [/대출\s*무효|무효/, /채무\s*부존재|채무가\s*존재하지/]
  },
  {
    keyword: "제3자기망행위",
    test: [/제\s*3\s*자|제3자/, /기망\s*행위|개입/]
  },
  {
    keyword: "본인명의계좌입금",
    test: [/본인\s*명의\s*계좌/, /입금|자금\s*이동/]
  },
  {
    keyword: "유선확인미실시",
    test: [/유선\s*확인/, /미실시|필수\s*절차로\s*규정되어\s*있지/]
  }
];

function cleanToken(raw: string): string {
  return raw.trim().replace(/^[^A-Za-z0-9가-힣]+|[^A-Za-z0-9가-힣]+$/g, "");
}

function normalizeToken(raw: string): string {
  const t = cleanToken(raw);
  if (!t) return "";
  return t.replace(KO_PARTICLE_SUFFIX, "");
}

function isMeaningfulToken(token: string): boolean {
  if (token.length < 2 || token.length > 24) return false;
  if (/^[\d.]+$/.test(token)) return false;
  if (/^\d+(월|일|년)$/.test(token)) return false;
  if (/^\d{1,2}:\d{1,2}$/.test(token)) return false;
  if (/^[\d\-/.]+$/.test(token)) return false;
  if (KW_STOP.has(token)) return false;
  if (/^(있음|없음|해당사항없음|해당없음)$/i.test(token)) return false;
  return /[가-힣A-Za-z]/.test(token);
}

function tokenizeForKeywords(textRaw: string): string[] {
  const chunks = textRaw
    .replace(/\r/g, "\n")
    .split(/[\n,.;:!?()[\]{}'"`/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const chunk of chunks) {
    const tokens = chunk.match(/[A-Za-z0-9가-힣]+/g) ?? [];
    for (const tok of tokens) {
      const norm = normalizeToken(tok);
      if (isMeaningfulToken(norm)) out.push(norm);
    }
  }
  return out;
}

function buildNgrams(tokens: string[]): string[] {
  const grams: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    grams.push(tokens[i]);
    if (i + 1 < tokens.length) grams.push(`${tokens[i]} ${tokens[i + 1]}`);
    if (i + 2 < tokens.length) grams.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return grams;
}

function scorePhrase(phrase: string, freq: number): number {
  const words = phrase.split(" ");
  const lenBonus = words.length >= 3 ? 2.4 : words.length === 2 ? 1.3 : 0;
  const hasSpecificTerm =
    /(피해|사기|보이스피싱|본인확인|전자금융|대출|연체|금리|수수료|채권|추심|명의|계좌|해지|환급|청구|부당|오류)/.test(phrase);
  const specificBonus = hasSpecificTerm ? 0.8 : 0;
  return freq + lenBonus + specificBonus;
}

function pickIssuePatternKeywords(textRaw: string, max: number): string[] {
  const picked: string[] = [];
  for (const item of ISSUE_PATTERNS) {
    // 각 이슈마다 모든 조건이 아닌, 핵심 정규식 중 2개 이상(또는 1개만 있어도 강한 패턴) 매칭 시 채택
    const hitCount = item.test.reduce((acc, rx) => (rx.test(textRaw) ? acc + 1 : acc), 0);
    const threshold = item.test.length >= 3 ? 2 : 1;
    if (hitCount >= threshold) picked.push(item.keyword);
    if (picked.length >= max) break;
  }
  return picked;
}

/**
 * 단일 건 텍스트에서 등장 빈도 기준 고유 상위 단어 최대 max개 (한 글 원문 토큰).
 * Word 회신 전체 합본 또는 민원내용 1건에 적용.
 */
export function pickTopKeywordsPerComplaint(textRaw: string, max = 3): string[] {
  const patternFirst = pickIssuePatternKeywords(textRaw, max);
  if (patternFirst.length >= max) return patternFirst.slice(0, max);

  const tokens = tokenizeForKeywords(textRaw);
  const candidates = buildNgrams(tokens);
  const freqMap = new Map<string, number>();
  for (const c of candidates) {
    if (!c.trim()) continue;
    // 지나치게 긴 구문이나 불용어만으로 구성된 경우 제외
    const words = c.split(" ");
    if (words.length > 3) continue;
    if (words.every((w) => KW_STOP.has(w))) continue;
    if (words.some((w) => /^\d+(월|일|년)$/.test(w))) continue;
    if (words.some((w) => /^(가상계좌|입금해주셨습니다|강제해지절차|계약해지일|확정되지|상태입니다)$/.test(w))) continue;
    if (words.length === 1 && words[0].length <= 3) continue;
    freqMap.set(c, (freqMap.get(c) ?? 0) + 1);
  }

  const ranked = Array.from(freqMap.entries())
    .map(([phrase, freq]) => ({ phrase, score: scorePhrase(phrase, freq) }))
    .sort((a, b) => b.score - a.score || b.phrase.length - a.phrase.length || a.phrase.localeCompare(b.phrase));

  const picked: string[] = [];
  for (const p of patternFirst) {
    if (picked.length >= max) break;
    picked.push(p);
  }
  for (const r of ranked) {
    if (picked.length >= max) break;
    // 이미 선택된 키워드와 중복/포함 관계가 큰 경우는 스킵
    if (picked.some((p) => p.includes(r.phrase) || r.phrase.includes(p))) continue;
    picked.push(r.phrase);
  }
  return picked;
}

/** Word 회신 파싱 섹션 합본 (doc-ai SECTION 기준 텍스트만) */
export function buildWordCombinedText(ws: Record<string, string> | null | undefined): string | null {
  if (!ws || typeof ws !== "object") return null;
  const keys = ["complainant_summary", "similar_case_content", "company_opinion", "violation_and_action", "future_action_plan"];
  const parts = keys.map((k) => String((ws as Record<string, string>)[k] ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

export type IssueRowLite = {
  complaint_content?: string | null;
  word_combined_text?: string | null;
};

/**
 * 건당 1~3개 키워드 → 키워드별 포함된 민원 건수(동일 건에서 중복 집계 없음).
 */
export function aggregateComplaintKeywords(
  rows: IssueRowLite[],
  opts?: { fallbackToExcelMinor?: boolean }
): { word: string; count: number }[] {
  const docCount = new Map<string, number>();
  const fallbackExcel = opts?.fallbackToExcelMinor !== false;

  for (const row of rows) {
    const wordFirst =
      typeof row.word_combined_text === "string" && row.word_combined_text.trim().length >= 4
        ? row.word_combined_text.trim()
        : "";
    const merged = wordFirst || (fallbackExcel ? String(row.complaint_content ?? "").trim() : "");

    const terms = merged ? pickTopKeywordsPerComplaint(merged, 3) : [];

    const seen = new Set<string>();
    for (const w of terms) {
      if (seen.has(w)) continue;
      seen.add(w);
      docCount.set(w, (docCount.get(w) ?? 0) + 1);
    }
  }

  return Array.from(docCount.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}
