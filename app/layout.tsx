import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OnboardPilot — understand any codebase before lunch",
  description:
    "OnboardPilot turns an unfamiliar GitHub repository into a verified onboarding map: architecture, execution traces, house rules, risk radar, first tasks and a seven-step ramp-up plan. Every claim cites the file it came from.",
  applicationName: "OnboardPilot",
  keywords: [
    "developer onboarding",
    "codebase comprehension",
    "AI agents",
    "IBM Bob",
    "IBM Bob 2.0 Hackathon",
    "developer workflow",
  ],
  openGraph: {
    title: "OnboardPilot — understand any codebase before lunch",
    description:
      "Paste a GitHub repository URL, get an evidence-backed onboarding map in under a minute.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
