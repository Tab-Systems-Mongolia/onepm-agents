import {
  MASK,
  MIN_MASKED_VALUE_LENGTH,
  SECRET_PATTERNS,
} from "../constants/secrets.mjs";

// Exact values first (the agent key itself), longest first; then the
// patterns, which can match inside one.
export const maskSecrets = (text, knownValues = []) =>
  SECRET_PATTERNS.reduce(
    (masked, pattern) => masked.replace(pattern, MASK),
    knownValues
      .filter((value) => value && value.length >= MIN_MASKED_VALUE_LENGTH)
      .toSorted((a, b) => b.length - a.length)
      .reduce((masked, value) => masked.replaceAll(value, MASK), text),
  );
