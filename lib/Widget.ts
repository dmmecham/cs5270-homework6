import { readFileSync } from "node:fs";
import { default as Ajv } from "ajv-draft-04";

const schemaUrl = new URL("../widgetRequest-schema.json", import.meta.url);
const requestSchema = JSON.parse(readFileSync(schemaUrl, "utf8"));

export interface WidgetAttribute {
  name: string;
  value: string;
}

export type WidgetRequestType =
  | "WidgetCreateRequest"
  | "WidgetDeleteRequest"
  | "WidgetUpdateRequest"
  | "create"
  | "delete"
  | "update";

export interface WidgetRequest {
  type: WidgetRequestType;
  requestId: string;
  widgetId: string;
  owner: string;
  label?: string;
  description?: string;
  otherAttributes?: WidgetAttribute[];
}

const validateAgainstSchema = new Ajv.default({
  allErrors: true,
  strictTuples: false,
}).compile<WidgetRequest>(requestSchema);

// The schema's tuple-style "items" only constrains the first otherAttributes
// entry, so every entry is checked here as well.
function hasValidOtherAttributes(request: WidgetRequest): boolean {
  return (
    request.otherAttributes === undefined ||
    request.otherAttributes.every(
      (attribute) =>
        typeof attribute === "object" &&
        attribute !== null &&
        typeof attribute.name === "string" &&
        attribute.name.length > 0 &&
        typeof attribute.value === "string",
    )
  );
}

const requestTypes: readonly string[] = [
  "WidgetCreateRequest",
  "WidgetDeleteRequest",
  "WidgetUpdateRequest",
  "create",
  "delete",
  "update",
];
const ownerPattern = /^[A-Za-z ]+$/;

// The schema's "type" and "owner" patterns are unanchored, so they also
// match values that merely contain a valid substring; require a full match.
function hasAnchoredFields(request: WidgetRequest): boolean {
  return requestTypes.includes(request.type) && ownerPattern.test(request.owner);
}

// Sample requests use the short type names (create/update/delete), which the
// schema's type pattern does not accept, so the schema check sees the long name.
const longTypeNames: Record<string, string> = {
  create: "WidgetCreateRequest",
  delete: "WidgetDeleteRequest",
  update: "WidgetUpdateRequest",
};

function withSchemaTypeName(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return value;
  }
  const longName = longTypeNames[String(value.type)];
  return longName === undefined ? value : { ...value, type: longName };
}

export function isValidWidgetRequest(value: unknown): value is WidgetRequest {
  return (
    validateAgainstSchema(withSchemaTypeName(value)) &&
    hasAnchoredFields(value as WidgetRequest) &&
    hasValidOtherAttributes(value as WidgetRequest)
  );
}
