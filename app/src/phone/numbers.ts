export const COUNTRY_CODES = ["+1", "+44", "+91", "+61", "+81"] as const;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function toE164(prefix: string, digits: string): string {
  return `${prefix}${digitsOnly(digits)}`;
}

export function isCallableNumber(e164: string): boolean {
  const digits = digitsOnly(e164);
  return digits.length >= 8 && digits.length <= 15;
}

export function presentRemote(remote?: string): string {
  if (!remote) return "Unknown number";
  const digits = digitsOnly(remote);
  if (remote.startsWith("+1") && digits.length === 11) {
    return `+1 ${formatDisplay("+1", digits.slice(1))}`;
  }
  return remote;
}

export function formatDisplay(prefix: string, digits: string): string {
  const clean = digitsOnly(digits);
  if (prefix === "+1") {
    const area = clean.slice(0, 3);
    const mid = clean.slice(3, 6);
    const last = clean.slice(6, 10);
    if (!area) return "";
    if (clean.length <= 3) return `(${area}`;
    if (clean.length <= 6) return `(${area}) ${mid}`;
    return `(${area}) ${mid}-${last}`;
  }
  return clean.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}
