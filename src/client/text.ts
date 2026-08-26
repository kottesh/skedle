// Text helpers.

const KNOWN_ACRONYMS = new Set([
  "AI",
  "ML",
  "IOT",
  "IT",
  "CS",
  "EEE",
  "ECE",
  "VLSI",
  "OS",
  "DBMS",
  "CGC",
  "II",
  "III",
  "IV",
]);

/**
 * Title-case a phrase without destroying acronyms. A word that is already
 * all-uppercase and recognized (or short and all-uppercase) is preserved.
 */
export function smartTitleCase(input: string): string {
  return String(input)
    .trim()
    .split(/\s+/)
    .map((word) => {
      const bare = word.replace(/[^A-Za-z0-9+#]/g, "");
      const upper = bare.toUpperCase();
      if (bare && bare === upper && (KNOWN_ACRONYMS.has(upper) || bare.length <= 3)) {
        return word;
      }
      // Preserve tokens that already mix case intentionally (e.g. "IoT", "C++").
      if (/[a-z]/.test(word) && /[A-Z]/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function firstName(name: string): string {
  const first = String(name).trim().split(/\s+/)[0] ?? "";
  return first.toLowerCase();
}

export function greetingWord(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "good morning";
  if (h < 17) return "good afternoon";
  return "good evening";
}
