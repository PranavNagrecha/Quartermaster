/**
 * @quartermaster/core — an offline, zero-dependency tool ranker.
 *
 * Turns "N tools" into a meaning-ranked SHORTLIST of ~K candidates for a
 * natural-language query, which the host LLM (already in the loop, free) then
 * reads and chooses from. It is an ADVISOR, not a decider — its job is to
 * surface the right tools to read, not to pick the final one.
 *
 * No neural embedding model is bundled: ranking is a classic bag-of-words IR
 * model (BM25 by default, TF-IDF cosine as an alternative) over a per-tool
 * document corpus, scored at query time. Fully offline, deterministic, zero
 * package weight, no network — which is the whole point versus an
 * embedding-backed competitor.
 *
 * An optional, configurable synonym layer expands the query so a question
 * phrased in business terms still lands on tools whose descriptions use the
 * technical vocabulary. With no synonyms supplied it is a pure lexical ranker.
 *
 * Heritage: extracted and generalized from sf-intelligence's
 * `semantic-funnel.ts`. What changed in the fork: (1) the tool corpus is
 * INJECTED (any MCP manifest), not imported from a Salesforce registry;
 * (2) synonyms + keyword overlays are CONFIG, not hard-coded domain data;
 * (3) BM25 is the default ranker (the heritage used TF-IDF cosine, which the
 * literature shows trails BM25 — both are kept).
 */

/** A tool to be indexed. Only `name` is required. */
export interface Tool {
  /** Canonical tool name, e.g. `github.create_issue`. The name is itself a strong signal. */
  readonly name: string;
  /** The tool's natural-language description (its MCP `description`). */
  readonly description?: string;
  /** Optional curated keyword overlay for tools whose description doesn't echo how people phrase the ask. */
  readonly keywords?: string;
  /** Optional grouping (e.g. originating server, capability area) — echoed back on each candidate. */
  readonly category?: string;
}

/** One query-term's contribution to a candidate's score (explain mode). */
export interface TermMatch {
  readonly term: string;
  readonly contribution: number;
}

/** One meaning-ranked candidate for the host LLM to choose from. */
export interface ToolCandidate {
  /** The tool's `name`. */
  readonly tool: string;
  /** Relevance score, highest first. Scale depends on the ranker (BM25: unbounded; tfidf: cosine in [0,1]). */
  readonly score: number;
  /** The tool's `category`, or `null`. */
  readonly category: string | null;
  /** Per-term score breakdown (desc by contribution) — present only when search is called with `{ explain: true }`. */
  readonly matches?: readonly TermMatch[];
}

export interface RouterConfig {
  /** `'bm25'` (default, Okapi BM25) or `'tfidf'` (heritage cosine). */
  readonly ranker?: 'bm25' | 'tfidf';
  /** Optional query-expansion map: token → related terms. Empty ⇒ pure lexical. */
  readonly synonyms?: Readonly<Record<string, readonly string[]>>;
  /** Override the default English stopword set. */
  readonly stopwords?: ReadonlySet<string>;
  /** How many times the tool NAME is repeated into its document (name carries intent). Default 2. */
  readonly nameWeight?: number;
  /** BM25 term-frequency saturation. Default 1.5. */
  readonly k1?: number;
  /** BM25 length-normalization. Default 0.75. */
  readonly b?: number;
  /** Weight of synonym-expanded query terms relative to originals (1.0). Default 0.5; `0` disables expansion. */
  readonly expansionWeight?: number;
}

/** Filler words that carry no routing signal. Small on purpose so domain terms survive. */
export const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are',
  'do', 'does', 'did', 'what', 'which', 'show', 'me', 'my', 'this', 'that',
  'these', 'those', 'how', 'where', 'when', 'who', 'whom', 'can', 'could', 'i',
  'it', 'its', 'have', 'has', 'had', 'with', 'from', 'get', 'give', 'list',
  'tell', 'about', 'all', 'any', 'our', 'we', 'us', 'you', 'your', 'be', 'been',
  'there', 'here', 'into', 'at', 'by', 'as', 'so', 'if', 'then', 'will',
]);

/**
 * Lowercase, fold apostrophes, split on non-word chars AND underscores (so
 * snake_case tool names break into words — `create_issue` → create, issue),
 * drop stopwords + 1-char tokens, then keep a light singular stem alongside
 * the plural (`issues` keeps both `issues` and `issue`) so plural queries match
 * singular names and vice-versa. Applied to query and corpus alike.
 */
export const tokenize = (text: string, stopwords: ReadonlySet<string> = DEFAULT_STOPWORDS): string[] => {
  const raw = text
    .toLowerCase()
    .replace(/[‘’ʼ']/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !stopwords.has(t));
  const out: string[] = [];
  for (const t of raw) {
    out.push(t);
    if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) out.push(t.slice(0, -1));
  }
  return out;
};

/**
 * Expand the query into a term→weight map. Original tokens get weight 1; each
 * synonym of an original gets `expansionWeight` UNLESS it is itself an original
 * (originals always win). A lower synonym weight lets expanded terms nudge the
 * ranking toward the right tool without washing out exact-term matches — which
 * the benchmark showed unweighted expansion does on rich corpora.
 */
const expandWeighted = (
  tokens: readonly string[],
  synonyms: Readonly<Record<string, readonly string[]>>,
  expansionWeight: number,
): Map<string, number> => {
  const w = new Map<string, number>();
  for (const t of tokens) w.set(t, 1);
  if (expansionWeight > 0) {
    for (const t of tokens) {
      const syn = synonyms[t];
      if (syn !== undefined) for (const s of syn) if (!w.has(s)) w.set(s, expansionWeight);
    }
  }
  return w;
};

/** Build the per-tool document corpus: name (weighted) + description + keyword overlay. */
const buildDoc = (tool: Tool, nameWeight: number): string => {
  const nameWords = tool.name.replace(/_/g, ' ').replace(/\./g, ' ');
  const name = Array.from({ length: nameWeight }, () => nameWords).join(' ');
  return `${name} ${tool.description ?? ''} ${tool.keywords ?? ''}`;
};

interface DocRecord {
  readonly name: string;
  readonly category: string | null;
  readonly tokens: string[];
  readonly tf: Map<string, number>;
  /** Unit-normalized TF-IDF vector; populated only when ranker === 'tfidf'. */
  tfidf?: Map<string, number>;
}

/**
 * Build a ranker over `tools`. The index is built once, eagerly; `search` is a
 * pure scan. Returns the top-`k` candidates (score > 0), highest first.
 */
export const createRouter = (tools: readonly Tool[], config: RouterConfig = {}) => {
  const ranker = config.ranker ?? 'bm25';
  const synonyms = config.synonyms ?? {};
  const stopwords = config.stopwords ?? DEFAULT_STOPWORDS;
  const nameWeight = config.nameWeight ?? 2;
  const k1 = config.k1 ?? 1.5;
  const b = config.b ?? 0.75;
  const expansionWeight = config.expansionWeight ?? 0.5;

  const records: DocRecord[] = [];
  const df = new Map<string, number>();
  let totalLen = 0;

  for (const tool of tools) {
    const tokens = tokenize(buildDoc(tool, nameWeight), stopwords);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    records.push({ name: tool.name, category: tool.category ?? null, tokens, tf });
    totalLen += tokens.length;
  }

  const N = records.length;
  const avgdl = N > 0 ? totalLen / N : 0;
  // BM25 idf (with +0.5 smoothing) and TF-IDF idf share the same df map.
  const idfBm25 = (term: string): number => {
    const n = df.get(term) ?? 0;
    return Math.log((N - n + 0.5) / (n + 0.5) + 1);
  };
  const idfTfidf = (term: string): number => Math.log((N + 1) / ((df.get(term) ?? 0) + 1)) + 1;

  // Pre-compute unit-normalized TF-IDF document vectors only if needed.
  if (ranker === 'tfidf') {
    for (const rec of records) {
      const vec = new Map<string, number>();
      let norm = 0;
      for (const [term, f] of rec.tf) {
        const w = (f / (rec.tokens.length || 1)) * idfTfidf(term);
        vec.set(term, w);
        norm += w * w;
      }
      norm = Math.sqrt(norm) || 1;
      for (const [term, w] of vec) vec.set(term, w / norm);
      rec.tfidf = vec;
    }
  }

  const search = (query: string, k = 8, opts: { explain?: boolean } = {}): ToolCandidate[] => {
    const explain = opts.explain ?? false;
    const qw = expandWeighted(tokenize(query, stopwords), synonyms, expansionWeight);
    if (qw.size === 0) return [];

    const scored: ToolCandidate[] = [];
    const r3 = (x: number): number => Math.round(x * 1000) / 1000;
    const push = (name: string, category: string | null, score: number, matches?: TermMatch[]): void => {
      if (score <= 0) return;
      scored.push(
        matches
          ? { tool: name, score: r3(score), category, matches: matches.sort((a, b) => b.contribution - a.contribution) }
          : { tool: name, score: r3(score), category },
      );
    };

    if (ranker === 'bm25') {
      for (const rec of records) {
        const dl = rec.tokens.length;
        let score = 0;
        const matches = explain ? ([] as TermMatch[]) : undefined;
        for (const [term, weight] of qw) {
          const f = rec.tf.get(term);
          if (f === undefined) continue;
          const c = weight * idfBm25(term) * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / (avgdl || 1)))));
          score += c;
          if (matches) matches.push({ term, contribution: r3(c) });
        }
        push(rec.name, rec.category, score, matches);
      }
    } else {
      const qvec = new Map<string, number>();
      let qnorm = 0;
      for (const [term, weight] of qw) {
        const w = weight * idfTfidf(term);
        if (w > 0) { qvec.set(term, w); qnorm += w * w; }
      }
      qnorm = Math.sqrt(qnorm) || 1;
      if (qvec.size === 0) return [];
      for (const rec of records) {
        const vec = rec.tfidf;
        if (vec === undefined) continue;
        let dot = 0;
        const matches = explain ? ([] as TermMatch[]) : undefined;
        for (const [term, w] of qvec) {
          const o = vec.get(term);
          if (o === undefined) continue;
          dot += w * o;
          if (matches) matches.push({ term, contribution: r3((w * o) / qnorm) });
        }
        push(rec.name, rec.category, dot / qnorm, matches);
      }
    }

    scored.sort((x, y) => y.score - x.score || x.tool.localeCompare(y.tool));
    return scored.slice(0, k);
  };

  return { search };
};

export type Router = ReturnType<typeof createRouter>;
