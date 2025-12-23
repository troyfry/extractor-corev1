import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import WorkOrderDetailClient from "./WorkOrderDetailClient";

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  // Check authentication (middleware handles onboarding for /pro routes)
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/signin");
  }

  const { jobId } = await params;

  return <WorkOrderDetailClient jobId={jobId} />;
}

