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

export function isValidWidgetRequest(value: unknown): value is WidgetRequest {
  return validateAgainstSchema(value) && hasValidOtherAttributes(value);
}
