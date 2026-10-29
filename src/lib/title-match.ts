/**
 * Title similarity, used as a second check next to the SKU: two products with the same SKU only count as
 * the same product when their titles also look alike. Words shared by most titles ("handcrafted", "home",
 * "decor") carry almost no weight; rare words (the product name) and the size decide.
 */

/**
 * When a SKU is shared by several products, the pair must score at least this. Low on purpose: your store
 * often retitles a product completely, so this only rules out clearly different products.
 */
export const MIN_TITLE_SCORE = 0.1;
/** A SKU match that is not shared is kept, but a score below this is flagged for a human to check. */
export const WARN_TITLE_SCORE = 0.05;
/** Two target products sharing a SKU count as look-alikes when their scores are this close. */
export const TITLE_AMBIGUITY_MARGIN = 0.08;

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(inch(?:es)?|in|cm|mm|ft|feet|ml|l|kg|g)\b/g;
const FILLER = new Set(["a", "an", "and", "the", "of", "for", "with", "in", "to", "by", "on", "piece", "pieces", "pc", "pcs", "set"]);

export interface TitleModel {
  /** Weight of a token: rare in the catalog = high, in nearly every title = about 0 */
  weight: (token: string) => number;
}

interface Parsed {
  words: Set<string>;
  /** Lengths in inches (cm converted), other measures as "<number><unit>" */
  sizes: Set<string>;
}

const toSize = (n: number, unit: string): string => {
  if (unit === "cm") return `in:${n / 2.54}`;
  if (unit === "mm") return `in:${n / 25.4}`;
  if (unit === "ft" || unit === "feet") return `in:${n * 12}`;
  if (unit.startsWith("inch") || unit === "in") return `in:${n}`;
  return `${unit}:${n}`;
};

/** Sizes agree when they are the same unit family and within 12% (a "16 cm" product is a "6.3 inch" one). */
const sameSize = (a: string, b: string): boolean => {
  const [ua, va] = a.split(":");
  const [ub, vb] = b.split(":");
  if (ua !== ub) return false;
  const x = Number(va);
  const y = Number(vb);
  return Math.abs(x - y) <= 0.12 * Math.max(x, y);
};

const strip = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // décor -> decor
    .toLowerCase()
    .replace(/&/g, " and ");

function parse(title: string): Parsed {
  const text = strip(title);
  const sizes = new Set<string>();
  const rest = text.replace(SIZE_RE, (_m, n: string, unit: string) => {
    sizes.add(toSize(Number(n), unit));
    return " ";
  });
  const words = new Set(
    rest
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 1 && !FILLER.has(w) && !/^\d+$/.test(w)),
  );
  return { words, sizes };
}

/** Learns how common each word is across every title on both stores. */
export function buildTitleModel(titles: string[]): TitleModel {
  const df = new Map<string, number>();
  for (const t of titles) for (const w of parse(t).words) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(1, titles.length);
  return { weight: (w) => Math.log(1 + n / (df.get(w) ?? 1)) ** 2 };
}

/** 0..1, how alike two titles are. 1 when either title has nothing to compare (nothing to disprove). */
export function titleScore(model: TitleModel, a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (pa.words.size === 0 || pb.words.size === 0) return 1;
  const sum = (ws: Iterable<string>) => [...ws].reduce((acc, w) => acc + model.weight(w), 0);
  const shared = sum([...pa.words].filter((w) => pb.words.has(w)));
  let score = shared / Math.max(1e-9, Math.min(sum(pa.words), sum(pb.words)));
  // The same name in a different size is a different product (and a different stock count).
  const bothSized = pa.sizes.size > 0 && pb.sizes.size > 0;
  if (bothSized && ![...pa.sizes].some((a) => [...pb.sizes].some((b) => sameSize(a, b)))) score *= 0.4;
  return Math.min(1, score);
}

export interface Ranked<T> {
  value: T;
  title: string;
  score: number;
}

/** Candidates ordered best title first. */
export function rankByTitle<T>(model: TitleModel, title: string, candidates: { title: string; value: T }[]): Ranked<T>[] {
  return candidates
    .map((c) => ({ ...c, score: titleScore(model, title, c.title) }))
    .sort((x, y) => y.score - x.score);
}
