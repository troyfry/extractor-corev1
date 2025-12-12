import Link from "next/link";
import AppShell from "@/components/layout/AppShell";

export default function LegalIndexPage() {
  const lastUpdated = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <AppShell>
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div></div>
          <Link
            href="/free"
            className="text-sm text-blue-400 hover:text-blue-300 underline underline-offset-4 transition-colors"
          >
            Back to App →
          </Link>
        </div>
        <h1 className="text-2xl font-semibold mb-2 text-white">Legal & Policies</h1>
        <p className="text-sm text-gray-400 mb-6">
          Last updated: {lastUpdated}
        </p>

        <p className="mb-6 text-sm text-gray-300">
          This section explains how the Work Order Extractor handles data, how the
          free tool may be used, and your rights as a user.
        </p>

        <section className="space-y-4">
          <div className="border border-gray-700 rounded-lg p-4 bg-gray-800">
            <h2 className="font-medium mb-1 text-white">Privacy Policy</h2>
            <p className="text-sm text-gray-400 mb-2">
              Learn what information we collect, how we use it, and how we protect it.
            </p>
            <Link
              href="/legal/privacy"
              className="text-sm font-medium text-blue-400 hover:text-blue-300 underline underline-offset-4 transition-colors"
            >
              View Privacy Policy
            </Link>
          </div>

          <div className="border border-gray-700 rounded-lg p-4 bg-gray-800">
            <h2 className="font-medium mb-1 text-white">Terms of Use</h2>
            <p className="text-sm text-gray-400 mb-2">
              Understand the rules for using the Free Work Order Extractor and any paid plans.
            </p>
            <Link
              href="/legal/terms"
              className="text-sm font-medium text-blue-400 hover:text-blue-300 underline underline-offset-4 transition-colors"
            >
              View Terms of Use
            </Link>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="font-medium mb-2 text-sm text-white">Summary</h2>
          <ul className="list-disc pl-5 text-sm text-gray-300 space-y-1">
            <li>The Free version does not store your files or extracted data.</li>
            <li>
              We use hashed IP addresses only to enforce fair-use limits and prevent abuse.
            </li>
            <li>
              AI processing is handled securely via our AI provider (e.g., OpenAI API).
            </li>
            <li>
              Additional terms may apply if you upgrade to a paid plan.
            </li>
          </ul>
        </section>

        <p className="mt-6 text-xs text-gray-500">
          Questions? Contact us at <span className="font-medium text-gray-400">support@example.com</span>.
        </p>
      </main>
    </AppShell>
  );
}
