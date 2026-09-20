"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { spawnRun } from "@/app/(app)/agents/actions";
import { Composer } from "@/components/agents/composer";
import { toast } from "@/components/ui/toast";
import type { Mode } from "@/lib/agents/modes";

/** Spawning from the index. Navigates as soon as the row exists — the run continues server-side. */
export function SpawnPanel({
  suggestions,
  modelName,
  runsToday,
}: {
  suggestions: string[];
  modelName: string;
  runsToday: number;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  return (
    <div data-tour="spawn">
      <Composer
        autoFocus
        pending={pending}
        suggestions={suggestions}
        modelName={modelName}
        runsToday={runsToday}
        onSubmit={async (task: string, mode: Mode) => {
          setPending(true);
          const result = await spawnRun(task, mode);
          setPending(false);
          if (result.ok) router.push(`/agents/${result.id}`);
          else toast.error("Could not start that run", { description: result.error });
        }}
      />
    </div>
  );
}
