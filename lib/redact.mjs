// Best-effort secret redaction for exported transcripts. Patterns catch common
// token shapes; they cannot promise that nothing sensitive is left.

const MARK = "[REDACTED]";
const SECRET_KEY = /secret|token|passw|api[_-]?key|authorization|credential|private[_-]?key/i;

const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, MARK],
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, MARK],
  [/github_pat_[A-Za-z0-9_]{20,}/g, MARK],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/g, MARK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MARK],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, MARK],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, MARK],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, `Bearer ${MARK}`],
  [/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/g, `$1${MARK}@`],
  [/(\s(?:-u|--user)[ =])([^\s:]+):\S+/g, `$1$2:${MARK}`],
  [
    /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL|DATABASE_URL)[A-Za-z0-9_]*)(\s*[=:]\s*)(["']?)[^\s"']{8,}/gi,
    `$1$2$3${MARK}`,
  ],
];

export function redactString(s) {
  if (typeof s !== "string" || !s) return s;
  let out = s;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

export function redactValue(v, depth = 0, seen = new WeakSet()) {
  if (typeof v === "string") return redactString(v);
  if (v === null || typeof v !== "object") return v;
  if (depth > 40) return "[TRUNCATED]";
  if (seen.has(v)) return "[CYCLE]";
  seen.add(v);
  if (Array.isArray(v)) return v.map((x) => redactValue(x, depth + 1, seen));
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = SECRET_KEY.test(k) && (typeof x === "string" || typeof x === "number") ? MARK : redactValue(x, depth + 1, seen);
  }
  return out;
}
