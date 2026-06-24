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

/** One meaning-ranked candidate for the host LLM to choose from. */
export interface ToolCandidate {
  /** The tool's `name`. */
  readonly tool: string;
  /** Relevance score, highest first. Scale depends on the ranker (BM25: unbounded; tfidf: cosine in [0,1]). */
  readonly score: number;
  /** The tool's `category`, or `null`. */
  readonly category: string | null;
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

const expand = (
  tokens: readonly string[],
  synonyms: Readonly<Record<string, readonly string[]>>,
): string[] => {
  const out: string[] = [...tokens];
  for (const t of tokens) {
    const syn = synonyms[t];
    if (syn !== undefined) out.push(...syn);
  }
  return out;
};

/** Build the per-tool document corpus: name (weighted) + description + keyword overlay. */
const buildDoc = (tool: Tool, nameWeight: number): string => {
  const nameWords = tool.name.replace(/_/g, ' ').replace(/\./g, ' ');
  const name = Array.from({ length: nameWeight }, () => nameWords).join(' ');
  return `${name} ${tool.description ?? ''} ${tool.keywords ?? ''}`;
};

interface Indexed {
  readonly tokens: string[];
  readonly tf: Map<string, number>;
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

  const names: string[] = [];
  const categories: (string | null)[] = [];
  const docs: Indexed[] = [];
  const df = new Map<string, number>();
  let totalLen = 0;

  for (const tool of tools) {
    const tokens = tokenize(buildDoc(tool, nameWeight), stopwords);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    names.push(tool.name);
    categories.push(tool.category ?? null);
    docs.push({ tokens, tf });
    totalLen += tokens.length;
  }

  const N = docs.length;
  const avgdl = N > 0 ? totalLen / N : 0;
  // BM25 idf (with +0.5 smoothing) and TF-IDF idf share the same df map.
  const idfBm25 = (term: string): number => {
    const n = df.get(term) ?? 0;
    return Math.log((N - n + 0.5) / (n + 0.5) + 1);
  };
  const idfTfidf = (term: string): number => Math.log((N + 1) / ((df.get(term) ?? 0) + 1)) + 1;

  // Pre-compute unit-normalized TF-IDF document vectors only if needed.
  const tfidfVecs: Map<string, number>[] = [];
  if (ranker === 'tfidf') {
    for (const { tokens, tf } of docs) {
      const vec = new Map<string, number>();
      let norm = 0;
      for (const [term, f] of tf) {
        const w = (f / (tokens.length || 1)) * idfTfidf(term);
        vec.set(term, w);
        norm += w * w;
      }
      norm = Math.sqrt(norm) || 1;
      for (const [term, w] of vec) vec.set(term, w / norm);
      tfidfVecs.push(vec);
    }
  }

  const search = (query: string, k = 8): ToolCandidate[] => {
    const qTokens = expand(tokenize(query, stopwords), synonyms);
    if (qTokens.length === 0) return [];

    const scored: ToolCandidate[] = [];

    if (ranker === 'bm25') {
      const qSet = new Set(qTokens);
      for (let i = 0; i < N; i++) {
        const { tokens, tf } = docs[i];
        const dl = tokens.length;
        let score = 0;
        for (const term of qSet) {
          const f = tf.get(term);
          if (f === undefined) continue;
          const idf = idfBm25(term);
          score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / (avgdl || 1)))));
        }
        if (score > 0) {
          scored.push({ tool: names[i], score: Math.round(score * 1000) / 1000, category: categories[i] });
        }
      }
    } else {
      const qtf = new Map<string, number>();
      for (const t of qTokens) qtf.set(t, (qtf.get(t) ?? 0) + 1);
      const qvec = new Map<string, number>();
      let qnorm = 0;
      for (const [term, f] of qtf) {
        const w = (f / qTokens.length) * idfTfidf(term);
        if (w > 0) { qvec.set(term, w); qnorm += w * w; }
      }
      qnorm = Math.sqrt(qnorm) || 1;
      if (qvec.size === 0) return [];
      for (let i = 0; i < N; i++) {
        const vec = tfidfVecs[i];
        let dot = 0;
        const [small, large] = qvec.size <= vec.size ? [qvec, vec] : [vec, qvec];
        for (const [term, w] of small) {
          const o = large.get(term);
          if (o !== undefined) dot += w * o;
        }
        if (dot > 0) {
          scored.push({ tool: names[i], score: Math.round((dot / qnorm) * 1000) / 1000, category: categories[i] });
        }
      }
    }

    scored.sort((x, y) => y.score - x.score || x.tool.localeCompare(y.tool));
    return scored.slice(0, k);
  };

  return { search };
};

export type Router = ReturnType<typeof createRouter>;
