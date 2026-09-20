import { zodToJsonSchema } from "zod-to-json-schema";
import { dataSchemas, inputSchema, starKinds } from "../shared/domain";
export const recordContract = {
  version: 2,
  starKinds,
  input: zodToJsonSchema(inputSchema),
  data: Object.fromEntries(
    Object.entries(dataSchemas).map(([kind, schema]) => [
      kind,
      zodToJsonSchema(schema),
    ]),
  ),
  serverManagedFields: [
    "waiver",
    "targetTaskId",
    "principles",
    "principleChecks",
    "disposition",
  ],
  rules: [
    "The top-level starred boolean is shared workspace metadata. Set it through POST /api/v1/records/:id/star or set_record_star; filter with starred in list_records or GET /api/v1/records. Requires scoped write permission. It never changes content versions, approvals or quality evidence, and remains editable for closed or inactive records.",
    "Content updates require expectedVersion. Read the current record again on 409 VERSION_CONFLICT.",
    "Use a stable Idempotency-Key header for retries of the same mutation.",
    "Only the Owner may approve, waive, accept, or lower an existing gate.",
    "Quality runs are append-only. Bind codeRef, checkVersion, criterionVersions and requirementVersions to the exact versions tested.",
    "Principles belong to one task. Todos may be global or task-owned. Use assign_todo_to_task to move a todo.",
    "Requirement groups belong to one task. Link requirements through groupId and test cases through criterionIds. Rejected/deleted requirements remain readable but do not contribute to active acceptance.",
  ],
};
