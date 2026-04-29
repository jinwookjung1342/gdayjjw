"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4">
      <h1 className="text-lg font-semibold text-slate-900">문제가 발생했습니다</h1>
      <p className="max-w-md text-center text-sm text-slate-600">
        {error.message || "알 수 없는 오류입니다."}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        다시 시도
      </button>
    </div>
  );
}
