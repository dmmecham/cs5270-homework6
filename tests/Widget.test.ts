import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isValidWidgetRequest } from "../lib/Widget.ts";

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
      "created",
      "xcreate",
    ]) {
      assert.equal(isValidWidgetRequest({ ...baseRequest, type }), false, type);
    }
    for (const owner of ["A1", "Jane-Doe", "Jane\nDoe"]) {
      assert.equal(isValidWidgetRequest({ ...baseRequest, owner }), false, owner);
    }
    for (const type of [
      "WidgetDeleteRequest",
      "WidgetUpdateRequest",
      "create",
      "update",
      "delete",
    ]) {
      assert.equal(isValidWidgetRequest({ ...baseRequest, type }), true, type);
    }
  });

  it("validates the requests in the sample-requests directory", () => {
    const dir = new URL("../../sample-requests/", import.meta.url);
    if (!existsSync(dir)) {
      return;
    }
    // These samples are deliberately invalid: type "bad" and no owner.
    const invalidSamples = new Set(["1612306375135", "1612306375892"]);
    for (const name of readdirSync(dir)) {
      const text = readFileSync(new URL(name, dir), "utf8");
      if (text.trim() === "") {
        continue;
      }
      assert.equal(
        isValidWidgetRequest(JSON.parse(text)),
        !invalidSamples.has(name),
        name,
      );
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
