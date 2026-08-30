import type { Metadata } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Hinato — trialling as the heading face. Ships as a single 400 weight, so never
 * set a bold weight on it: the browser would synthesise one and this face blobs
 * badly when it does.
 */
const hinato = localFont({
  src: "./fonts/Hinato.woff2",
  variable: "--font-hinato",
  weight: "400",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://magpie.app"),
  title: {
    default: "Magpie — the AI-native finance workspace",
    template: "%s · Magpie",
  },
  description:
    "Live data, AI forecasting, and collaboration in one modelling workspace. Spend less time fixing spreadsheets and more time shaping the plan.",
  openGraph: {
    title: "Magpie — the AI-native finance workspace",
    description:
      "Live data, AI forecasting, and collaboration in one modelling workspace.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      /* The script below adds a `js` class before hydration; the server never
         renders it, so the attribute mismatch here is expected. */
      suppressHydrationWarning
      className={`${inter.variable} ${interTight.variable} ${hinato.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/*
          Marks the document as JS-capable before the body paints. Scroll reveals hide
          themselves only under `.js`, so a failed or blocked bundle degrades to a
          fully visible page instead of a blank one.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js')",
          }}
        />
        {/*
          Resolves the theme before the first paint, so /learning never flashes
          white on the way to dark. It has to be inline and synchronous: anything
          deferred runs after the browser has already painted, which is the flash.
          Stored choice wins over the OS preference; a throw here must not take
          the page down, so the whole thing is wrapped.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=localStorage.getItem('magpie-theme');var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.add(d?'dark':'light')}catch(e){document.documentElement.classList.add('light')}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
