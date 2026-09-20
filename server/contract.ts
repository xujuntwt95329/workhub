import { zodToJsonSchema } from "zod-to-json-schema";
import { dataSchemas, inputSchema } from "../shared/domain";
export const recordContract = {
  version: 2,
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
    "Updates require expectedVersion. Read the current record again on 409 VERSION_CONFLICT.",
    "Use a stable Idempotency-Key header for retries of the same mutation.",
    "Only the Owner may approve, waive, accept, or lower an existing gate.",
    "Quality runs are append-only. Bind codeRef, checkVersion, criterionVersions and requirementVersions to the exact versions tested.",
    "Principles belong to one task. Todos may be global or task-owned. Use assign_todo_to_task to move a todo.",
    "Requirement groups belong to one task. Link requirements through groupId and test cases through criterionIds. Rejected/deleted requirements remain readable but do not contribute to active acceptance.",
  ],
};
