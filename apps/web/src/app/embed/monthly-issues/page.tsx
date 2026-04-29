"use client";

import { Suspense } from "react";
import MonthlyIssuesPage from "@/app/(admin)/monthly-issues/page";

export default function EmbeddedMonthlyIssuesPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-slate-100" />}>
      <MonthlyIssuesPage />
    </Suspense>
  );
}

