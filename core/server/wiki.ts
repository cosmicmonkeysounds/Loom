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
const FURNITURE = /commons-logo|wikibooks-logo|wikiquote-logo|wiktionary-logo|wikinews-logo|wikiversity|wikisource|free and open-source software logo|free_and_open-source_software_logo|octicons|oojs|shackle|protection|padlock|symbol[ _](support|oppose|question|delete|keep|comment)|symbol[ _][a-z]+[ _]class|ambox|question[ _]book|wiki[ _]letter|wikidata|disambig|edit-(clear|ltr|rtl)|flag[ _]of|increase|decrease|nuvola|crystal[ _]clear|^star[ _]|wpvg|wikipedia|wikimedia|unbalanced[ _]scales|text-x-|gnome-|emblem-|portal[-_ ]puzzle|folder[ _]hexagonal|p[ _]vip|office-book|red[ _]pog|blue[ _]pencil|audio[ _]a\.svg|loudspeaker|sound-icon|people[ _]icon|merge-arrow|split-arrow|mergefrom|mergeto/iu;

/** A file that could be a picture at all (a raster or SVG image). */
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg)$/iu;

/**
 * An article's files in the order they make a good profile picture —
 * the "famous" picture of a piece of software is nearly always its logo
 * or box art, not the screenshot Wikipedia uses as the lead image. A file
 * named after the article beats one that isn't; a logo / icon / cover /
 * box art beats a screenshot; the lead image gets a nudge; site furniture
 * never counts. `File:` prefixes are kept as given.
 */
export function rankFiles(title: string, files: string[], lead: string | null = null, alias = title): string[] {
  const tokens = `${title} ${alias}`
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length >= 3);
  const whole = title.toLowerCase().replace(/[_\s-]+/gu, "");
  const bare = (f: string) => f.replace(/^File:/u, "");
  const leadName = lead === null ? null : bare(lead).replace(/_/gu, " ");
  const seen = new Set<string>();
  const candidates = files.filter((f) => {
    const name = bare(f);
    if (!IMAGE_FILE.test(name) || FURNITURE.test(name) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  const score = (f: string) => {
    const lower = bare(f).toLowerCase();
    const squashed = lower.replace(/[_\s-]+/gu, "");
    let n = 0;
    if (tokens.some((t) => squashed.includes(t))) n += 3;
    // Named exactly after the article ("Microsoft Paint.svg"): its emblem.
    if (squashed.replace(/\.[a-z]+$/u, "") === whole) n += 3;
    if (/logo|wordmark|logomark/u.test(lower)) n += 4;
    else if (/cover|box[ _-]?art|boxshot|icon/u.test(lower)) n += 3;
    if (lower.endsWith(".svg")) n += 1;
    if (leadName !== null && bare(f).replace(/_/gu, " ") === leadName) n += 2;
    if (/screenshot|screen[ _-]?shot|interface|headquarters|\bhq\b/u.test(lower)) n -= 1;
    return n;
  };
  return candidates
    .map((f, i) => ({ f, i, s: score(f) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((c) => c.f);
}

/**
 * The best picture among an article's files, for a page with no
 * registered lead image (a non-free logo usually). Null when nothing
 * qualifies. See `rankFiles`.
 */
export function pickFile(title: string, files: string[]): string | null {
  return rankFiles(title, files)[0] ?? null;
}

/** One picture a guest may choose for a program. */
export interface PictureOption {
  /** The file it came from (`File:Winamp Logo.svg`) — what an author
   *  writes as `avatar: File:…` to pick it for good. */
  file: string;
  /** A thumbnail URL, ready to fetch. */
  url: string;
}

/**
 * The URL of a Wikipedia / Commons file by name, at thumbnail size. An
 * authored `avatar: File:Clippy-letter.PNG` turns into this; the wiki's
 * `Special:FilePath` redirects to the real thumbnail, so no API call (and
 * no directory) is needed to resolve a hand-picked picture.
 */
export function fileUrl(file: string, width = 256): string {
  const name = file.trim().replace(/^File:/iu, "").replace(/ /gu, "_");
  return `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
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
  private readonly galleries = new Map<string, Promise<PictureOption[]>>();
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
    return (await this.gallery(title, 8).catch(() => []))[0]?.url ?? null;
  }

  /**
   * A few pictures for a name, best first — the article's logo, box art,
   * icon, lead image, screenshots (see `rankFiles`) — so a guest can pick
   * the one that *looks like* the program rather than whatever Wikipedia
   * leads with. Empty when Wikipedia knows nothing by that name.
   */
  async pictures(name: string, limit = 8): Promise<PictureOption[]> {
    const hit = await this.lookup(name);
    if (hit === null) return [];
    const options = await this.gallery(hit.title, limit, name).catch(() => [] as PictureOption[]);
    // An article with no listable files still offers its lead thumbnail.
    if (options.length === 0 && hit.image !== null) return [{ file: "", url: hit.image }];
    return options;
  }

  /** An article's ranked pictures (memoised per title + limit; a failure is retried). */
  private gallery(title: string, limit: number, alias = title): Promise<PictureOption[]> {
    const key = `${title.toLowerCase()}|${alias.toLowerCase()}|${limit}`;
    const hit = this.galleries.get(key);
    if (hit !== undefined) return hit;
    const run = this.runGallery(title, limit, alias).catch((e: unknown) => {
      this.galleries.delete(key);
      throw e;
    });
    this.galleries.set(key, run);
    return run;
  }

  private async runGallery(title: string, limit: number, alias: string): Promise<PictureOption[]> {
    const listing = await this.query({ titles: title, redirects: "1", prop: "pageimages|images", piprop: "name", pilicense: "any", imlimit: "100" });
    const page = pagesOf(listing)[0] as { pageimage?: string; images?: Array<{ title?: string }> } | undefined;
    const files = (page?.images ?? []).map((f) => f.title ?? "").filter(Boolean);
    const lead = page?.pageimage === undefined ? null : `File:${page.pageimage.replace(/_/gu, " ")}`;
    if (lead !== null && !files.includes(lead)) files.unshift(lead);
    // Ask about a few more than wanted: some won't resolve to a usable image.
    const ranked = rankFiles(title, files, lead, alias).slice(0, limit + 4);
    if (ranked.length === 0) return [];
    const info = await this.query({ titles: ranked.join("|"), prop: "imageinfo", iiprop: "url|mime|size", iiurlwidth: String(this.thumbSize) });
    type Info = { thumburl?: string; url?: string; mime?: string; width?: number; height?: number };
    const byTitle = new Map<string, Info>();
    for (const p of pagesOf(info) as Array<{ title?: string; imageinfo?: Info[] }>) {
      const ii = p.imageinfo?.[0];
      if (p.title !== undefined && ii !== undefined) byTitle.set(p.title, ii);
    }
    const out: PictureOption[] = [];
    for (const file of ranked) {
      const ii = byTitle.get(file);
      if (ii === undefined || !(ii.mime ?? "image/").startsWith("image/")) continue;
      // A 16-px glyph is never anybody's face.
      if (ii.width !== undefined && ii.height !== undefined && Math.max(ii.width, ii.height) < 48) continue;
      const url = ii.thumburl ?? ii.url;
      if (url === undefined) continue;
      out.push({ file, url });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** The profile picture for a name: the best of its pictures (a logo
   *  over a screenshot), else the article's lead image, if any. */
  async avatarFor(name: string): Promise<string | null> {
    const [best] = await this.pictures(name, 1);
    return best?.url ?? null;
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
