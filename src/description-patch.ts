import { htmlToMarkdown, htmlToMarkdownParts } from "./html-markdown.js";
import { markdownTextEdges, markdownToHtml } from "./markdown-html.js";

// Writes an edited description back into its HTML, keeping the HTML of every
// block the user did not change exactly as it was: its spacing, empty editor
// lines and markup stay. Only what changed is written from the Markdown.

/** Past this many line pairs, a line diff costs too much; the whole text is written. */
const MAX_DIFF_CELLS = 4_000_000;

/** An empty line of the editor, as Azure DevOps writes one. */
const EMPTY_LINE = "<div><br></div>";

/** For each line of `before`, the line of `after` it stays as, or -1. */
function matchLines(before: string[], after: string[]): number[] | undefined {
  const n = before.length;
  const m = after.length;
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return undefined;
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        before[i] === after[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const match = new Array<number>(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (before[i] === after[j]) {
      match[i] = j;
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return match;
}

/**
 * The HTML for `markdown`, an edit of the description `html` holds, with the
 * HTML of each unchanged block kept. Undefined when the blocks cannot be
 * told apart, or the result would not read back as `markdown`; the caller
 * then writes the whole Markdown.
 */
export function patchDescriptionHtml(html: string, markdown: string): string | undefined {
  const source = htmlToMarkdownParts(html);
  if (!source) return undefined;
  const { parts, gaps, separators } = source;

  // Each part's lines in the Markdown read from the source.
  const before: string[] = [];
  const spans = parts.map((part, index) => {
    if (index > 0 && separators[index - 1] === "\n\n") before.push("");
    const start = before.length;
    before.push(...part.markdown.split("\n"));
    return { start, end: before.length };
  });
  const after = markdown.replace(/\r\n?/g, "\n").trim().split("\n");
  const match = matchLines(before, after);
  if (!match) return undefined;

  // A part is kept when all its lines stay, together and in order.
  const placed = spans.map(({ start, end }) => {
    const first = match[start]!;
    if (first === -1) return undefined;
    for (let line = start; line < end; line += 1) {
      if (match[line] !== first + (line - start)) return undefined;
    }
    return { start: first, end: first + (end - start) };
  });
  // A kept block must not touch new text, which would join it: a line after
  // a list goes on its last item. Only plain lines may.
  for (let changed = true; changed; ) {
    changed = false;
    placed.forEach((place, index) => {
      if (!place || parts[index]!.line) return;
      const previous = placed[index - 1];
      const next = placed[index + 1];
      const beforeOk =
        place.start === 0 ||
        after[place.start - 1] === "" ||
        (previous?.end === place.start && separators[index - 1] === "\n");
      const afterOk =
        place.end === after.length ||
        after[place.end] === "" ||
        (next?.start === place.end && separators[index] === "\n");
      if (!beforeOk || !afterOk) {
        placed[index] = undefined;
        changed = true;
      }
    });
  }

  const keptAt = new Map<number, number>();
  placed.forEach((place, index) => {
    if (place) keptAt.set(place.start, index);
  });

  let out = source.prefix;
  let emitted = false;
  // The kept part written last, when the last thing written was one.
  let lastKept: number | undefined;
  // Whether the last thing written ends in plain lines.
  let lastText = false;
  // The gap written last, so none is written twice.
  let lastGap = -1;
  // Whether blank lines came since the last thing written.
  let blank = false;
  const spaced = (gap: number) => blank === (separators[gap] === "\n\n");
  for (let line = 0; line < after.length; ) {
    if (after[line] === "") {
      blank = true;
      line += 1;
      continue;
    }
    const index = keptAt.get(line);
    if (index !== undefined) {
      const part = parts[index]!;
      if (emitted && index > 0 && lastGap !== index - 1 && spaced(index - 1)) {
        // The HTML that came before this block stays before it.
        out += gaps[index - 1]!;
        lastGap = index - 1;
      } else if (emitted && blank && lastText && part.line) {
        out += EMPTY_LINE;
      }
      out += part.html;
      emitted = true;
      lastKept = index;
      lastText = part.line;
      blank = false;
      line = placed[index]!.end;
      continue;
    }
    // New or changed text, up to the next kept block.
    const start = line;
    while (line < after.length && !keptAt.has(line)) line += 1;
    let end = line;
    while (end > start && after[end - 1] === "") end -= 1;
    const text = after.slice(start, end).join("\n");
    const edges = markdownTextEdges(text);
    if (lastKept !== undefined && placed[lastKept + 1] === undefined && lastKept + 1 < parts.length && spaced(lastKept)) {
      // The HTML after the block it follows stays, where the changed block was.
      out += gaps[lastKept]!;
      lastGap = lastKept;
    } else if (emitted && blank && lastText && edges.first) {
      out += EMPTY_LINE;
    }
    out += markdownToHtml(text);
    emitted = true;
    lastKept = undefined;
    lastText = edges.last;
    blank = end < line;
  }
  out += source.suffix;
  return (htmlToMarkdown(out) ?? "") === after.join("\n") ? out : undefined;
}
