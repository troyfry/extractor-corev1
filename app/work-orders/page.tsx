import React from "react";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import WorkOrdersList from "@/components/work-orders/WorkOrdersList";

export default async function WorkOrdersPage() {
  // Require authentication
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/signin");
  }

  return (
    <AppShell>
      <WorkOrdersList />
    </AppShell>
  );
}
