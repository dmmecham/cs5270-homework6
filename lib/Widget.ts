import { readFileSync } from "node:fs";
import { default as Ajv } from "ajv-draft-04";

const schemaUrl = new URL("../widgetRequest-schema.json", import.meta.url);
const requestSchema = JSON.parse(readFileSync(schemaUrl, "utf8"));

export interface WidgetAttribute {
  name: string;
  value: string | null;
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
  label?: string | null;
  description?: string | null;
  otherAttributes?: WidgetAttribute[] | null;
}

const ajv = new Ajv.default({
  allErrors: true,
  strictTuples: false,
});
const validateAgainstSchema = ajv.compile<WidgetRequest>(requestSchema);

// The schema's tuple-style "items" only constrains the first otherAttributes
// entry, so every entry is checked here as well.
function hasValidOtherAttributes(request: WidgetRequest): boolean {
  const isUpdate = request.type === "update" || request.type === "WidgetUpdateRequest";
  if (request.otherAttributes == null) {
    return request.otherAttributes === undefined || isUpdate;
  }
  for (const attribute of request.otherAttributes) {
    if (
      typeof attribute !== "object" ||
      attribute === null ||
      Array.isArray(attribute) ||
      typeof attribute.name !== "string" ||
      attribute.name.length === 0 ||
      (typeof attribute.value !== "string" && !(isUpdate && attribute.value === null))
    ) {
      return false;
    }
  }
  return true;
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

function forSchemaValidation(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("type" in value)) {
    return value;
  }
  const type = value.type;
  const normalized: Record<string, unknown> = { ...value };
  if (typeof type === "string" && Object.hasOwn(longTypeNames, type)) {
    normalized.type = longTypeNames[type];
  }
  if (type === "update" || type === "WidgetUpdateRequest") {
    if (normalized.label === null) delete normalized.label;
    if (normalized.description === null) delete normalized.description;
    if (normalized.otherAttributes === null) delete normalized.otherAttributes;
    if (Array.isArray(normalized.otherAttributes)) {
      normalized.otherAttributes = normalized.otherAttributes.map((attribute: unknown) =>
        typeof attribute === "object" && attribute !== null &&
        "value" in attribute && attribute.value === null
          ? { ...attribute, value: "" }
          : attribute,
      );
    }
  }
  return normalized;
}

export function widgetRequestValidationError(value: unknown): string | undefined {
  if (!validateAgainstSchema(forSchemaValidation(value))) {
    return ajv.errorsText(validateAgainstSchema.errors);
  }
  const request = value as WidgetRequest;
  if (!hasAnchoredFields(request)) return "invalid request type or owner";
  if (request.widgetId.length === 0) return "widgetId must not be empty";
  if (!hasValidOtherAttributes(request)) return "invalid otherAttributes";
  return undefined;
}

export function isValidWidgetRequest(value: unknown): value is WidgetRequest {
  return widgetRequestValidationError(value) === undefined;
}
