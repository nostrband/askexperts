export function str2arr(s: string | undefined, sep?: string) {
  if (!s) return [];
  return s
    .split(sep || ",")
    .map((s) => s.trim())
    .filter((s) => !!s);
}
