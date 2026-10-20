import { describe, expect, it } from "vitest";
import { patchDescriptionHtml } from "../src/description-patch.ts";
import { htmlToMarkdown } from "../src/html-markdown.ts";

/** The source's Markdown, edited by `change`, written back into its HTML. */
function edit(html: string, change: (markdown: string) => string) {
  const markdown = htmlToMarkdown(html) ?? "";
  const edited = change(markdown);
  const written = patchDescriptionHtml(html, edited);
  return { markdown, edited, written };
}

const EDITOR_HTML =
  "<div>Context</div><div><br></div><div><br></div><div>First line</div><div>Second line</div>" +
  "<div><br></div><ul><li>One</li><li>Two</li></ul><div>After the list</div><div><br></div>" +
  "<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>";

describe("writing an edit back into the description's HTML", () => {
  it("reads empty editor lines as blank lines between lines", () => {
    expect(htmlToMarkdown("<div>A</div><div><br></div><div>B</div><div>C</div>")).toBe("A\n\nB\nC");
  });

  it("keeps every block the user did not change as it was, empty lines included", () => {
    const { written } = edit(EDITOR_HTML, (markdown) => markdown.replace("Second line", "Second line, edited"));

    expect(written).toBe(EDITOR_HTML.replace("<div>Second line</div>", "<div>Second line, edited</div>"));
  });

  it("keeps the empty lines around a changed line", () => {
    const { written } = edit(EDITOR_HTML, (markdown) => markdown.replace("Context", "New context"));

    expect(written).toBe(EDITOR_HTML.replace("<div>Context</div>", "<div>New context</div>"));
  });

  it("writes an added paragraph as editor lines, after an empty line when it follows a line", () => {
    expect(edit("<div>A</div>", (markdown) => `${markdown}\n\nAdded`).written).toBe(
      "<div>A</div><div><br></div><div>Added</div>",
    );
    // A table, like any block, has its own spacing.
    expect(edit(EDITOR_HTML, (markdown) => `${markdown}\n\nAdded`).written).toBe(`${EDITOR_HTML}<div>Added</div>`);
  });

  it("rewrites only a list the user changed", () => {
    const { written, edited } = edit(EDITOR_HTML, (markdown) => markdown.replace("- Two", "- Two\n- Three"));

    expect(written).toBe(
      EDITOR_HTML.replace("<ul><li>One</li><li>Two</li></ul>", "<ul><li>One</li><li>Two</li><li>Three</li></ul>"),
    );
    expect(htmlToMarkdown(written!)).toBe(edited);
  });

  it("keeps a block's own markup when the text around it changes", () => {
    const html = '<div>Intro</div><div><br></div><pre style="font-family: Consolas">code()</pre><div>Outro</div>';
    const { written } = edit(html, (markdown) => markdown.replace("Outro", "Outro, longer"));

    expect(written).toBe(html.replace("<div>Outro</div>", "<div>Outro, longer</div>"));
  });

  it("keeps a wrapper of blocks, and does not nest a single line deeper on each edit", () => {
    const wrapped = "<div><div>A</div><div><br></div><div>B</div></div>";
    expect(edit(wrapped, (markdown) => markdown.replace("B", "B2")).written).toBe(
      "<div><div>A</div><div><br></div><div>B2</div></div>",
    );

    let html = "<div>Only line</div>";
    for (const text of ["Second", "Third"]) {
      html = patchDescriptionHtml(html, text)!;
    }
    expect(html).toBe("<div>Third</div>");
  });

  it("gives up, for the whole Markdown to be written, when it cannot read back as the edit", () => {
    expect(patchDescriptionHtml("", "Anything")).toBeUndefined();
  });
});
