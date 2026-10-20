import type { AzureWorkItem } from "./azure-devops.js";
import type { ConnectorSyncedDescription } from "./contract.js";
import { htmlToMarkdownWithLosses } from "./html-markdown.js";

/** The most of a description Ajour stores (Ajour's ADR 0009). */
export const MAX_DESCRIPTION_LENGTH = 64_000;

/** Whether a multiline field holds Markdown rather than HTML. */
export function isMarkdownField(workItem: AzureWorkItem, field: string) {
  const format = workItem.multilineFieldsFormat?.[field];
  return typeof format === "string" && format.toLowerCase() === "markdown";
}

/**
 * A work item's description as Ajour syncs it: Markdown, what the conversion
 * from HTML dropped, and whether it was cut to what Ajour stores. Since 2025
 * an item can store its description as Markdown, which is kept as written.
 */
export function describeWorkItem(workItem: AzureWorkItem): ConnectorSyncedDescription {
  const value = workItem.fields?.["System.Description"];
  let text = "";
  let lost: string[] = [];
  if (typeof value === "string") {
    if (isMarkdownField(workItem, "System.Description")) {
      text = value.replace(/\r\n?/g, "\n").trim();
    } else {
      const converted = htmlToMarkdownWithLosses(value);
      text = converted.markdown ?? "";
      lost = converted.lost;
    }
  }
  const cut = text.length > MAX_DESCRIPTION_LENGTH;
  if (cut) {
    text = text.slice(0, MAX_DESCRIPTION_LENGTH);
    // Never leave half of a character made of two code units.
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  }
  return {
    text,
    ...(lost.length > 0 ? { lost } : {}),
    ...(cut ? { cut: true } : {}),
  };
}
