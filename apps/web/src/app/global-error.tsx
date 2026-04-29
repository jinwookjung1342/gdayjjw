"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4">
          <h1 className="text-lg font-semibold text-slate-900">심각한 오류</h1>
          <p className="max-w-md text-center text-sm text-slate-600">{error.message || "앱을 불러오지 못했습니다."}</p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
