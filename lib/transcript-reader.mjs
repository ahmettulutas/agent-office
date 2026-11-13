// Streams a Claude Code transcript (JSONL) without loading it whole. Real
// transcripts reach hundreds of MB, so a line and a file cap apply: a longer
// file is read from its tail, and a longer line is skipped and counted.

import fs from "node:fs";

export const MAX_LINE = 1024 * 1024;
export const MAX_BYTES = 64 * 1024 * 1024;

export async function* readTranscript(file, { maxLine = MAX_LINE, maxBytes = MAX_BYTES, from = 0, stats = {} } = {}) {
  stats.bad = 0;
  stats.tooLong = 0;
  stats.truncated = false;
  const size = (await fs.promises.stat(file)).size;
  // `from` is a line boundary the caller got from stats.offset
  const begin = Math.min(Math.max(0, from), size);
  const cut = size - begin > maxBytes;
  const start = cut ? size - maxBytes : begin;
  stats.truncated = cut;
  stats.offset = begin; // the end of the last complete line read
  let dropFirst = cut; // the cut lands mid-line
  let base = start;
  let parts = [];
  let len = 0;
  let skipping = false;

  const line = (buf) => {
    if (!buf.length || (buf.length === 1 && buf[0] === 13)) return undefined;
    try {
      const rec = JSON.parse(buf.toString("utf8"));
      return rec && typeof rec === "object" ? rec : undefined;
    } catch {
      stats.bad++;
      return undefined;
    }
  };

  for await (const chunk of fs.createReadStream(file, { start, highWaterMark: 256 * 1024 })) {
    let at = 0;
    while (at <= chunk.length) {
      const nl = chunk.indexOf(10, at);
      const end = nl < 0 ? chunk.length : nl;
      const piece = chunk.subarray(at, end);
      if (!dropFirst && !skipping) {
        if (len + piece.length > maxLine) {
          skipping = true;
          stats.tooLong++;
          parts = [];
          len = 0;
        } else if (piece.length) {
          parts.push(piece);
          len += piece.length;
        }
      }
      if (nl < 0) break;
      // a full line ended here
      if (dropFirst) dropFirst = false;
      else if (skipping) skipping = false;
      else {
        const rec = line(parts.length === 1 ? parts[0] : Buffer.concat(parts));
        if (rec) yield rec;
      }
      parts = [];
      len = 0;
      at = nl + 1;
      stats.offset = base + at;
    }
    base += chunk.length;
  }
  if (!dropFirst && !skipping && len) {
    const rec = line(Buffer.concat(parts));
    if (rec) yield rec;
  }
}
