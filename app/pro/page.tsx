import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/routes";

export default function ProAliasPage() {
  redirect(ROUTES.workOrders);
}
