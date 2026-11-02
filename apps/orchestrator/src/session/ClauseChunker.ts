/**
 * Splits a streaming LLM reply into TTS chunks, growing in size:
 * - 1st chunk: first clause boundary with ≥ firstMinWords, or a hard cut after firstMaxWords. Fast first audio.
 * - 2nd chunk: next clause boundary with ≥ secondMinWords — ready before the short 1st chunk finishes playing.
 * - Later: whole sentences with ≥ nextMinWords (or the remainder at the end). Better prosody and
 *   fewer TTS flushes (each chunk is synthesized independently).
 * A boundary is punctuation followed by whitespace, so "Skit.ai" and "1.30" never split.
 */
export interface ClauseChunkerOptions {
  firstMinWords: number;
  firstMaxWords: number;
  secondMinWords: number;
  nextMinWords: number;
}

const DEFAULTS: ClauseChunkerOptions = { firstMinWords: 2, firstMaxWords: 10, secondMinWords: 6, nextMinWords: 15 };
const CLAUSE_END = /[,;:.!?…—–](?=\s)/g;
const SENTENCE_END = /[.!?…](?=\s)/g;

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** Strip markdown the model shouldn't produce anyway (TTS would read it out). */
const clean = (s: string) => s.replace(/[*_#`]/g, "").replace(/\s+/g, " ").trim();

export class ClauseChunker {
  private buf = "";
  private emitted = 0;
  private readonly opts: ClauseChunkerOptions;

  constructor(opts: Partial<ClauseChunkerOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Add an LLM text delta; returns any chunks that are ready. */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (let cut = this.findCut(); cut > 0; cut = this.findCut()) {
      const chunk = clean(this.buf.slice(0, cut));
      this.buf = this.buf.slice(cut);
      if (chunk) {
        out.push(chunk);
        this.emitted++;
      }
    }
    return out;
  }

  /** End of the LLM stream: whatever is left. */
  flush(): string[] {
    const rest = clean(this.buf);
    this.buf = "";
    if (!rest) return [];
    this.emitted++;
    return [rest];
  }

  private findCut(): number {
    const first = this.emitted === 0;
    const re = this.emitted < 2 ? CLAUSE_END : SENTENCE_END;
    const minWords = [this.opts.firstMinWords, this.opts.secondMinWords][this.emitted] ?? this.opts.nextMinWords;
    re.lastIndex = 0;
    for (let m = re.exec(this.buf); m; m = re.exec(this.buf)) {
      const end = m.index + 1;
      if (wordCount(this.buf.slice(0, end)) >= minWords) return end;
    }
    if (first) {
      const words = [...this.buf.matchAll(/\S+\s+/g)];
      const nth = words[this.opts.firstMaxWords - 1];
      if (nth) return nth.index! + nth[0].length;
    }
    return -1;
  }
}
