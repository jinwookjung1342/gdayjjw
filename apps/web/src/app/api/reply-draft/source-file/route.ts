import { NextRequest, NextResponse } from "next/server";
import { normalizeSupabaseOrigin } from "@/lib/supabase-env";

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

function parseStoragePath(storagePath: string): { bucket: string; objectPath: string } | null {
  const m = /^storage:\/\/([^/]+)\/(.+)$/i.exec(storagePath.trim());
  if (!m) return null;
  return { bucket: m[1], objectPath: m[2] };
}

export async function GET(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ ok: false, message: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 400 });
  }
  const receiptNumber = (request.nextUrl.searchParams.get("receiptNumber") ?? "").trim();
  if (!receiptNumber) {
    return NextResponse.json({ ok: false, message: "receiptNumber가 필요합니다." }, { status: 400 });
  }

  const params = new URLSearchParams();
  params.set("select", "file_name,storage_path,created_at,parsed_result");
  params.set("file_type", "eq.word");
  params.set("order", "created_at.desc");
  params.set("limit", "30");
  const sourceRes = await fetch(`${config.supabaseUrl}/rest/v1/source_files?${params.toString()}`, {
    method: "GET",
    headers: headers(config.serviceRoleKey)
  });
  const sourceRows = (await sourceRes.json()) as unknown;
  if (!sourceRes.ok || !Array.isArray(sourceRows)) {
    return NextResponse.json({ ok: false, message: "Word 원본 경로 조회에 실패했습니다." }, { status: 500 });
  }

  const row = (sourceRows as Array<{ storage_path?: string; parsed_result?: unknown }>).find((r) => {
    const rr = r.parsed_result;
    if (!rr || typeof rr !== "object") return false;
    const mapped = (rr as Record<string, unknown>).receipt_number;
    return typeof mapped === "string" && mapped.trim() === receiptNumber;
  });
  const storagePath = typeof row?.storage_path === "string" ? row.storage_path : "";
  const parsed = parseStoragePath(storagePath);
  if (!parsed) {
    return NextResponse.json(
      { ok: false, message: "해당 접수번호의 원본 Word 파일 경로가 없습니다. 최신 업로드 이후 다시 시도해 주세요." },
      { status: 404 }
    );
  }

  const signRes = await fetch(
    `${config.supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(parsed.bucket)}/${parsed.objectPath}`,
    {
      method: "POST",
      headers: headers(config.serviceRoleKey),
      body: JSON.stringify({ expiresIn: 60 * 10 })
    }
  );
  const signJson = (await signRes.json()) as { signedURL?: string; error?: string; message?: string };
  if (!signRes.ok || !signJson.signedURL) {
    return NextResponse.json({ ok: false, message: "원본 Word 파일 열기 링크 생성에 실패했습니다." }, { status: 500 });
  }

  const url = `${config.supabaseUrl}/storage/v1${signJson.signedURL}`;
  return NextResponse.json({ ok: true, url });
}
