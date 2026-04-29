"use client";

import { FormEvent, useRef, useState } from "react";

const FETCH_MS = 20000;

export default function LoginPage() {
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  async function runLogin() {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError("");

    const apiUrl = `${window.location.origin}/api/auth/login`;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_MS);
    let willNavigate = false;

    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, password }),
        credentials: "include",
        signal: controller.signal
      });
      window.clearTimeout(timeoutId);

      const text = await res.text();
      let body: { ok?: boolean; message?: string } = {};
      if (text.trim()) {
        try {
          body = JSON.parse(text) as { ok?: boolean; message?: string };
        } catch {
          setError("서버 응답을 처리할 수 없습니다. 잠시 후 다시 시도하세요.");
          return;
        }
      }

      if (!res.ok || body.ok !== true) {
        setError(body.message ?? (text ? "로그인에 실패했습니다." : "서버 응답이 비어 있습니다."));
        return;
      }

      willNavigate = true;
      queueMicrotask(() => {
        window.location.replace(`${window.location.origin}/statistics`);
      });
    } catch (e) {
      window.clearTimeout(timeoutId);
      if (e instanceof Error && e.name === "AbortError") {
        setError("응답이 너무 오래 걸립니다. Next.js(dev)와 네트워크를 확인하세요.");
      } else {
        setError(e instanceof Error ? e.message : "네트워크 오류가 발생했습니다.");
      }
    } finally {
      if (!willNavigate) {
        submitting.current = false;
        setLoading(false);
      }
    }
  }

  function onFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    void runLogin();
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900 md:p-6">
      <div className="mx-auto grid min-h-[min(100vh-2rem,56rem)] max-w-7xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl md:min-h-[820px] lg:grid-cols-[1.15fr_.85fr]">
        <section className="relative overflow-hidden bg-slate-950 p-8 text-white md:p-10">
          <div
            className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,.42),transparent_34%),radial-gradient(circle_at_80%_55%,rgba(6,182,212,.25),transparent_30%)]"
            aria-hidden
          />
          <div className="relative z-10 flex h-full flex-col justify-between gap-12">
            <div>
              <div className="mb-10 inline-flex rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm font-bold backdrop-blur">
                JB우리캐피탈 내부 업무 시스템
              </div>
              <h1 className="max-w-xl text-4xl font-black leading-tight tracking-tight md:text-5xl">
                JB우리캐피탈
                <br />
                월별 민원현황
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-300 md:text-lg md:leading-8">
                민원 유입 데이터를 월별로 확인하고, 대외민원 현황을 한 화면에서 관리하는 관리자용 대시보드입니다.
              </p>
            </div>
            <div className="hidden gap-4 sm:grid sm:grid-cols-3">
              <div className="rounded-3xl bg-white/10 p-4 backdrop-blur md:p-5">
                <div className="text-2xl font-black md:text-3xl">—</div>
                <div className="mt-1 text-xs text-slate-300 md:text-sm">통계·입력 후 확인</div>
              </div>
              <div className="rounded-3xl bg-white/10 p-4 backdrop-blur md:p-5">
                <div className="text-2xl font-black md:text-3xl">—</div>
                <div className="mt-1 text-xs text-slate-300 md:text-sm">대외·대내 집계</div>
              </div>
              <div className="rounded-3xl bg-white/10 p-4 backdrop-blur md:p-5">
                <div className="text-2xl font-black md:text-3xl">AI</div>
                <div className="mt-1 text-xs text-slate-300 md:text-sm">유형 분류·초안</div>
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center bg-slate-50 p-6 md:p-10">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <div className="mb-8">
              <div className="mb-3 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                Secure Login
              </div>
              <h2 className="text-3xl font-black text-slate-950">로그인</h2>
              <p className="mt-2 text-sm text-slate-500">사번과 비밀번호를 입력한 뒤 대시보드로 이동합니다.</p>
            </div>

            <form className="space-y-4" onSubmit={onFormSubmit} noValidate>
              <div>
                <label htmlFor="employeeId" className="block text-sm font-bold text-slate-700">
                  사번
                </label>
                <input
                  id="employeeId"
                  name="employeeId"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none ring-slate-400 focus:ring-2"
                  placeholder="사번"
                  autoComplete="username"
                  autoCapitalize="characters"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-bold text-slate-700">
                  비밀번호
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none ring-slate-400 focus:ring-2"
                  placeholder="비밀번호"
                  autoComplete="current-password"
                />
              </div>

              {error ? (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-lg transition hover:bg-slate-900 disabled:cursor-wait disabled:opacity-80"
              >
                {loading ? "로그인 중..." : "대시보드 입장"}
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
