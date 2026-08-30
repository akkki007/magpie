"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * The shared parts of both auth forms. Auth screens are the first product
 * surface anyone touches, so they hold the design system exactly: 40px inputs,
 * one blue-600 button, errors inline under the field and never a toast.
 */

export function Field({
  label,
  name,
  type = "text",
  error,
  defaultValue,
  autoComplete,
  hint,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  error?: string;
  defaultValue?: string;
  autoComplete?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const errorId = `${name}-error`;

  const isPassword = type === "password";
  const [revealed, setRevealed] = useState(false);
  const RevealIcon = revealed ? EyeOff : Eye;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={name}
        className="text-[13px] font-medium text-ink-2"
      >
        {label}
      </label>

      <div className="relative">
        <input
          id={name}
          name={name}
          // Swapping the attribute is what every password manager expects; it
          // keeps autofill, autocomplete, and "save password" working, which a
          // hand-rolled masked text field would quietly break.
          type={isPassword && revealed ? "text" : type}
          defaultValue={defaultValue}
          autoComplete={autoComplete}
          // The browser's own validation is a convenience, never the check —
          // actions.ts re-validates every one of these on the server.
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "h-10 w-full rounded-control border bg-surface px-3 text-[14px] text-ink",
            "placeholder:text-ink-faint",
            "outline-none transition-[border-color,box-shadow] duration-150",
            "focus:border-blue-400 focus:ring-2 focus:ring-blue-200",
            // Room for the eye, but only when there is an eye.
            isPassword && "pr-10",
            error ? "border-neg-fg/50" : "border-line-strong",
          )}
          {...rest}
        />

        {isPassword && (
          <button
            // Not "submit". A bare <button> inside a form submits it, so
            // revealing the password would post the form instead.
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            // Hidden until the page proves it has JavaScript — the same `.js`
            // gate the scroll reveals use. A control that cannot work should
            // not be on screen at all, rather than sitting there doing nothing.
            className={cn(
              "absolute top-1 right-1 hidden h-8 w-8 place-items-center rounded-control",
              "text-ink-faint transition-colors hover:text-ink-muted",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200",
              "[.js_&]:grid",
            )}
            // The button's job is the *action*, so the label says what a press
            // will do. `aria-pressed` carries the current state separately.
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            aria-controls={name}
          >
            <RevealIcon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>

      {hint && !error && (
        <p className="text-[12px] text-ink-muted">{hint}</p>
      )}
      {error && (
        <p id={errorId} className="text-[12px] text-neg-fg">
          {error}
        </p>
      )}
    </div>
  );
}

/** A failure that belongs to the credentials as a pair, not to one field. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-control border border-neg-fg/20 bg-neg-bg px-3 py-2 text-[13px] text-neg-fg"
    >
      {message}
    </p>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  // `useFormStatus` reads the pending state of the enclosing <form>, which is
  // why this has to be its own component: a hook cannot see a form it is inside
  // of unless it renders below it.
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "h-10 w-full rounded-control bg-blue-600 text-[14px] font-medium text-white",
        "transition-colors duration-150 hover:bg-blue-700",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200",
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      {pending ? "One moment…" : children}
    </button>
  );
}
