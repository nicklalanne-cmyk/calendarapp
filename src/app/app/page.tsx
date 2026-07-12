import { Suspense } from "react";
import Planner from "@/components/Planner";

export const dynamic = "force-dynamic";

export default function AppPage() {
  return (
    <Suspense fallback={null}>
      <Planner />
    </Suspense>
  );
}
