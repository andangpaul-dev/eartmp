/**
 * Matricule check-digit schemes (WS C). Pure functions.
 * - luhn: standard mod-10 over the DECIMAL digits of the body (letters ignored).
 * - mod97: ISO 7064 MOD 97-10 over the ALPHANUMERIC body (A-Z → 10..35), 2 digits.
 */
export type CheckScheme = "none" | "luhn" | "mod97";

export function luhnDigit(body: string): string {
  const digits = body.replace(/\D/g, "");
  let sum = 0;
  let dbl = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return String((10 - (sum % 10)) % 10);
}

export function mod97Digits(body: string): string {
  let numeric = "";
  for (const ch of body.toUpperCase()) {
    if (ch >= "0" && ch <= "9") numeric += ch;
    else if (ch >= "A" && ch <= "Z") numeric += String(ch.charCodeAt(0) - 55);
  }
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
  const check = (98 - ((rem * 100) % 97)) % 97;
  return String(check).padStart(2, "0");
}

export function computeCheck(scheme: CheckScheme, body: string): string {
  if (scheme === "luhn") return luhnDigit(body);
  if (scheme === "mod97") return mod97Digits(body);
  return "";
}
