"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "#modelling", label: "Modelling" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#features", label: "Features" },
  { href: "#agents", label: "Agents" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-colors duration-150",
        scrolled
          ? "border-b border-line bg-app/85 backdrop-blur-md"
          : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-8 px-6">
        <Link href="/" aria-label="Magpie home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[13.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden rounded-button px-3 py-2 text-[13.5px] text-ink-muted transition-colors duration-150 hover:text-ink sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="btn-primary px-3.5 py-2 text-[13.5px] font-medium"
          >
            Start free
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="grid h-9 w-9 place-items-center rounded-button text-ink-muted md:hidden"
          >
            {open ? <X className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-line bg-app px-6 py-3 md:hidden">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-2.5 text-[14px] text-ink-2"
            >
              {l.label}
            </a>
          ))}
          <Link href="/sign-in" className="block py-2.5 text-[14px] text-ink-2">
            Sign in
          </Link>
        </div>
      ) : null}
    </header>
  );
}
