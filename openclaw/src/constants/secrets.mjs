// Token-like text that never belongs in a comment the whole workspace reads.

export const MASK = "[redacted]";
export const MIN_MASKED_VALUE_LENGTH = 6;

export const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bopm_[A-Za-z0-9_]{16,}/g,
  /\bnpm_[A-Za-z0-9]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /(?<=\baws_secret_access_key\s*[=:]\s*["']?)[A-Za-z0-9/+=]{40}\b/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /(?<=\b(?:Bearer|Basic|Token)\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /(?<=:\/\/[^\s:/@]+:)[^\s@/]+(?=@)/g,
];
