import AppShell from "@/components/layout/AppShell";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";

export default function TermsPage() {
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
          <h1 className="text-3xl font-semibold mb-2 text-white">Terms of Use</h1>
          <p className="text-sm text-gray-400 mb-8 italic">
            Last Updated: {lastUpdated}
          </p>

          <div className="text-gray-300 space-y-6">
            <p>
              Welcome to the Free Work Order Extractor ("Service").  
              By using this Service, you agree to the following Terms of Use.
            </p>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">1. Acceptable Use</h2>
              <p>You agree to use the Service responsibly and only for lawful purposes.  
              You must not:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Attempt to bypass free usage limits</li>
                <li>Automate or script high-volume extraction requests</li>
                <li>Upload harmful, malicious, or copyrighted material that you do not have the right to process</li>
                <li>Attempt to reverse-engineer or interfere with the Service</li>
              </ul>
              <p className="mt-2">
                We reserve the right to limit or block use if misuse is detected.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">2. Free Tier Limitations</h2>
              <p>The Free tier includes:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Limited number of extractions per day/month</li>
                <li>No login required</li>
                <li>No data storage or history</li>
                <li>No guaranteed uptime or support</li>
              </ul>
              <p className="mt-2">
                If you require persistent history, higher limits, or integrations, please upgrade to a paid plan.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">3. AI Processing Disclaimer</h2>
              <p>
                The Service uses third-party AI providers to extract information from uploaded files.  
                While we aim for accuracy, <strong className="text-white">AI outputs may contain errors</strong>.
              </p>
              <p>You agree that:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Extracted results should be reviewed before use</li>
                <li>We are not responsible for incorrect or incomplete extractions</li>
                <li>The Service is provided on an "as-is" basis</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">4. No Warranty</h2>
              <p>
                The Service is provided "as-is" without warranties of any kind.  
                We do not guarantee accuracy, availability, or fitness for any purpose.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">5. Limitation of Liability</h2>
              <p>To the fullest extent permitted by law:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>We are not liable for any damages resulting from use or inability to use the Service</li>
                <li>We are not liable for losses due to inaccurate AI outputs</li>
                <li>Your use of this tool is at your own risk</li>
              </ul>
              <p className="mt-2">
                If you do not agree with these terms, please discontinue use of the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">6. Modifications to the Service</h2>
              <p>
                We may modify, suspend, or discontinue the Free version at any time without notice.  
                Paid users will be notified of material changes affecting their plan.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">7. Governing Law</h2>
              <p>
                These Terms are governed by the laws of the state or region where we operate.  
                Any disputes must be handled in the applicable local courts or arbitration venues.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mt-8 mb-4">8. Contact</h2>
              <p>
                If you have questions regarding these Terms, please contact:  
                <strong className="text-white"> support@example.com</strong>
              </p>
            </section>

            <p className="mt-8 text-gray-400">
              <strong>By using this Service, you acknowledge and agree to these Terms of Use.</strong>
            </p>
          </div>
        </article>
      </main>
    </AppShell>
  );
}

