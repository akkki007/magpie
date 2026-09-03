/**
 * The two-letter avatar in the rail. Extracted from the models page when the databases
 * pages needed the identical function — three copies of "how do we abbreviate a person"
 * is how two of them quietly drift apart.
 */
export function initialsOf(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}
