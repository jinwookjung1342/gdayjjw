import { NextResponse } from "next/server";

type GeneratePptPayload = {
  month: string;
  statsImages: string[];
  issuesImages?: string[];
  keywords?: Array<{ word: string; count: number }>;
  fssCase?: {
    receiptNumber?: string;
    channel?: string;
    paragraphs?: [string, string, string];
  } | null;
  summary?: {
    total?: number;
    external?: number;
    internal?: number;
    prevKey?: string;
    diffRate?: number;
    channels?: { 금융감독원?: number; 소비자원?: number; 기타?: number };
    keywords?: string[];
    topTypes?: string[];
  };
};

function safeDataUrlImage(dataUrl: string): string {
  if (!dataUrl.startsWith("data:image/")) return "";
  return dataUrl;
}

function emuToIn(emu: number): number {
  return emu / 914400;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GeneratePptPayload;
    if (!body?.month || !Array.isArray(body?.statsImages) || body.statsImages.length === 0) {
      return NextResponse.json({ ok: false, message: "month/statsImages required" }, { status: 400 });
    }

    const statsImages = body.statsImages.map((x) => safeDataUrlImage(String(x))).filter(Boolean);
    const issuesImages = (body.issuesImages ?? []).map((x) => safeDataUrlImage(String(x))).filter(Boolean);
    if (statsImages.length === 0) {
      return NextResponse.json({ ok: false, message: "invalid image payload" }, { status: 400 });
    }

    const mod = await import("pptxgenjs");
    const PptxGen = mod.default;
    const pptx = new PptxGen();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "JB Complaint Web";
    pptx.company = "JB우리캐피탈";
    pptx.subject = `${body.month} 월보발송`;
    pptx.title = `${body.month} 월보발송`;

    const s = body.summary ?? {};
    // reference deck proportions(대략) 기반 배치 템플릿
    const cover = pptx.addSlide();
    cover.addText(`${body.month} 월보 통합 요약`, { x: 0.4, y: 0.25, w: 12.5, h: 0.4, bold: true, fontSize: 20, color: "0F172A" });
    cover.addText(
      `전체 ${s.total ?? 0}건 / 대외 ${s.external ?? 0}건 / 대내 ${s.internal ?? 0}건 · 전월(${s.prevKey ?? "-"}) 대비 ${s.diffRate ?? 0}%`,
      { x: 0.5, y: 0.72, w: 12.2, h: 0.35, fontSize: 12, color: "334155" }
    );
    cover.addText(`키워드: ${(s.keywords ?? []).join(", ") || "없음"}`, { x: 0.5, y: 1.08, w: 12.2, h: 0.3, fontSize: 10, color: "334155" });
    cover.addText("아래 슬라이드부터 민원통계 원본 화면(분할) + 이달의 민원 핵심 카드가 이어집니다.", {
      x: 0.5,
      y: 1.4,
      w: 12.2,
      h: 0.6,
      fontSize: 15,
      color: "1E293B",
      breakLine: true,
    });

    // 민원통계: 3~4장
    for (let i = 0; i < statsImages.length; i += 1) {
      const slide = pptx.addSlide();
      slide.addText(`${body.month} 민원통계 (${i + 1}/${statsImages.length})`, {
        x: 0.35,
        y: 0.22,
        w: 12.5,
        h: 0.35,
        bold: true,
        fontSize: 19,
        color: "0F172A",
      });
      // 레퍼런스 PPT처럼 여백을 남기고 크게 보여줌
      slide.addImage({ data: statsImages[i], x: emuToIn(193039), y: emuToIn(700000), w: emuToIn(8421275), h: emuToIn(5200000) });
    }

    // 이달의 민원 키워드: 1장
    const kwSlide = pptx.addSlide();
    kwSlide.addText(`${body.month} 민원내용 키워드 (빈도)`, { x: 0.4, y: 0.25, w: 12.5, h: 0.35, bold: true, fontSize: 20, color: "0F172A" });
    const kw = body.keywords ?? [];
    if (kw.length === 0) {
      kwSlide.addText("해당 월 키워드가 없습니다.", { x: 0.6, y: 1.2, w: 12, h: 0.5, fontSize: 14, color: "64748B" });
    } else {
      const top = kw[0];
      kwSlide.addText(`#${top.word}`, { x: 0.6, y: 1.0, w: 12, h: 0.6, fontSize: 38, bold: true, color: "111827" });
      kwSlide.addText(`${top.count}건 포함`, { x: 0.62, y: 1.75, w: 5, h: 0.35, fontSize: 14, color: "4338CA" });
      let y = 2.4;
      for (const item of kw.slice(1, 10)) {
        kwSlide.addText(`#${item.word} (${item.count})`, { x: 0.75, y, w: 6.0, h: 0.38, fontSize: 17, color: "334155" });
        y += 0.46;
      }
      if (issuesImages[0]) {
        kwSlide.addImage({ data: issuesImages[0], x: 6.2, y: 1.25, w: 6.4, h: 5.6 });
      }
    }

    // 금감원 회신 주요 사례: 1~2장
    const fss = body.fssCase;
    const paragraphs = fss?.paragraphs ?? ["", "", ""];
    const hasFss = paragraphs.some((p) => (p ?? "").trim().length > 0);
    if (!hasFss) {
      const none = pptx.addSlide();
      none.addText(`${body.month} 금감원 회신 주요 사례`, { x: 0.4, y: 0.25, w: 12.5, h: 0.35, bold: true, fontSize: 20, color: "0F172A" });
      none.addText("해당 월에 조건을 만족하는 사례가 없습니다.", { x: 0.6, y: 1.3, w: 12, h: 0.5, fontSize: 14, color: "64748B" });
    } else {
      const s1 = pptx.addSlide();
      s1.addText(`${body.month} 금감원 회신 주요 사례`, { x: 0.4, y: 0.25, w: 12.5, h: 0.35, bold: true, fontSize: 20, color: "0F172A" });
      s1.addText(`접수번호 ${fss?.receiptNumber ?? "-"} · ${fss?.channel ?? "-"}`, { x: 0.5, y: 0.7, w: 12, h: 0.3, fontSize: 11, color: "64748B" });
      s1.addText("민원의 주장 요지", { x: 0.55, y: 1.15, w: 12, h: 0.3, bold: true, fontSize: 14, color: "0F172A" });
      s1.addText((paragraphs[0] || "—").replace(/\n/g, " ").slice(0, 900), { x: 0.6, y: 1.45, w: 12.0, h: 2.2, fontSize: 12, color: "334155" });
      s1.addText("민원의 주장 및 요구사항에 대한 당사의 구체적 의견", { x: 0.55, y: 3.95, w: 12, h: 0.3, bold: true, fontSize: 14, color: "0F172A" });
      s1.addText((paragraphs[1] || "—").replace(/\n/g, " ").slice(0, 900), { x: 0.6, y: 4.25, w: 12.0, h: 2.1, fontSize: 12, color: "334155" });

      const s2 = pptx.addSlide();
      s2.addText(`${body.month} 금감원 회신 주요 사례 (계속)`, { x: 0.4, y: 0.25, w: 12.5, h: 0.35, bold: true, fontSize: 20, color: "0F172A" });
      s2.addText("민원인의 요청사항에 대한 당사의 의견 및 향후 처리방안", {
        x: 0.55,
        y: 1.05,
        w: 12,
        h: 0.3,
        bold: true,
        fontSize: 14,
        color: "0F172A",
      });
      s2.addText((paragraphs[2] || "—").replace(/\n/g, " ").slice(0, 1500), { x: 0.6, y: 1.4, w: 12.0, h: 5.4, fontSize: 12, color: "334155" });
      if (issuesImages[1]) {
        s2.addImage({ data: issuesImages[1], x: 8.7, y: 0.7, w: 4.0, h: 2.2 });
      }
    }

    const out = (await pptx.write({ outputType: "base64" })) as string;
    return NextResponse.json({
      ok: true,
      fileName: `${body.month}-월보발송-스냅샷.pptx`,
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      base64: out,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : "ppt generation failed" }, { status: 500 });
  }
}

