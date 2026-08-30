import Link from "next/link";

import { Logo } from "@/components/ui/logo";

/**
 * The shell every auth screen sits in: one centred column, nothing else on the
 * page. No split-screen marketing panel and no illustration — the restraint is
 * the brand (docs/design-system.md, docs/auth-plan.md §7).
 *
 * This layout is a shell and nothing more. It does not check whether anyone is
 * signed in, because on Next 16 a layout cannot stop the page beneath it from
 * rendering or from shipping its data in the RSC payload.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-app px-6 py-16">
      <div className="w-full max-w-[400px]">
        <Link href="/" className="mb-8 flex justify-center">
          <Logo />
        </Link>
        {children}
      </div>
    </div>
  );
}
