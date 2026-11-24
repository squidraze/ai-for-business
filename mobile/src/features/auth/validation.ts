/**
 * Client-side rules, identical to the backend's. Each validator returns an
 * error code (translated as `validation.<code>`) or null.
 */

export type ValidationCode =
  | 'required'
  | 'invalid_email'
  | 'password_too_short'
  | 'password_too_long'
  | 'password_needs_letter'
  | 'password_needs_digit'
  | 'password_whitespace'
  | 'password_equals_email'
  | 'name_too_long'
  | 'passwords_mismatch'
  | 'invalid_code_format';

export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 100;
export const CODE_LENGTH = 6;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Any Unicode letter (Latin, Cyrillic…), like the backend; digits are ASCII 0-9.
const LETTER_RE = makeLetterRe();
const DIGIT_RE = /[0-9]/;

function makeLetterRe(): RegExp {
  try {
    return new RegExp('\\p{L}', 'u');
  } catch {
    // engines without Unicode property escapes: Latin (incl. accented) and Cyrillic
    return /[A-Za-zÀ-ɏЀ-ӿ]/;
  }
}

const CODE_RE = /^\d{6}$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string): ValidationCode | null {
  const email = normalizeEmail(value);
  if (!email) return 'required';
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return 'invalid_email';
  return null;
}

export function validatePassword(password: string, email = ''): ValidationCode | null {
  if (!password) return 'required';
  if (password.length < PASSWORD_MIN) return 'password_too_short';
  if (password.length > PASSWORD_MAX) return 'password_too_long';
  if (!LETTER_RE.test(password)) return 'password_needs_letter';
  if (!DIGIT_RE.test(password)) return 'password_needs_digit';
  if (password !== password.trim()) return 'password_whitespace';
  const normalized = normalizeEmail(email);
  if (normalized && password.toLowerCase() === normalized) return 'password_equals_email';
  return null;
}

/** Sign-in only checks that something was typed (strength is the server's business). */
export function validateLoginPassword(password: string): ValidationCode | null {
  return password ? null : 'required';
}

export function validateName(value: string): ValidationCode | null {
  const name = value.trim();
  if (!name) return 'required';
  if (name.length > NAME_MAX) return 'name_too_long';
  return null;
}

export function validateConfirm(password: string, confirm: string): ValidationCode | null {
  if (!confirm) return 'required';
  return confirm === password ? null : 'passwords_mismatch';
}

export function validateCode(value: string): ValidationCode | null {
  if (!value) return 'required';
  return CODE_RE.test(value) ? null : 'invalid_code_format';
}

/** Live checklist under the new-password field. */
export function passwordChecks(password: string) {
  return {
    length: password.length >= PASSWORD_MIN,
    letter: LETTER_RE.test(password),
    digit: DIGIT_RE.test(password),
  };
}
