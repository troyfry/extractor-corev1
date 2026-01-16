import { getCurrentUser } from "@/lib/auth/currentUser";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import Link from "next/link";

export default async function HomePage() {
  // Require authentication
  const user = await getCurrentUser();
  if (!user) {
    redirect(ROUTES.signIn);
  }

  return (
    <AppShell>
      <MainNavigation />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-6xl mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-white mb-3">
              Work Order Suite
            </h1>
            <p className="text-lg text-gray-400">
              Pick what you want to do
            </p>
          </div>

          {/* Action Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {/* Card 1: Import New Work Orders */}
            <Link
              href={ROUTES.inbox}
              className="group bg-gray-800 border border-gray-700 rounded-lg p-8 hover:border-blue-500 hover:bg-gray-750 transition-all duration-200 cursor-pointer"
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center group-hover:bg-blue-500 transition-colors">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-white group-hover:text-blue-400 transition-colors">
                  Import New Work Orders
                </h2>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Upload digital work order PDFs and send them into your job tracking sheet.
                </p>
              </div>
            </Link>

            {/* Card 2: Process Signed PDFs */}
            <Link
              href={ROUTES.signedUpload}
              className="group bg-gray-800 border border-gray-700 rounded-lg p-8 hover:border-yellow-500 hover:bg-gray-750 transition-all duration-200 cursor-pointer"
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-yellow-600 rounded-lg flex items-center justify-center group-hover:bg-yellow-500 transition-colors">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-white group-hover:text-yellow-400 transition-colors">
                  Process Signed PDFs
                </h2>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Match signed work orders from the field to your existing jobs and prepare for invoicing.
                </p>
              </div>
            </Link>

            {/* Card 3: View Work Orders */}
            <Link
              href={ROUTES.workOrders}
              className="group bg-gray-800 border border-gray-700 rounded-lg p-8 hover:border-green-500 hover:bg-gray-750 transition-all duration-200 cursor-pointer"
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-green-600 rounded-lg flex items-center justify-center group-hover:bg-green-500 transition-colors">
                  <svg
                    className="w-8 h-8 text-white"
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
                </div>
                <h2 className="text-xl font-semibold text-white group-hover:text-green-400 transition-colors">
                  View Work Orders
                </h2>
                <p className="text-gray-400 text-sm leading-relaxed">
                  See your jobs, status, and links to original and signed PDFs.
                </p>
              </div>
            </Link>

            {/* Card 4: Settings & Profiles */}
            <Link
              href={ROUTES.settings}
              className="group bg-gray-800 border border-gray-700 rounded-lg p-8 hover:border-purple-500 hover:bg-gray-750 transition-all duration-200 cursor-pointer"
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-purple-600 rounded-lg flex items-center justify-center group-hover:bg-purple-500 transition-colors">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-white group-hover:text-purple-400 transition-colors">
                  Settings & Profiles
                </h2>
                <p className="text-gray-400 text-sm leading-relaxed">
                  Manage FM profiles, templates, and advanced setup.
                </p>
              </div>
            </Link>
          </div>

          {/* Workflow Guide Section */}
          <div className="mt-16 max-w-4xl mx-auto">
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-8">
              <h2 className="text-2xl font-semibold text-white mb-6 text-center">
                Workflow Guide
              </h2>
              
              <div className="space-y-8">
                {/* Step 1: Work Orders Come In */}
                <div className="border-l-4 border-blue-500 pl-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">
                      1
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-white mb-2">
                        When Work Orders Come In
                      </h3>
                      <p className="text-gray-400 mb-3">
                        New work orders arrive via email or manual upload. The system automatically:
                      </p>
                      <ul className="list-disc list-inside text-gray-400 space-y-1 ml-4">
                        <li>Extracts work order numbers, dates, customer info, and job details</li>
                        <li>Stores them in your database for tracking</li>
                        <li>Creates job records with status "OPEN"</li>
                        <li>Links original PDFs for reference</li>
                      </ul>
                      <div className="mt-4">
                        <Link
                          href={ROUTES.inbox}
                          className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm font-medium"
                        >
                          Go to Inbox
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 2: Invoice Time */}
                <div className="border-l-4 border-yellow-500 pl-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-yellow-600 rounded-full flex items-center justify-center text-white font-bold">
                      2
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-white mb-2">
                        Invoice Time: Gathering Signatures & Prepping for Invoicing
                      </h3>
                      <p className="text-gray-400 mb-3">
                        When it's time to invoice, process signed work orders:
                      </p>
                      <ul className="list-disc list-inside text-gray-400 space-y-1 ml-4">
                        <li>Upload signed PDFs from the field</li>
                        <li>System matches signed PDFs to existing work orders</li>
                        <li>Updates work order status to "SIGNED"</li>
                        <li>Stores signed PDFs and preview images</li>
                        <li>Prepares work orders for invoice generation</li>
                      </ul>
                      <div className="mt-4 flex gap-4">
                        <Link
                          href={ROUTES.signedUpload}
                          className="inline-flex items-center gap-2 text-yellow-400 hover:text-yellow-300 text-sm font-medium"
                        >
                          Upload Signed PDFs
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                        <Link
                          href={ROUTES.invoices}
                          className="inline-flex items-center gap-2 text-yellow-400 hover:text-yellow-300 text-sm font-medium"
                        >
                          View Invoices
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
