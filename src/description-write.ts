import {
  parseAzureWorkItemId,
  requestAzureDevOps,
  type AzureDevOpsConnectionInput,
  type AzureWorkItem,
} from "./azure-devops.js";
import { toAzureMarkdown } from "./comments.js";
import type {
  BacklogWriteDescriptionRequest,
  BacklogWriteDescriptionResult,
} from "./contract.js";
import { describeWorkItem, isMarkdownField } from "./description.js";
import { markdownToHtml } from "./markdown-html.js";

/** The longest description Azure DevOps takes, as it measures: the stored HTML or Markdown. */
export const AZURE_DESCRIPTION_MAX_LENGTH = 1_000_000;

const DESCRIPTION_FIELDS = "System.Description,System.AssignedTo";

/** Whether a refused patch is how Azure DevOps answers a failed test operation. */
function isRevisionTestFailure(error: unknown) {
  return error instanceof Error && /request failed \((?:400|409|412)\)/.test(error.message);
}

function requireWorkItemId(config: AzureDevOpsConnectionInput, sourceId: string) {
  const id = parseAzureWorkItemId(sourceId, config.organizationUrl);
  if (id === null) {
    throw new Error(`"${sourceId}" is not an Azure DevOps work item.`);
  }
  return id;
}

async function fetchDescription(config: AzureDevOpsConnectionInput, id: number) {
  return await requestAzureDevOps<AzureWorkItem>(
    config,
    `/_apis/wit/workitems/${id}?fields=${DESCRIPTION_FIELDS}&api-version=7.1`,
  );
}

/**
 * Writes the user's description, unless the item's description changed since
 * Ajour read it: the current one, converted as a sync converts it, must still
 * be `expected`. The write tests the item's revision too, so a change made in
 * between answers with a conflict rather than being lost. An item that stores
 * its description as Markdown gets Markdown; any other gets HTML.
 */
export async function writeAzureDescription(
  config: AzureDevOpsConnectionInput,
  request: BacklogWriteDescriptionRequest,
): Promise<BacklogWriteDescriptionResult> {
  const id = requireWorkItemId(config, request.sourceId);
  const workItem = await fetchDescription(config, id);
  const current = describeWorkItem(workItem);
  if (current.text !== request.expected) {
    return { outcome: "conflict", description: current };
  }
  // The same text can come from formatting a colleague added since Ajour read
  // it, which the write would erase.
  if (current.cut || current.lost?.length) {
    throw new Error(
      current.cut
        ? "This description is longer than Ajour keeps. Edit it in Azure DevOps."
        : `Writing it would lose its ${current.lost!.join(", ")} in Azure DevOps. Edit it there.`,
    );
  }

  const markdown = isMarkdownField(workItem, "System.Description");
  const value = markdown ? toAzureMarkdown(request.text) : markdownToHtml(request.text);
  if (value.length > AZURE_DESCRIPTION_MAX_LENGTH) {
    throw new Error(
      `This description is too long for Azure DevOps: ${value.length.toLocaleString("en-US")} of ${AZURE_DESCRIPTION_MAX_LENGTH.toLocaleString("en-US")} characters once converted.`,
    );
  }

  const operations = [
    ...(typeof workItem.rev === "number" ? [{ op: "test", path: "/rev", value: workItem.rev }] : []),
    { op: "add", path: "/fields/System.Description", value },
    ...(markdown
      ? [{ op: "add", path: "/multilineFieldsFormat/System.Description", value: "Markdown" }]
      : []),
  ];
  let written: AzureWorkItem;
  try {
    written = await requestAzureDevOps<AzureWorkItem>(
      config,
      `/_apis/wit/workitems/${id}?api-version=7.1`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json-patch+json" },
        body: JSON.stringify(operations),
      },
    );
  } catch (error) {
    // A failed revision test, as Azure DevOps answers one: someone changed the
    // item in between. Any other refusal, such as a missing permission, stays.
    if (!isRevisionTestFailure(error)) throw error;
    const now = await fetchDescription(config, id).catch(() => undefined);
    if (now && typeof now.rev === "number" && now.rev !== workItem.rev) {
      return { outcome: "conflict", description: describeWorkItem(now) };
    }
    throw error;
  }
  // The answer holds the item's fields; without them, read it again.
  const answered =
    written?.fields?.["System.Description"] !== undefined ? written : await fetchDescription(config, id);
  return { outcome: "written", description: describeWorkItem(answered) };
}
