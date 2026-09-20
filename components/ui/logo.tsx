import { cn } from "@/lib/cn";

/**
 * The Magpie mark: two stacked chevrons — a wing in ink, and the bird's blue
 * flash beneath it. Reads as a rising line at any size, which is the point.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("h-6 w-6", className)}
      fill="none"
    >
      <path
        d="M2.6 13.4 12 4l9.4 9.4h-4.7L12 8.7l-4.7 4.7H2.6Z"
        fill="#1c1c1c"
      />
      <path
        d="M6.4 20 12 14.4 17.6 20h-3.9L12 18.3 10.3 20H6.4Z"
        fill="var(--color-blue-400)"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Mark />
      {/* Wordmark stays on Inter Tight — the geometric mark needs a geometric
          companion, and Hinato's rounded terminals fight it at this size. */}
      <span className="font-display text-[17px] font-semibold tracking-[-0.02em] text-ink">
        Magpie
      </span>
    </span>
  );
}

/** The blue orb. Reserved for anything the machine did. */
export function Orb({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block rounded-full bg-[radial-gradient(circle_at_30%_25%,var(--color-orb-hi)_0%,var(--color-orb-to)_40%,var(--color-orb-from)_100%)]",
        className,
      )}
    />
  );
}
