import AppShell from "@/components/layout/AppShell";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";

export default function PrivacyPage() {
  const lastUpdated = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <AppShell>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href={ROUTES.legal}
            className="text-sm text-gray-400 hover:text-gray-300 underline underline-offset-4 transition-colors"
          >
            ← Back to Legal
          </Link>
          <Link
            href={ROUTES.free}
            className="text-sm text-blue-400 hover:text-blue-300 underline underline-offset-4 transition-colors"
          >
            Back to App →
          </Link>
        </div>

        <article className="prose prose-invert max-w-none">
          <h1 className="text-3xl font-semibold mb-2 text-white">Privacy Policy</h1>
          <p className="text-sm text-gray-400 mb-8 italic">
            Last Updated: {lastUpdated}
          </p>

          <div className="text-gray-300 space-y-6">
            <p>
              This service is currently intended for users located in the United States.
              If you access the Service from outside the U.S., you do so at your own risk.
            </p>
            <p>
              Thank you for using our Free Work Order Extractor ("Service").  
              This Privacy Policy explains what information we collect, how we use it, and how we protect it.

            </p>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">1. Information We Collect</h2>
              
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium text-white mb-2">1.1 Uploaded Files</h3>
                  <p>
                    When you upload a file (PDF or image), it is processed temporarily for extraction purposes only.  
                    <strong className="text-white"> We do not store your uploaded files or extracted data.</strong>  
                    All processing is done in memory and discarded after the extraction is complete.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-white mb-2">1.2 IP Address (Hashed)</h3>
                  <p>
                    To prevent abuse and enforce fair-use limits, we collect a <strong className="text-white">non-reversible hash</strong> of your IP address.
                  </p>
                  <p>
                    We do <strong className="text-white">not</strong> store your raw IP address.
                  </p>
                  <p>This hashed value is used solely to:</p>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>Apply daily usage limits</li>
                    <li>Apply monthly usage limits</li>
                    <li>Maintain service integrity</li>
                  </ul>
                  <p className="mt-2">No other tracking or profiling is performed.</p>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-white mb-2">1.3 Usage Metadata</h3>
                  <p>We may log minimal technical information such as:</p>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>Timestamp of extraction</li>
                    <li>Success or failure of processing</li>
                  </ul>
                  <p className="mt-2">
                    This helps diagnose issues and maintain system performance.  
                    No personal identifiers are included.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">2. How We Use Your Information</h2>
              <p>We use the information described above only for the following purposes:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Providing the extraction service</li>
                <li>Enforcing fair-use limits on the Free tier</li>
                <li>Preventing misuse or abuse of the Service</li>
                <li>Improving system reliability and performance</li>
              </ul>
              <p className="mt-2">
                We do <strong className="text-white">not</strong> sell, rent, or share your information with third parties.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">3. How AI Processing Works</h2>
              <p>
                Uploaded files are processed securely via our AI provider (e.g., OpenAI API).  
                Files are transmitted only for extraction and are not stored by us after the request is completed.
              </p>
              <p>
                We do <strong className="text-white">not</strong> use your content to train our models.
              </p>
              <p className="text-sm text-gray-400">
                Please refer to OpenAI's own data privacy policies for details on their retention practices.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">4. Data Retention</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>Hashed IP entries are retained only as long as needed to enforce usage limits (typically 30–60 days).</li>
                <li>Uploaded files and extracted content are <strong className="text-white">never stored</strong>.</li>
                <li>Technical logs (no personal data) may be retained briefly for maintenance.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">5. Cookies</h2>
              <p>
                The Free version does <strong className="text-white">not</strong> use cookies or tracking technologies.
              </p>
              <p>
                If you upgrade to a Pro or Premium plan, authentication cookies may be used for login sessions.  
                This policy applies specifically to the Free tool.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">6. Your Rights</h2>
              <p>
                If you are located in the EU, UK, or similar regions, you may have certain rights related to personal data.  
                Because we do not store personal data in the Free version (other than hashed IP), these rights generally do not apply beyond deletion of usage records.
              </p>
              <p>
                You may contact us at any time to request deletion of your hashed IP usage entry.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">7. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy occasionally.  
                If changes are significant, we will update the date above and display a notice on the website.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">8. Contact</h2>
              <p>
                If you have questions about this Privacy Policy, please contact:  
                <strong className="text-white"> support@example.com</strong>
              </p>
            </section>

            <p className="mt-8 text-gray-400">
              <strong>Thank you for using our Service.</strong>
            </p>
          </div>
        </article>
      </main>
    </AppShell>
  );
}

