import React from "react";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import { getWorkspace } from "@/lib/workspace/getWorkspace";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { listWorkOrders } from "@/lib/db/services/workOrders";
import Link from "next/link";

export default async function InvoicesPage() {
  // Require authentication
  const user = await getCurrentUser();
  if (!user) {
    redirect(ROUTES.signIn);
  }

  // Check workspace
  const workspace = await getWorkspace();
  if (!workspace) {
    redirect(ROUTES.onboarding);
  }

  // Get workspace ID for DB queries
  const workspaceId = await getWorkspaceIdForUser();
  
  // Get signed work orders ready for invoicing
  let signedWorkOrders: any[] = [];
  if (workspaceId) {
    try {
      const result = await listWorkOrders(workspaceId, {
        status: "SIGNED",
      }, {
        limit: 50, // Show up to 50 signed work orders
      });
      signedWorkOrders = result.items;
    } catch (error) {
      console.error("[Invoices] Error loading signed work orders:", error);
    }
  }

  return (
    <AppShell>
      <MainNavigation />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <svg
                className="w-6 h-6 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h1 className="text-2xl font-semibold text-white">Invoices</h1>
            </div>
            <p className="text-gray-400 text-sm">
              Work orders with signed PDFs ready for invoicing
            </p>
          </div>

          {/* Workflow Info */}
          <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-6 mb-6">
            <div className="flex items-start gap-4">
              <svg
                className="w-6 h-6 text-blue-400 mt-0.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="flex-1">
                <h3 className="text-blue-300 font-medium mb-2">Invoice Preparation Workflow</h3>
                <p className="text-blue-200 text-sm mb-3">
                  When work orders are signed, they're automatically marked as "SIGNED" and ready for invoicing. 
                  The system has already:
                </p>
                <ul className="list-disc list-inside text-blue-200 text-sm space-y-1 ml-4">
                  <li>Matched signed PDFs to existing work orders</li>
                  <li>Stored signed documents and preview images</li>
                  <li>Updated work order status to "SIGNED"</li>
                  <li>Prepared all necessary data for invoice generation</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Signed Work Orders List */}
          {signedWorkOrders.length > 0 ? (
            <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-700">
                <h2 className="text-lg font-semibold text-white">
                  Signed Work Orders Ready for Invoicing ({signedWorkOrders.length})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-750">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Work Order #
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Scheduled Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Signed At
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {signedWorkOrders.map((wo) => (
                      <tr key={wo.id} className="hover:bg-gray-750 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Link
                            href={`${ROUTES.workOrders}/${wo.job_id}`}
                            className="text-blue-400 hover:text-blue-300 font-medium"
                          >
                            {wo.work_order_number || "N/A"}
                          </Link>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-300">
                          {wo.customer_name || "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-300">
                          {wo.scheduled_date ? new Date(wo.scheduled_date).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-300">
                          {wo.amount ? `$${parseFloat(wo.amount).toFixed(2)}` : "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-300">
                          {wo.signed_at ? new Date(wo.signed_at).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Link
                            href={`${ROUTES.workOrders}/${wo.job_id}`}
                            className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                          >
                            View Details
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-12">
              <div className="text-center">
                <svg
                  className="w-16 h-16 text-gray-600 mx-auto mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <h2 className="text-xl font-semibold text-white mb-3">No Signed Work Orders Yet</h2>
                <p className="text-gray-400 max-w-md mx-auto mb-6">
                  Once you process signed PDFs, they'll appear here ready for invoicing.
                </p>
                <div className="flex gap-4 justify-center">
                  <Link
                    href={ROUTES.signedUpload}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                  >
                    Process Signed PDFs
                  </Link>
                  <Link
                    href={ROUTES.workOrders}
                    className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 font-medium"
                  >
                    View All Work Orders
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

