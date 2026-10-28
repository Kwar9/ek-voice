const PAUSE_RE = /<break\s+time\s*=\s*(['"])(0\.5|1|1\.5|2)s\1\s*\/>/gi;
const MARKER_PREFIX = "EKVOICEPAUSE";

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function stripPauseTags(text: string) {
  return text.replace(PAUSE_RE, " … ").replace(/\s+/g, " ").trim();
}

export function toGoogleSsml(text: string) {
  let sequence = 0;
  const pauses: Record<string, string> = {};
  const staged = text.replace(PAUSE_RE, (_tag, _quote, duration: string) => {
    const marker = `${MARKER_PREFIX}${sequence++}TOKEN`;
    pauses[marker] = `<break time="${duration}s"/>`;
    return marker;
  });
  let output = escapeXml(staged);
  for (const [marker, tag] of Object.entries(pauses)) output = output.replace(marker, tag);
  return `<speak>${output}</speak>`;
}

function ssmlBytes(text: string) {
  return Buffer.byteLength(toGoogleSsml(text), "utf8");
}

function splitOversizedSegment(segment: string, maxBytes: number, measure: (value: string) => number): string[] {
  const words = segment.match(/\S+\s*/gu) ?? [segment];
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current + word;
    if (current && measure(candidate) > maxBytes) {
      result.push(current);
      current = word;
    } else current = candidate;
    if (measure(current) > maxBytes) {
      // A single unusually long token is split by Unicode code point, never by UTF-16 code unit.
      let piece = "";
      for (const char of Array.from(current)) {
        if (piece && measure(piece + char) > maxBytes) {
          result.push(piece);
          piece = char;
        } else piece += char;
      }
      current = piece;
    }
  }
  if (current) result.push(current);
  return result;
}

export function splitGoogleText(text: string, maxBytes = 4300): string[] {
  // Protect pause tags before sentence splitting: decimal values such as 0.5s must not be split at the dot.
  const durations: string[] = [];
  const staged = text.replace(PAUSE_RE, (_tag, _quote, duration: string) => {
    const marker = `${MARKER_PREFIX}${durations.length}TOKEN`;
    durations.push(duration);
    return ` ${marker} `;
  }).replace(/\r\n/g, "\n");
  const restore = (value: string) => value.replace(/EKVOICEPAUSE(\d+)TOKEN/g, (_marker, index: string) => `<break time='${durations[Number(index)]}s'/>`);
  const measure = (value: string) => ssmlBytes(restore(value));

  // Keep sentence-ending punctuation and whitespace with each unit where possible.
  const units = staged.match(/[^.!?。！？\n]+[.!?。！？]*\n*|\n+/gu) ?? [staged];
  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    if (!unit) continue;
    if (current && measure(current + unit) > maxBytes) {
      chunks.push(current);
      current = "";
    }
    if (measure(unit) > maxBytes) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitOversizedSegment(unit, maxBytes, measure));
    } else current += unit;
  }

  if (current) chunks.push(current);
  return chunks.map(restore).filter((chunk) => chunk.trim().length > 0);
}

export function splitPlainText(text: string, maxChars: number): string[] {
  const units = text.match(/[^.!?。！？\n]+[.!?。！？]*\n*|\n+/gu) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + unit.length > maxChars) {
      chunks.push(current);
      current = "";
    }
    if (unit.length > maxChars) {
      const words = unit.match(/\S+\s*/gu) ?? [unit];
      for (const word of words) {
        if (current && current.length + word.length > maxChars) {
          chunks.push(current);
          current = "";
        }
        current += word;
      }
    } else current += unit;
  }
  if (current) chunks.push(current);
  return chunks.filter((chunk) => chunk.trim().length > 0);
}
