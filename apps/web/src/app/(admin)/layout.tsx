import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const session = (await cookies()).get("jb_session");
  if (!session?.value) {
    redirect("/login");
  }
  const employeeId = session.value.trim().toUpperCase();

  return (
    <div className="min-h-screen bg-slate-100 md:p-6">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none md:min-h-[calc(100vh-3rem)] md:flex-row md:rounded-3xl md:border md:border-slate-200 md:bg-white md:shadow-xl">
        <Sidebar employeeId={employeeId} />
        <section className="flex min-w-0 flex-1 flex-col border-t border-slate-200 bg-slate-50 md:border-t-0">
          <header className="flex items-center justify-between border-b border-slate-200/80 bg-white px-4 py-3 md:px-5 md:py-4">
            <h2 className="text-base font-bold text-slate-950">JB우리캐피탈 월별 민원현황</h2>
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                로그아웃
              </button>
            </form>
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </section>
      </div>
    </div>
  );
}
