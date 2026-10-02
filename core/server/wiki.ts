//! The program directory: Wikipedia, read as a catalogue of software.
//!
//! A guest who is not one of the story's named programs picks *any* piece
//! of software to be tonight — "NHL 97", "Winamp", "MS Paint" — and the
//! article's picture becomes their profile picture. This module is the
//! only place the server talks to Wikipedia: a search steered at software
//! (CirrusSearch `hastemplate:` filters for the software / video-game /
//! website infoboxes, so "Norton" finds Norton Commander and not the
//! actor), and a summary lookup that turns a title into its lead image.
//!
//! Antivirus software is never offered to a guest: in *Trapped in the
//! Internet* the Antivirus are the enforcers, and a program that shows up
//! calling itself McAfee is a costume problem for the whole night. The
//! rule is part of the catalogue rather than the story, so it holds for
//! every search result (`isAntivirusSoftware`), and the runtime applies
//! it again when the name is registered.
//!
//! Everything is memoised and the fetch is injectable, so tests never
//! touch the network and a busy join screen never repeats a query.

const API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "LoomPlay/1.0 (https://github.com/loom; live-event participant app)";

/** The fetch shape the client needs (injectable for tests). */
export type WikiFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** One search hit: an article that is a piece of software. */
export interface SoftwareHit {
  /** The article title — the name the guest would register with. */
  title: string;
  /** Wikipedia's short description ("1996 video game"). */
  description: string;
  /** The lead image (thumbnail URL), when the article has one. */
  image: string | null;
}

/** The infoboxes that make an article "software" for our purposes. */
const SOFTWARE_TEMPLATES = ["Infobox software", "Infobox video game", "Infobox website"];

/** Words in a title or description that mark antivirus / security software. */
const ANTIVIRUS = /\b(anti-?virus|anti-?malware|anti-?spyware|malware|security (suite|software|program|product)|computer (security|protection)|internet security|firewall|virus scanner)\b/iu;

/** Is this article antivirus (or other security) software? Guests can't be one. */
export function isAntivirusSoftware(title: string, description: string): boolean {
  return ANTIVIRUS.test(title) || ANTIVIRUS.test(description);
}

interface RawPage {
  pageid?: number;
  title?: string;
  index?: number;
  description?: string;
  thumbnail?: { source?: string };
  pageprops?: { disambiguation?: string };
}

function pagesOf(json: unknown): RawPage[] {
  const q = (json as { query?: { pages?: unknown } } | null)?.query?.pages;
  return Array.isArray(q) ? (q as RawPage[]) : [];
}

/** Files that are furniture on every article, never its picture. */
const FURNITURE = /commons-logo|oojs|icon|shackle|protection|padlock|symbol|ambox|question_book|question book|wiki_letter|wiki letter|wikidata|disambig|edit-|flag of|increase|decrease|nuvola|crystal|star_|star |wpvg|logo of wikipedia|wikipedia/iu;

/**
 * The best picture among an article's files, for a page with no
 * registered lead image (a non-free logo usually): a file named after
 * the article beats one that isn't; a logo / cover / box art beats a
 * screenshot; site furniture never counts. Null when nothing qualifies.
 */
export function pickFile(title: string, files: string[]): string | null {
  const tokens = title
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length >= 3);
  const candidates = files.filter((f) => /\.(png|jpe?g|gif|webp|svg)$/iu.test(f) && !FURNITURE.test(f.replace(/^File:/u, "")));
  const score = (f: string) => {
    const name = f.toLowerCase().replace(/[_\s-]+/gu, "");
    let n = 0;
    if (tokens.some((t) => name.includes(t))) n += 2;
    if (/logo|cover|boxart|icon\b/u.test(f.toLowerCase())) n += 1;
    return n;
  };
  const best = [...candidates].sort((a, b) => score(b) - score(a))[0];
  return best ?? null;
}

function hitOf(p: RawPage): SoftwareHit | null {
  if (typeof p.title !== "string" || p.title === "") return null;
  if (p.pageprops?.disambiguation !== undefined) return null;
  return { title: p.title, description: p.description ?? "", image: p.thumbnail?.source ?? null };
}

export interface WikiClientOptions {
  fetch?: WikiFetch;
  /** Per-request deadline (ms). */
  timeoutMs?: number;
  /** Thumbnail size requested (px, longest side). */
  thumbSize?: number;
  /** Requests in flight at once — Wikipedia throttles a burst (a cast of
   *  forty looked up as the doors open), so lookups queue behind this. */
  concurrency?: number;
}


export class WikiClient {
  private readonly fetchFn: WikiFetch;
  private readonly timeoutMs: number;
  private readonly thumbSize: number;
  private readonly concurrency: number;
  private readonly searches = new Map<string, Promise<SoftwareHit[]>>();
  private readonly lookups = new Map<string, Promise<SoftwareHit | null>>();
  private inflight = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(opts: WikiClientOptions = {}) {
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 6000;
    this.thumbSize = opts.thumbSize ?? 256;
    this.concurrency = opts.concurrency ?? 4;
  }

  /**
   * Software articles matching `q`, best first: one CirrusSearch query per
   * software infobox, merged by rank and de-duplicated. Antivirus articles
   * are *kept* here (flagged by `isAntivirusSoftware`) so the join screen
   * can show why they're greyed out instead of silently dropping them.
   */
  search(q: string, limit = 8): Promise<SoftwareHit[]> {
    const query = q.trim().replace(/\s+/gu, " ");
    if (query === "") return Promise.resolve([]);
    const key = `${query.toLowerCase()}|${limit}`;
    const hit = this.searches.get(key);
    if (hit !== undefined) return hit;
    const run = this.runSearch(query, limit).catch(() => {
      this.searches.delete(key); // a failed query is retried next time
      return [] as SoftwareHit[];
    });
    this.searches.set(key, run);
    return run;
  }

  private searchQuery(gsrsearch: string, limit: number): Promise<RawPage[]> {
    return this.query({
      generator: "search",
      gsrsearch,
      gsrlimit: String(limit),
      gsrnamespace: "0",
      prop: "pageimages|description|pageprops",
      ppprop: "disambiguation",
      piprop: "thumbnail",
      pithumbsize: String(this.thumbSize),
      pilimit: String(limit),
      pilicense: "any",
    }).then((json) => pagesOf(json).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)));
  }

  private async runSearch(query: string, limit: number): Promise<SoftwareHit[]> {
    // CirrusSearch has no OR across `hastemplate:` filters, so it is one
    // query per catalogue — plus an unfiltered one, whose order is
    // Wikipedia's real ranking of the software hits (the per-catalogue
    // ranks aren't comparable: a website's #1 is not a game's #1).
    const per = Math.max(3, Math.ceil(limit / 2));
    let failures = 0;
    const [global, ...lists] = await Promise.all([
      this.searchQuery(query, limit * 2).catch(() => [] as RawPage[]),
      ...SOFTWARE_TEMPLATES.map((t) =>
        this.searchQuery(`${query} hastemplate:"${t}"`, per).catch(() => {
          failures++;
          return [] as RawPage[];
        }),
      ),
    ]);
    if (failures === SOFTWARE_TEMPLATES.length) throw new Error("search unavailable");
    const software = new Map<number, RawPage>();
    for (const list of lists) for (const p of list) if (p.pageid !== undefined && !software.has(p.pageid)) software.set(p.pageid, p);
    // Order: Wikipedia's global ranking of the software hits first, then
    // (for what the global query didn't reach) the catalogues interleaved
    // by rank. Then a title that carries a word of the query outranks one
    // that merely mentions it ("Norton 360" before "The Peace Keepers").
    const ordered: RawPage[] = [];
    const seen = new Set<number>();
    const take = (p: RawPage | undefined) => {
      if (p === undefined || p.pageid === undefined || seen.has(p.pageid)) return;
      seen.add(p.pageid);
      ordered.push(p);
    };
    for (const p of global) if (p.pageid !== undefined && software.has(p.pageid)) take(software.get(p.pageid));
    const longest = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) for (const list of lists) take(list[i]);
    const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
    const named = (p: RawPage) => words.some((w) => (p.title ?? "").toLowerCase().includes(w));
    return [...ordered.filter(named), ...ordered.filter((p) => !named(p))]
      .map(hitOf)
      .filter((h): h is SoftwareHit => h !== null)
      .slice(0, limit);
  }

  /**
   * The article for a name — an exact title (following redirects, so
   * "MS Paint" lands on Microsoft Paint) else the best software search
   * hit, else the same for the name minus its first word ("Broken Ask
   * Jeeves" → Ask Jeeves). Null when Wikipedia knows nothing by that
   * name. A failed request is not remembered: the next ask retries.
   */
  lookup(name: string): Promise<SoftwareHit | null> {
    const key = name.trim().toLowerCase();
    if (key === "") return Promise.resolve(null);
    const hit = this.lookups.get(key);
    if (hit !== undefined) return hit;
    const run = this.runLookup(name.trim()).catch(() => {
      this.lookups.delete(key);
      return null;
    });
    this.lookups.set(key, run);
    return run;
  }

  private async runLookup(name: string): Promise<SoftwareHit | null> {
    const exact = await this.byTitle(name);
    if (exact !== null) return exact;
    const [best] = await this.search(name, 1);
    if (best !== undefined) return best;
    const words = name.split(/\s+/u);
    return words.length >= 3 ? this.lookup(words.slice(1).join(" ")) : null;
  }

  /** The article titled `name` (redirects followed), or null when there is none. */
  private async byTitle(name: string): Promise<SoftwareHit | null> {
    const json = await this.query({
      titles: name,
      redirects: "1",
      prop: "pageimages|description|pageprops",
      ppprop: "disambiguation",
      piprop: "thumbnail",
      pithumbsize: String(this.thumbSize),
      pilicense: "any",
    });
    const page = pagesOf(json).find((p) => p.pageid !== undefined && (p as { missing?: boolean }).missing !== true);
    const hit = page === undefined ? null : hitOf(page);
    if (hit === null || hit.image !== null) return hit;
    // No registered lead image (a non-free logo, typically): read the
    // article's own files and take the best one.
    return { ...hit, image: await this.imageFromFiles(hit.title) };
  }

  /** The thumbnail of the best-looking file on an article, or null. */
  private async imageFromFiles(title: string): Promise<string | null> {
    const listing = await this.query({ titles: title, prop: "images", imlimit: "12" }).catch(() => null);
    const files = (pagesOf(listing)[0] as { images?: Array<{ title?: string }> } | undefined)?.images ?? [];
    const file = pickFile(title, files.map((f) => f.title ?? "").filter(Boolean));
    if (file === null) return null;
    const info = await this.query({ titles: file, prop: "imageinfo", iiprop: "url|mime", iiurlwidth: String(this.thumbSize) }).catch(() => null);
    const ii = (pagesOf(info)[0] as { imageinfo?: Array<{ thumburl?: string; url?: string; mime?: string }> } | undefined)?.imageinfo?.[0];
    if (ii === undefined || !(ii.mime ?? "image/").startsWith("image/")) return null;
    return ii.thumburl ?? ii.url ?? null;
  }

  /** The profile picture for a name: the article's lead image, if any. */
  async avatarFor(name: string): Promise<string | null> {
    return (await this.lookup(name))?.image ?? null;
  }

  private async query(params: Record<string, string>): Promise<unknown> {
    const url = new URL(API);
    url.search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params }).toString();
    await this.slot();
    try {
      const res = await this.fetchFn(url.toString(), {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`wikipedia answered ${res.status}`);
      return await res.json();
    } finally {
      this.inflight--;
      this.waiting.shift()?.();
    }
  }

  /** Wait for a request slot (at most `concurrency` in flight). */
  private slot(): Promise<void> {
    if (this.inflight < this.concurrency) {
      this.inflight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.inflight++;
        resolve();
      });
    });
  }
}
