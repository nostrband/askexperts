export function str2arr(s: string | undefined, sep?: string) {
  if (!s || !s.trim()) return undefined;
  return s
    .split(sep || ",")
    .map((s) => s.trim())
    .filter((s) => !!s);
}
