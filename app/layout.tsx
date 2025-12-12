import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "@/components/auth/AuthProvider";
import Footer from "@/components/layout/Footer";
import { PlanProvider } from "@/lib/plan-context";

export const metadata: Metadata = {
  title: "Work Order Extractor 2.0",
  description: "Extract and manage work orders from emails and PDFs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <PlanProvider>{children}</PlanProvider>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
