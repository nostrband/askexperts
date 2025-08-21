export function str2arr(s: string, sep?: string) {
  return s
    .split(sep || ",")
    .map((s) => s.trim())
    .filter((s) => !!s);
}
