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
  | "WidgetUpdateRequest";

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
];
const ownerPattern = /^[A-Za-z ]+$/;

// The schema's "type" and "owner" patterns are unanchored, so they also
// match values that merely contain a valid substring; require a full match.
function hasAnchoredFields(request: WidgetRequest): boolean {
  return requestTypes.includes(request.type) && ownerPattern.test(request.owner);
}

export function isValidWidgetRequest(value: unknown): value is WidgetRequest {
  return (
    validateAgainstSchema(value) &&
    hasAnchoredFields(value) &&
    hasValidOtherAttributes(value)
  );
}
