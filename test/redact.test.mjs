// Redaction is best-effort: every pattern has a hit and a near miss that must stay.

import { test } from "node:test";
import assert from "node:assert/strict";
import { redactString, redactValue } from "../lib/redact.mjs";

const hits = {
  anthropic: "key sk-ant-api03-AbCdEfGh1234567890_-xyz end",
  github: "ghp_" + "a".repeat(36),
  githubPat: "github_pat_" + "B1_".repeat(12),
  aws: "AKIAIOSFODNN7EXAMPLE",
  slack: "xoxb-1234567890-abcdefghij",
  bearer: "Authorization: Bearer abcdef0123456789ABCDEF.tok-en",
  pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----",
  urlCreds: "git clone https://alice:hunter2pass@example.com/repo.git",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r",
  keyValue: "STRIPE_SECRET=abcd1234efgh5678",
  quotedKey: 'config api_key = "my-long-api-key-value"',
  envLine: "DATABASE_URL=postgres-thing-long-enough",
};
const SECRET = /sk-ant-api03|ghp_a|github_pat_B1|AKIAIOSFODNN7|xoxb-123|abcdef0123456789|MIIEow|hunter2pass|dBjftJeZ|abcd1234efgh|my-long-api-key|postgres-thing/;

test("every secret pattern is redacted", () => {
  for (const [name, text] of Object.entries(hits)) {
    const out = redactString(text);
    assert.equal(SECRET.test(out), false, `${name} leaked: ${out}`);
    assert.ok(out.includes("[REDACTED"), `${name} left no marker: ${out}`);
  }
});

test("near misses stay as they are", () => {
  for (const ok of [
    "The Bearer token is sent in a header",
    "use sk-learn for models",
    "NODE_ENV=dev",
    "ghp_short",
    "https://example.com/path?a=1",
    "https://example.com:8080/x",
    "an email me@example.com is not a secret",
    "token: the thing we count",
    "AKIA is a prefix",
    "eyJ not a jwt",
  ]) {
    assert.equal(redactString(ok), ok, `changed: ${ok}`);
  }
});

test("the url keeps its host and only the credentials go", () => {
  assert.equal(redactString("https://alice:hunter2pass@example.com/r.git"), "https://[REDACTED]@example.com/r.git");
});

test("redactValue walks objects and arrays and hides the value of a secret-named key", () => {
  const out = redactValue({ api_key: "short", nested: { list: ["ok", "Bearer abcdef0123456789ABCDEF"], password: 12345 }, n: 3, b: true, z: null });
  assert.equal(out.api_key, "[REDACTED]");
  assert.equal(out.nested.password, "[REDACTED]");
  assert.equal(out.nested.list[0], "ok");
  assert.equal(out.nested.list[1].includes("abcdef0123456789"), false);
  assert.deepEqual([out.n, out.b, out.z], [3, true, null]);
});

test("redactValue survives a cycle and very deep input", () => {
  const a = { x: 1 };
  a.self = a;
  assert.doesNotThrow(() => redactValue(a));
  let deep = "leaf";
  for (let i = 0; i < 500; i++) deep = { d: deep };
  assert.doesNotThrow(() => redactValue(deep));
});
