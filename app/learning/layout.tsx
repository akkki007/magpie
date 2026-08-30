import type { Metadata } from "next";
import { Newsreader, JetBrains_Mono } from "next/font/google";
import { LearningHeader } from "@/components/learning/chrome";
import { searchIndex } from "@/learning";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Learn", template: "%s · Learn" },
  description: "Lessons generated from the Magpie codebase as it gets built.",
  robots: { index: false },
};

export default function LearningLayout({ children }: LayoutProps<"/learning">) {
  return (
    <div
      data-surface="learning"
      className={`${newsreader.variable} ${jetbrains.variable} min-h-screen bg-paper`}
    >
      <LearningHeader index={searchIndex()} />
      {children}
    </div>
  );
}
