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

  it("accepts null update fields as no-ops but rejects them for creation", () => {
    const request = {
      requestId: "r", widgetId: "w", owner: "Jane Doe",
      label: null, description: null, otherAttributes: [{ name: "color", value: null }],
    };
    assert.equal(isValidWidgetRequest({ ...request, type: "update" }), true);
    assert.equal(isValidWidgetRequest({ ...request, type: "WidgetUpdateRequest" }), true);
    assert.equal(isValidWidgetRequest({ ...request, type: "update", otherAttributes: null }), true);
    assert.equal(isValidWidgetRequest({ ...request, type: "create", otherAttributes: null }), false);
    assert.equal(isValidWidgetRequest({ ...request, type: "create" }), false);
    assert.equal(isValidWidgetRequest({
      ...request, type: "update", otherAttributes: [{ name: "color", value: 3 }],
    }), false);
  });

  it("rejects non-objects and invalid or missing required fields", () => {
    const request = { type: "create", requestId: "r", widgetId: "w", owner: "Jane Doe" };
    const arrayWithProperties = Object.assign([], request);
    for (const input of [null, [], arrayWithProperties, "request", 0, true]) {
      assert.equal(isValidWidgetRequest(input), false);
    }
    for (const name of ["type", "requestId", "widgetId", "owner"] as const) {
      const input: Partial<typeof request> = { ...request };
      delete input[name];
      assert.equal(isValidWidgetRequest(input), false, `missing ${name}`);
    }
    for (const input of [
      { ...request, type: null },
      { ...request, requestId: 12 },
      { ...request, widgetId: null },
      { ...request, widgetId: "" },
      { ...request, owner: 42 },
      { ...request, owner: "" },
    ]) {
      assert.equal(isValidWidgetRequest(input), false, JSON.stringify(input));
    }
    for (const type of ["create", "update", "delete"]) {
      assert.equal(isValidWidgetRequest({ ...request, type, widgetId: "" }), false, type);
    }
    assert.equal(isValidWidgetRequest({ ...request, requestId: "" }), true);
  });

  it("rejects invalid owner characters and malformed optional properties", () => {
    const request = { type: "create", requestId: "r", widgetId: "w", owner: "Jane Doe" };
    for (const owner of ["Jane Doe\n", "Jane Doe\r\n", "Jane\tDoe", "Jane\u2028Doe", "José"]) {
      assert.equal(isValidWidgetRequest({ ...request, owner }), false, JSON.stringify(owner));
    }
    for (const input of [
      { ...request, label: null },
      { ...request, description: false },
      { ...request, otherAttributes: {} },
      { ...request, otherAttributes: "color" },
      { ...request, type: "update", label: 1 },
      { ...request, type: "update", description: [] },
    ]) {
      assert.equal(isValidWidgetRequest(input), false, JSON.stringify(input));
    }
    assert.equal(isValidWidgetRequest({ ...request, label: "", description: "", otherAttributes: [] }), true);
  });

  it("validates the shape of every nested attribute, including update nulls", () => {
    const request = { type: "create", requestId: "r", widgetId: "w", owner: "Jane Doe" };
    const valid = { name: "color", value: "blue" };
    for (const attribute of [
      null, [], "attribute", { value: "x" }, { name: "color" },
      { name: "", value: "x" }, { name: 7, value: "x" },
      { name: "color", value: 7 }, { name: "color", value: null },
    ]) {
      assert.equal(
        isValidWidgetRequest({ ...request, otherAttributes: [valid, attribute] }),
        false,
        JSON.stringify(attribute),
      );
    }
    for (const type of ["update", "WidgetUpdateRequest"]) {
      assert.equal(isValidWidgetRequest({
        ...request, type, otherAttributes: [valid, { name: "color", value: null }],
      }), true);
      assert.equal(isValidWidgetRequest({
        ...request, type, otherAttributes: [valid, { name: "color" }],
      }), false);
    }
    const arrayWithProperties = Object.assign([], { name: "color", value: "red" });
    assert.equal(isValidWidgetRequest({
      ...request, otherAttributes: [valid, arrayWithProperties],
    }), false);
    const sparse = [valid, ,];
    assert.equal(isValidWidgetRequest({ ...request, otherAttributes: sparse }), false);
    assert.equal(isValidWidgetRequest({
      ...request, extra: "allowed", otherAttributes: [{ ...valid, extra: "allowed" }],
    }), true);
  });
});
