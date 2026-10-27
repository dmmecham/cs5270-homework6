import { readFileSync } from "node:fs";
import { default as Ajv } from "ajv-draft-04";
import type { ValidateFunction } from "ajv";

const schemaUrl = new URL("../widgetRequest-schema.json", import.meta.url);
const requestSchema = JSON.parse(readFileSync(schemaUrl, "utf8"));

export type WidgetRequestType =
  | "WidgetCreateRequest"
  | "WidgetDeleteRequest"
  | "WidgetUpdateRequest";

export interface WidgetAttribute {
  name: string;
  value: string;
}

export interface WidgetRequest {
  type: WidgetRequestType;
  requestId: string;
  widgetId: string;
  owner: string;
  label?: string;
  description?: string;
  otherAttributes?: WidgetAttribute[];
}

export const isValidWidgetRequest: ValidateFunction<WidgetRequest> = new Ajv.default({
  allErrors: true,
}).compile<WidgetRequest>(requestSchema);
