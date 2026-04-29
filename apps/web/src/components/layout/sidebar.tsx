"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const menus = [
  { href: "/statistics", label: "민원통계" },
  { href: "/monthly-issues", label: "이달의 민원" },
  { href: "/monthly-data", label: "월별 데이터 입력" },
  { href: "/monthly-report", label: "월보발송" },
  { href: "/reply-draft", label: "민원회신서 초안 작성" }
];

const MASTER_EMPLOYEE_ID = "21W00035";
const MASTER_ONLY = new Set(["/monthly-data", "/monthly-report", "/reply-draft"]);

export function Sidebar({ employeeId }: { employeeId: string }) {
  const pathname = usePathname();
  const isMaster = employeeId.trim().toUpperCase() === MASTER_EMPLOYEE_ID;
  const visibleMenus = menus.filter((m) => isMaster || !MASTER_ONLY.has(m.href));

  return (
    <aside className="w-full shrink-0 border-b border-white/10 bg-slate-950 md:w-56 md:border-b-0 md:border-r md:border-white/10">
      <div className="px-3 py-3 md:px-4 md:py-4">
        <div className="rounded-xl bg-white/10 p-3 backdrop-blur-sm">
          <div className="text-xs text-slate-300">JB우리캐피탈</div>
          <div className="mt-0.5 text-sm font-bold leading-snug text-white">민원현황 Admin</div>
        </div>
        <p className="mt-3 hidden text-[11px] leading-relaxed text-slate-400 md:block">
          월별 민원 데이터 조회·분석
        </p>
      </div>
      <nav className="flex flex-row gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:gap-0.5 md:space-y-0 md:overflow-visible md:px-2 md:pb-4">
        {visibleMenus.map((menu) => {
          const active = pathname === menu.href || pathname.startsWith(`${menu.href}/`);
          return (
            <Link
              key={menu.href}
              href={menu.href}
              className={`block shrink-0 rounded-xl px-3 py-2 text-left text-[13px] font-bold leading-snug transition md:py-2.5 ${
                active ? "bg-white text-slate-950 shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              {menu.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
