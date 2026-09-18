/**
 * Paste sanitiser (R3B.5) — a PURE, unit-testable HTML cleaner for the rich
 * text paste pipeline.
 *
 * Strategy (strict allow-list): parse the clipboard HTML with a DOM parser
 * (injected for testability — jsdom in unit tests, the browser DOMParser in
 * the app), then:
 *  1. convert Word's fake list paragraphs (`mso-list` / MsoListParagraph)
 *     into REAL ul/ol lists (markers parsed from the text, since Word HTML
 *     encodes list structure as styled paragraphs + literal markers);
 *  2. strip comments;
 *  3. drop disallowed elements entirely (scripts, styles, iframes, form
 *     controls, media, remote images …);
 *  4. unwrap unknown-but-harmless containers (span/div/section…) so their
 *     content survives schema parsing;
 *  5. scrub every remaining element's attributes: remove inline styles,
 *     classes, ids, data-* (except the schema-consumed ones), event
 *     handlers (on*) and unsafe link schemes (javascript:…);
 *  6. keep exactly the formatting the rich schema understands: bold, italic,
 *     underline, strike, code, headings (h1–h3; h4–h6 are downgraded),
 *     lists, blockquote, pre, hr, links, tables and data: images.
 *
 * Remote images (any img whose src is not a `data:` URL) are REMOVED and
 * counted, so the paste handler can surface the visible Persian notice
 * required by the spec. The function itself is side-effect free.
 */

/** Injected DOM capability the sanitiser needs (kept tiny for tests). */
export interface PasteSanitizerDom {
  /** Parses an HTML string into a Document (like `new DOMParser().parseFromString`). */
  readonly parseHTML: (html: string) => Document;
}

/** Result of {@link sanitizePastedHTML}. */
export interface SanitizedPaste {
  /** The cleaned HTML fragment (body innerHTML). */
  readonly html: string;
  /** How many remote (non-data:) images were dropped. */
  readonly droppedRemoteImages: number;
  /** How many Word fake-list paragraphs were converted into real list items. */
  readonly convertedWordListItems: number;
}

/** Elements removed WITH their whole subtree (never rendered, never parsed). */
const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "video",
  "audio",
  "picture",
  "source",
  "track",
  "canvas",
  "map",
  "area",
  "svg",
  "math",
  "dialog",
]);

/** Unknown-but-harmless wrappers unwrapped in place (children survive). */
const UNWRAP_ELEMENTS = new Set([
  "span",
  "font",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "figure",
  "figcaption",
  "center",
  "label",
  "small",
  "abbr",
  "cite",
  "time",
  "details",
  "summary",
]);

/**
 * Attributes kept per element (everything else is dropped). Elements absent
 * from this map keep only the direction attribute when valid.
 */
const KEPT_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ["href"],
  img: ["src", "alt"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  li: ["data-checked"],
  table: ["data-table-preset"],
};

/** Elements allowed to keep `dir` (the bidi attribute the schema consumes). */
const DIR_AWARE_ELEMENTS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "pre",
  "table",
  "td",
  "th",
]);

/** Bullet glyphs Word/Excel emit for unordered fake-list paragraphs. */
const BULLET_MARKER_PATTERN = /^[\s\u00a0]*([•·▪●◦‣⁃o○\-–—])[.)\s\u00a0]*/;

/** `1.`, `2)`, `a.`, `iv)` … markers of ordered fake-list paragraphs. */
const ORDERED_MARKER_PATTERN =
  /^[\s\u00a0]*(\d{1,3}|[a-zA-Z])[.)\]][\s\u00a0]+/;

/** Styles/Word markers that reveal a fake list paragraph. */
const WORD_LIST_STYLE_PATTERN = /mso-list/i;

/** Word's fake list paragraph class name. */
const WORD_LIST_CLASS_PATTERN = /MsoListParagraph/i;

/** Word's per-visual-list id (`mso-list:l0 …`) — one id per list. */
const WORD_LIST_ID_PATTERN = /mso-list:\s*(l\d+)/i;

/** Word's indentation level (`mso-list:l0 level2 …`). */
const WORD_LIST_LEVEL_PATTERN = /mso-list:\s*l\d+\s+level(\d+)/i;

/** URL schemes allowed in link hrefs (relative URLs pass as-is). */
const SAFE_HREF_PATTERN = /^(https?:|mailto:|tel:)/i;

/**
 * Schemes that must never survive on a LINK href (executable or
 * data-URL payloads). `data:` is safe (and required) for image srcs —
 * those are checked separately before the attribute scrub.
 */
const UNSAFE_HREF_PATTERN = /^\s*(javascript|vbscript|data|file):/i;

/**
 * Parses a document with the platform DOMParser when available.
 *
 * @returns the ambient DOM adapter, or null when no global parser exists
 *          (pure node environments must inject their own).
 */
function ambientDom(): PasteSanitizerDom | null {
  const parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (parser === undefined) {
    return null;
  }
  return {
    parseHTML: (html: string): Document =>
      new parser().parseFromString(html, "text/html"),
  };
}

/**
 * Sanitises a clipboard HTML payload (pure: mutates only the freshly parsed
 * document, never the input string, and performs no I/O).
 *
 * @param html - the raw `text/html` clipboard payload.
 * @param dom - injected DOM adapter; defaults to the ambient DOMParser.
 * @returns the cleaned HTML plus sanitiser diagnostics.
 */
export function sanitizePastedHTML(
  html: string,
  dom?: PasteSanitizerDom | null,
): SanitizedPaste {
  const adapter = dom ?? ambientDom();
  if (adapter === null) {
    // No DOM available (pure node runtime without injection): return the
    // input untouched — the editor paste path always runs in a browser.
    return { html, droppedRemoteImages: 0, convertedWordListItems: 0 };
  }
  const doc = adapter.parseHTML(html);
  const stats: Stats = { droppedRemoteImages: 0, convertedWordListItems: 0 };
  const fakeLists = convertWordFakeLists(doc);
  stats.convertedWordListItems = fakeLists;
  stripComments(doc);
  sanitizeTree(doc.body, stats);
  return { html: doc.body.innerHTML, ...stats };
}

/** Mutable counters accumulated during the tree walk. */
interface Stats {
  droppedRemoteImages: number;
  convertedWordListItems: number;
}

/**
 * Removes every comment node from the parsed document (comments can smuggle
 * payloads past naive regex filters — they never survive here).
 *
 * @param doc - the parsed document.
 */
function stripComments(doc: Document): void {
  const walker = doc.createTreeWalker(
    doc.body,
    128 /* NodeFilter.SHOW_COMMENT */,
  );
  const comments: Comment[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Comment) {
      comments.push(node);
    }
  }
  for (const comment of comments) {
    comment.remove();
  }
}

/**
 * Detects a Word fake-list paragraph.
 *
 * @param element - the candidate block element.
 * @returns whether Word marked it as a list paragraph.
 */
function isWordListParagraph(element: Element): boolean {
  if (element.tagName === "P" || element.tagName === "DIV") {
    const style = element.getAttribute("style") ?? "";
    const className = element.getAttribute("class") ?? "";
    return (
      WORD_LIST_STYLE_PATTERN.test(style) ||
      WORD_LIST_CLASS_PATTERN.test(className)
    );
  }
  return false;
}

/**
 * Converts Word's fake list paragraphs into real ul/ol structure BEFORE
 * inline styles are stripped (the markers live in the style/class).
 *
 * فاز ۲۴ grouping: paragraphs sharing a `mso-list:lNNN` id belong to the
 * SAME visual Word list — they merge into ONE real list (the Phase-23
 * behaviour emitted a separate list per paragraph, slicing Word lists
 * into fragments). Deeper `levelN` paragraphs continue the NESTED list
 * inside the parent level's last item, so two-level Word lists survive
 * with real nesting. Id-less paragraphs keep the legacy rule: a
 * following REAL list of the matching kind continues it.
 *
 * Consecutive fake-list siblings merge into one list; the literal marker
 * glyph/number is removed from the text; bullet markers → `ul`, numeric or
 * lettered markers → `ol`.
 *
 * @param doc - the parsed document.
 * @returns the number of paragraphs converted into list items.
 */
function convertWordFakeLists(doc: Document): number {
  const body = doc.body;
  const candidates = [...body.children].filter(
    (element) => isWordListParagraph(element) && element.textContent !== null,
  );
  if (candidates.length === 0) {
    return 0;
  }
  /** Per Word list id: the chain of list elements per level (index 0 = level 1). */
  const listsByWordId = new Map<string, Element[]>();
  let converted = 0;
  for (const paragraph of candidates) {
    const parent = paragraph.parentElement;
    if (parent === null) {
      continue;
    }
    const text = paragraph.textContent ?? "";
    let listTag = "ul";
    let remainder = text;
    const bullet = BULLET_MARKER_PATTERN.exec(text);
    const ordered = ORDERED_MARKER_PATTERN.exec(text);
    if (bullet !== null && ordered === null) {
      remainder = text.slice(bullet[0].length);
    } else if (ordered !== null) {
      listTag = "ol";
      remainder = text.slice(ordered[0].length);
    } else {
      // Marked as a list paragraph but no marker glyph: default to bullet.
      remainder = text.trimStart();
    }
    const style = paragraph.getAttribute("style") ?? "";
    const idMatch = WORD_LIST_ID_PATTERN.exec(style);
    const levelMatch = WORD_LIST_LEVEL_PATTERN.exec(style);
    const wordId = idMatch !== null ? (idMatch[1] ?? null) : null;
    const level =
      levelMatch !== null ? Math.max(1, Number(levelMatch[1] ?? 1)) : 1;

    const target = resolveTargetList(
      doc,
      paragraph,
      listTag,
      wordId,
      level,
      listsByWordId,
    );
    const item = doc.createElement("li");
    const inner = doc.createElement("p");
    inner.textContent = remainder.trim();
    item.appendChild(inner);
    target.appendChild(item);
    if (target.parentElement === null) {
      // A freshly created list takes the paragraph's own position.
      parent.insertBefore(target, paragraph);
    }
    paragraph.remove();
    if (wordId !== null) {
      const chain = listsByWordId.get(wordId) ?? [];
      if (chain.length === 0) {
        chain.push(target);
        listsByWordId.set(wordId, chain);
      }
    }
    converted += 1;
  }
  return converted;
}

/**
 * Finds the nested list element inside a list's LAST item (the place a
 * deeper Word level continues into).
 *
 * @param list - the parent list element.
 * @returns the nested ul/ol, or null when the last item has none yet.
 */
function nestedListOf(list: Element): Element | null {
  const lastItem = list.lastElementChild;
  if (lastItem === null) {
    return null;
  }
  let child = lastItem.lastElementChild;
  while (child !== null && child.tagName !== "UL" && child.tagName !== "OL") {
    child = child.previousElementSibling;
  }
  return child;
}

/**
 * Resolves the list element one fake-list paragraph appends into.
 *
 * @param doc - the parsed document (creates fresh lists).
 * @param paragraph - the fake-list paragraph being converted.
 * @param listTag - the marker-derived list kind ("ul" | "ol").
 * @param wordId - the paragraph's `mso-list` id, when present.
 * @param level - the paragraph's `mso-list` indentation level (≥1).
 * @param listsByWordId - the running id → list-chain registry.
 * @returns the list element to append the new item into.
 */
function resolveTargetList(
  doc: Document,
  paragraph: Element,
  listTag: string,
  wordId: string | null,
  level: number,
  listsByWordId: Map<string, Element[]>,
): Element {
  if (wordId !== null) {
    const chain = listsByWordId.get(wordId);
    const root = chain?.[0] ?? null;
    if (root !== null) {
      // Walk down the id's chain, CREATING the nested list of each missing
      // deeper level inside the parent level's last item.
      let cursor: Element = root;
      for (let depth = 1; depth < level; depth += 1) {
        const nested = nestedListOf(cursor);
        if (nested !== null) {
          cursor = nested;
          continue;
        }
        const lastItem = cursor.lastElementChild;
        if (lastItem === null) {
          break; // malformed chain: continue at the deepest sane level
        }
        const created = doc.createElement(listTag);
        lastItem.appendChild(created);
        cursor = created;
      }
      return cursor;
    }
  }
  // A following REAL list continues the same list element (legacy rule).
  const sibling = paragraph.nextElementSibling;
  if (
    sibling !== null &&
    ((listTag === "ul" && sibling.tagName === "UL") ||
      (listTag === "ol" && sibling.tagName === "OL"))
  ) {
    return sibling;
  }
  return doc.createElement(listTag);
}

/**
 * Cleans one element and recurses into its children (depth-first; the
 * children are snapshot because the walk mutates the tree).
 *
 * @param element - the element to sanitise.
 * @param stats - the accumulating counters.
 */
function sanitizeTree(element: Element, stats: Stats): void {
  const children = [...element.children];
  for (const child of children) {
    sanitizeTree(child, stats);
  }
  const tag = childTag(element);
  if (FORBIDDEN_ELEMENTS.has(tag)) {
    element.remove();
    return;
  }
  if (tag === "img") {
    const src = element.getAttribute("src") ?? "";
    if (!src.toLowerCase().startsWith("data:")) {
      stats.droppedRemoteImages += 1;
      element.remove();
      return;
    }
    scrubAttributes(element, "img");
    return;
  }
  if (tag === "h4" || tag === "h5") {
    element = renameElement(element, "h3") ?? element;
    scrubAttributes(element, "h3");
    return;
  }
  if (tag === "h6") {
    element = renameElement(element, "p") ?? element;
    scrubAttributes(element, "p");
    return;
  }
  if (UNWRAP_ELEMENTS.has(tag)) {
    unwrap(element);
    return;
  }
  scrubAttributes(element, tag);
}

/**
 * Normalises an element's tag name (lower-cased).
 *
 * @param element - the element to inspect.
 * @returns the lower-case tag name.
 */
function childTag(element: Element): string {
  return element.tagName.toLowerCase();
}

/**
 * Moves every child of the wrapper in front of it, then removes the wrapper.
 *
 * @param wrapper - the element to dissolve.
 */
function unwrap(wrapper: Element): void {
  const parent = wrapper.parentElement;
  if (parent === null) {
    return;
  }
  while (wrapper.firstChild !== null) {
    parent.insertBefore(wrapper.firstChild, wrapper);
  }
  wrapper.remove();
}

/**
 * Replaces an element with a new element of the given tag, moving children
 * and the node's position (for heading downgrades).
 *
 * @param element - the source element.
 * @param tag - the new tag name.
 * @returns the replacement element (null when detached).
 */
function renameElement(element: Element, tag: string): Element | null {
  const parent = element.parentElement;
  if (parent === null) {
    return null;
  }
  const doc = element.ownerDocument;
  const replacement = doc.createElement(tag);
  while (element.firstChild !== null) {
    replacement.appendChild(element.firstChild);
  }
  parent.insertBefore(replacement, element);
  element.remove();
  return replacement;
}

/**
 * Scrubs an element's attributes down to the safe allow-list, sanitising
 * the kept values (href scheme, dir values, data-checked).
 *
 * @param element - the element to clean (in place).
 * @param tag - the element's lower-case tag name.
 */
function scrubAttributes(element: Element, tag: string): void {
  const kept = KEPT_ATTRIBUTES[tag] ?? [];
  const attributes = [...element.attributes];
  for (const attribute of attributes) {
    const name = attribute.name.toLowerCase();
    const keep =
      kept.includes(name) ||
      (name === "dir" &&
        DIR_AWARE_ELEMENTS.has(tag) &&
        isSafeDir(attribute.value));
    if (!keep) {
      element.removeAttribute(attribute.name);
    }
  }
  const href = element.getAttribute("href");
  if (href !== null && !isSafeHref(href)) {
    element.removeAttribute("href");
  }
}

/**
 * @param value - a candidate `dir` attribute value.
 * @returns whether only the bidi values we model survive.
 */
function isSafeDir(value: string): boolean {
  return value === "rtl" || value === "ltr";
}

/**
 * @param href - a candidate link href.
 * @returns whether the href's scheme is safe to keep.
 */
function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed.startsWith("#")) {
    return false; // in-document anchors are meaningless on the canvas
  }
  if (UNSAFE_HREF_PATTERN.test(trimmed)) {
    return false;
  }
  return SAFE_HREF_PATTERN.test(trimmed) || !trimmed.includes(":");
}
