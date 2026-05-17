export const PROHIBITED_DATA_MESSAGE =
  "FlowPath does not need that level of detail. Please use a safer generalized version, such as a range or broad constraint.";

export class ProhibitedDataError extends Error {
  code = "prohibited_data";
  status = 400;

  constructor(public field?: string) {
    super(PROHIBITED_DATA_MESSAGE);
  }
}

function luhnCheck(value: string) {
  let sum = 0;
  let shouldDouble = false;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (Number.isNaN(digit)) return false;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum > 0 && sum % 10 === 0;
}

function hasLikelyPaymentCard(value: string) {
  const candidates = value.match(/(?:\d[ -]?){13,19}/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnCheck(digits);
  });
}

export function findProhibitedData(value: string) {
  const normalized = value.toLowerCase();

  if (/\b\d{3}-\d{2}-\d{4}\b/.test(value)) return "ssn";
  if (hasLikelyPaymentCard(value)) return "payment_card";
  if (
    /\b(?:ssn|social security|tax id|tin|ein|passport|driver'?s license|government id)\b[^.\n]{0,40}\b[a-z0-9-]{4,}\b/i.test(
      value,
    )
  ) {
    return "government_id";
  }
  if (/\b(?:routing|account|acct|bank account)\b[^.\n]{0,40}\d{4,}/i.test(value)) {
    return "bank_account";
  }
  if (
    /\b(?:password|passcode|bank login|login credential|2fa code|auth code)\b[^.\n]{0,40}[:=]/i.test(
      value,
    )
  ) {
    return "credential";
  }
  if (
    /\b(?:date of birth|birthdate|dob|born on)\b[^.\n]{0,30}(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i.test(
      value,
    )
  ) {
    return "exact_date_of_birth";
  }
  if (
    /\b\d{1,6}\s+(?:[a-z0-9.'-]+\s+){1,6}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl|way)\.?(?=\s|,|$)/i.test(
      value,
    )
  ) {
    return "exact_address";
  }
  if (
    normalized.includes("bank login") ||
    normalized.includes("bank password") ||
    normalized.includes("account password")
  ) {
    return "credential";
  }

  return null;
}

export function assertNoProhibitedData(value: string, field?: string) {
  if (findProhibitedData(value)) {
    throw new ProhibitedDataError(field);
  }
}

export function assertSafeTextFields(fields: Record<string, unknown>) {
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      assertNoProhibitedData(value, field);
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === "string") {
          assertNoProhibitedData(item, `${field}.${index}`);
        }
      });
    }
  }
}
