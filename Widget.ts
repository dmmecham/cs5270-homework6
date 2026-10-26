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

export const WIDGET_OWNER_PATTERN = new RegExp("^[A-Za-z ]+$");

const widgetRequestTypes: readonly WidgetRequestType[] = [
  "WidgetCreateRequest",
  "WidgetDeleteRequest",
  "WidgetUpdateRequest",
];

export function isValidWidgetRequest(value: unknown): value is WidgetRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Record<string, unknown>;

  if (
    typeof request.type !== "string" ||
    !widgetRequestTypes.includes(request.type as WidgetRequestType)
  ) {
    return false;
  }

  if (typeof request.requestId !== "string") {
    return false;
  }

  if (typeof request.widgetId !== "string") {
    return false;
  }

  if (
    typeof request.owner !== "string" ||
    !WIDGET_OWNER_PATTERN.test(request.owner)
  ) {
    return false;
  }

  if (
    request.label !== undefined &&
    typeof request.label !== "string"
  ) {
    return false;
  }

  if (
    request.description !== undefined &&
    typeof request.description !== "string"
  ) {
    return false;
  }

  if (request.otherAttributes !== undefined) {
    if (!Array.isArray(request.otherAttributes)) {
      return false;
    }

    if (
      !request.otherAttributes.every(
        (attribute): attribute is WidgetAttribute =>
          typeof attribute === "object" &&
          attribute !== null &&
          typeof (attribute as Record<string, unknown>).name === "string" &&
          typeof (attribute as Record<string, unknown>).value === "string",
      )
    ) {
      return false;
    }
  }

  return true;
}