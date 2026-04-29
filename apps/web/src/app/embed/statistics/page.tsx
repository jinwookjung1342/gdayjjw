"use client";

import { Suspense } from "react";
import StatisticsPage from "@/app/(admin)/statistics/page";

export default function EmbeddedStatisticsPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-slate-100" />}>
      <StatisticsPage />
    </Suspense>
  );
}

