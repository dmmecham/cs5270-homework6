import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidWidgetRequest } from "../lib/Widget.js";

describe("isValidWidgetRequest", () => {
  it("accepts a create request matching the schema", () => {
    assert.equal(
      isValidWidgetRequest({
        type: "WidgetCreateRequest",
        requestId: "request-1",
        widgetId: "widget-1",
        owner: "Jane Doe",
        label: "Example",
        description: "A widget",
        otherAttributes: [{ name: "color", value: "blue" }],
      }),
      true,
    );
  });

  it("requires the type and owner to match their patterns in full", () => {
    const baseRequest = {
      type: "WidgetCreateRequest",
      requestId: "request-1",
      widgetId: "widget-1",
      owner: "Jane Doe",
    };

    for (const type of [
      "prefix-WidgetCreateRequest-suffix",
      "WidgetCreateRequest|WidgetDeleteRequest",
      "WidgetCreateRequestX",
    ]) {
      assert.equal(isValidWidgetRequest({ ...baseRequest, type }), false, type);
    }
    for (const owner of ["A1", "Jane-Doe", "Jane\nDoe"]) {
      assert.equal(isValidWidgetRequest({ ...baseRequest, owner }), false, owner);
    }
    for (const type of ["WidgetDeleteRequest", "WidgetUpdateRequest"]) {
      assert.equal(isValidWidgetRequest({ ...baseRequest, type }), true, type);
    }
  });

  it("rejects a request missing required properties", () => {
    assert.equal(
      isValidWidgetRequest({
        type: "create",
        requestId: "request-1",
        owner: "Jane Doe",
      }),
      false,
    );
  });

  it("rejects an unsupported type and invalid optional property types", () => {
    const baseRequest = {
      requestId: "request-1",
      widgetId: "widget-1",
      owner: "Jane Doe",
    };

    assert.equal(
      isValidWidgetRequest({ ...baseRequest, type: "remove" }),
      false,
    );
    assert.equal(
      isValidWidgetRequest({
        ...baseRequest,
        type: "WidgetCreateRequest",
        label: 10,
      }),
      false,
    );
  });

  it("validates every otherAttributes entry, not just the first", () => {
    const baseRequest = {
      type: "WidgetCreateRequest",
      requestId: "request-1",
      widgetId: "widget-1",
      owner: "Jane Doe",
    };

    assert.equal(
      isValidWidgetRequest({
        ...baseRequest,
        otherAttributes: [{ name: "color" }],
      }),
      false,
    );
    assert.equal(
      isValidWidgetRequest({
        ...baseRequest,
        otherAttributes: [
          { name: "color", value: "blue" },
          { name: 7 },
        ],
      }),
      false,
    );
    assert.equal(
      isValidWidgetRequest({
        ...baseRequest,
        otherAttributes: [
          { name: "color", value: "blue" },
          { name: "", value: "x" },
        ],
      }),
      false,
    );
  });
});
