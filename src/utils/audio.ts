import type { AlignedSegment } from '../types';

export function float32ToInt16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function parseTimestampToSeconds(ts: string): number {
  const clean = ts.replace(/[\[\]]/g, '').trim();
  const parts = clean.split(':').map((n) => Number.parseInt(n, 10));
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

/**
 * Progressively parses streaming @@SEG MM:SS / SPEECH: / MEANING: blocks
 * into 1-to-1 timed AlignedSegment items.
 */
export function parseAlignedStream(rawText: string): AlignedSegment[] {
  if (!rawText.trim()) return [];

  const blocks = rawText.split(/@@SEG\s+/);
  const segments: AlignedSegment[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    const firstNewline = block.indexOf('\n');
    const rawHeader = (firstNewline === -1 ? block : block.slice(0, firstNewline)).trim();
    const tsMatch = rawHeader.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (!tsMatch) continue;

    const timestamp = tsMatch[1];
    const body = firstNewline === -1 ? '' : block.slice(firstNewline + 1);

    const speechMatch = body.match(/SPEECH:\s*([\s\S]*?)(?=\n\s*MEANING:|$)/i);
    const meaningMatch = body.match(/MEANING:\s*([\s\S]*)$/i);

    const speech = speechMatch ? speechMatch[1].trim() : '';
    const meaning = meaningMatch ? meaningMatch[1].trim() : '';

    if (speech || meaning) {
      segments.push({
        id: `seg-${i}-${timestamp}`,
        timestamp,
        seconds: parseTimestampToSeconds(timestamp),
        speech,
        meaning,
        isInterpreting: Boolean(speech && !meaning),
      });
    }
  }

  return segments;
}

/**
 * Parses re-aligned @@SEG MM:SS / MEANING: stream onto existing timed segments
 * without altering the original speech text.
 */
export function applyAlignedMeanings(
  existing: AlignedSegment[],
  rawMeaningStream: string
): AlignedSegment[] {
  if (existing.length === 0) return existing;

  const blocks = rawMeaningStream.split(/@@SEG\s+/);
  const parsedByIndex: string[] = [];
  const parsedByTs = new Map<string, string>();

  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;
    const firstNewline = block.indexOf('\n');
    const header = (firstNewline === -1 ? block : block.slice(0, firstNewline)).trim();
    const tsMatch = header.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    const body = firstNewline === -1 ? '' : block.slice(firstNewline + 1);
    const meaningMatch = body.match(/(?:MEANING:\s*)?([\s\S]*)$/i);
    const meaning = meaningMatch ? meaningMatch[1].trim() : '';
    if (meaning) {
      parsedByIndex.push(meaning);
      if (tsMatch) {
        parsedByTs.set(tsMatch[1], meaning);
      }
    }
  }

  return existing.map((seg, idx) => {
    const updatedMeaning = parsedByTs.get(seg.timestamp) ?? parsedByIndex[idx] ?? '';
    return {
      ...seg,
      meaning: updatedMeaning,
      isInterpreting: updatedMeaning.length === 0,
    };
  });
}

export function segmentsToTranscriptText(segments: AlignedSegment[]): string {
  return segments
    .filter((s) => s.speech.trim())
    .map((s) => `[${s.timestamp}] ${s.speech}`)
    .join('\n');
}

export function segmentsToMeaningText(segments: AlignedSegment[]): string {
  return segments
    .filter((s) => s.meaning.trim())
    .map((s) => `[${s.timestamp}] ${s.meaning}`)
    .join('\n');
}

export function segmentsToMarkdown(segments: AlignedSegment[], directive: string): string {
  const rows = segments
    .map(
      (s) =>
        `### [${s.timestamp}]\n- **Original Speech:** ${s.speech || '—'}\n- **Directive Meaning:** ${s.meaning || '—'}`
    )
    .join('\n\n');

  return `# Lenscript Session Notes\n\n**Directive:** ${directive}\n**Exported:** ${new Date().toLocaleString()}\n\n---\n\n${rows}`;
}

export function base64ToFile(base64: string, filename: string, mimeType: string): File {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return new File([blob], filename, { type: mimeType });
}
