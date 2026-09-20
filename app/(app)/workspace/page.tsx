import { redirect } from "next/navigation";

/**
 * `/workspace` predates `/models/[slug]` (M1.4). It stays as a redirect rather than being
 * deleted: it is in the rail, in the sign-in `next` parameter of anyone's open tab, and in
 * every note written while the model was a fixture. A redirect costs one file.
 */
export default function WorkspacePage() {
  redirect("/models/revenue-model-2026");
}
