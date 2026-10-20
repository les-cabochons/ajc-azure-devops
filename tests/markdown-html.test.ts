import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/html-markdown.ts";
import { markdownToHtml } from "../src/markdown-html.ts";

const ANA = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";

/** The Markdown a description converts to, then again after a write and a read. */
function roundTrip(html: string) {
  const markdown = htmlToMarkdown(html) ?? "";
  const again = htmlToMarkdown(markdownToHtml(markdown)) ?? "";
  return { markdown, again };
}

describe("Markdown written back as HTML reads back the same", () => {
  const cases: Record<string, string> = {
    "the editor's lines": "<div>First line</div><div>Second <br>line</div>",
    paragraphs: "<p>One</p><p>Two</p>Loose",
    "inline formatting and links":
      '<div><b>bold </b><i>italic</i> <s>gone</s> <code>a()</code> <a href="https://example.com/a b">the spec</a></div>',
    "nested emphasis": "<div><b>all <i>both</i> and</b> <del><b>struck bold</b></del></div>",
    "a link's emphasis": '<div><a href="https://example.com"><b>Bold link</b></a> after</div>',
    "code with backticks": "<div><code>a`b</code> and <code>`edge`</code></div>",
    "text that looks like syntax":
      "<div># not a heading</div><div>snake_case *x* [y] ~z~ a|b \\ back</div><div>1. not a list</div><div>---</div><div>&gt; not a quote</div><div>- not an item</div>",
    "entities and spaces": "<div>a &amp; b&nbsp;&lt;c&gt;\n   d&#39;e \"quoted\"</div>",
    "headings, quotes and rules":
      "<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6><blockquote><div>Quoted</div><div>Twice</div></blockquote><hr><div>After</div>",
    "a quote holding a list": "<blockquote><ul><li>In a quote</li></ul></blockquote>",
    lists:
      '<ul><li>One<li>Two</li><ul><li>Nested</li></ul><li><div>Three</div></li></ul><ol start="4"><li>Four</li><li>Five<ol><li>Inner</li></ol></li></ol>',
    "an item of several lines": "<ul><li><div>First</div><div>Second</div></li><li>Next</li></ul>",
    "two lists apart": "<ul><li>A</li></ul><ul><li>B</li></ul><ol><li>C</li></ol>",
    "a code block": "<pre>const a = 1;\n  if (a &lt; 2) {}\n```\n</pre>",
    "a table": "<table><tbody><tr><td><b>Day</b></td><td>Hours</td></tr><tr><td>Mon</td><td>7|5</td></tr><tr><td></td><td>`x`</td></tr></tbody></table>",
    images: '<div><img src="https://dev.azure.com/a/_apis/wit/attachments/1?fileName=x (1).png" alt="Dia_gram"></div>',
    mentions: `<div>Ask <a href="#" data-vss-mention="version:2.0,${ANA}">@Ana Silva</a> first</div>`,
  };

  for (const [name, html] of Object.entries(cases)) {
    it(name, () => {
      const { markdown, again } = roundTrip(html);
      expect(markdown.length).toBeGreaterThan(0);
      expect(again).toBe(markdown);
    });
  }
});

describe("markdownToHtml", () => {
  it("writes nothing for an empty description", () => {
    expect(markdownToHtml("")).toBe("");
    expect(markdownToHtml("\n  \n")).toBe("");
  });

  it("keeps each line break of a paragraph", () => {
    expect(markdownToHtml("One\nTwo\n\nThree")).toBe("<p>One<br>Two</p><p>Three</p>");
  });

  it("writes a mention as an Azure DevOps mention", () => {
    expect(markdownToHtml(`Hi [@Ana Silva](mention:${ANA.toUpperCase()})`)).toBe(
      `<p>Hi <a href="#" data-vss-mention="version:2.0,${ANA}">@Ana Silva</a></p>`,
    );
  });

  it("reads the CommonMark people type", () => {
    expect(markdownToHtml("*italic* __bold__ ***both***")).toBe(
      "<p><em>italic</em> <strong>bold</strong> <em><strong>both</strong></em></p>",
    );
    expect(markdownToHtml("* a\n* b\n\n1) one\n2) two")).toBe(
      "<ul><li>a</li><li>b</li></ul><ol><li>one</li><li>two</li></ol>",
    );
    expect(markdownToHtml("Title\n===\n\nSub\n---")).toBe("<h1>Title</h1><h2>Sub</h2>");
    expect(markdownToHtml("    indented code")).toBe("<pre><code>indented code</code></pre>");
    expect(markdownToHtml("See <https://example.com/x>")).toBe(
      '<p>See <a href="https://example.com/x">https://example.com/x</a></p>',
    );
  });

  it("keeps a word's underscores as written", () => {
    expect(markdownToHtml("snake_case_name and 2*3*4")).toBe("<p>snake_case_name and 2<em>3</em>4</p>");
  });

  it("shows raw HTML as text, never as HTML", () => {
    expect(markdownToHtml('<script>alert("x")</script> <b>no</b>')).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &lt;b&gt;no&lt;/b&gt;</p>",
    );
    expect(markdownToHtml("[x](javascript:alert(1)) ![y](data:image/png;base64,AA) <javascript:alert(1)>")).toBe(
      "<p>x y &lt;javascript:alert(1)&gt;</p>",
    );
  });

  it("starts an ordered list where its first number says", () => {
    expect(markdownToHtml("3. three\n4. four")).toBe('<ol start="3"><li>three</li><li>four</li></ol>');
  });
});
