import { describe, expect, it } from "vitest";
import { z } from "zod";
import { findManifestEntry, nodeManifest } from "@/nodes/manifest";
import {
  credentialIdRef,
  freeText,
  urlTemplate,
} from "@/nodes/shared/config-fields";
import {
  resolveConfigFields,
  UnsupportedConfigFieldError,
} from "./config-schema";

describe("resolveConfigFields — field kinds (AF-M1-06)", () => {
  it("classifies a string that rejects newlines as single-line", () => {
    const fields = resolveConfigFields(
      z.object({ slug: z.string().regex(/^[a-z0-9-]+$/) }),
    );
    expect(fields[0].kind).toBe("string");
  });

  it("classifies free-text and length-capped strings as multiline", () => {
    const fields = resolveConfigFields(
      z.object({
        prompt: freeText(100_000),
        message: z.string().max(4096),
      }),
    );
    expect(fields.map((f) => [f.key, f.kind])).toEqual(
      expect.arrayContaining([
        ["prompt", "multiline"],
        ["message", "multiline"],
      ]),
    );
  });

  it("classifies refined URL templates as single-line", () => {
    const fields = resolveConfigFields(
      z.object({ endpoint: urlTemplate(2048) }),
    );
    expect(fields[0].kind).toBe("string");
  });

  it("classifies email addresses as single-line", () => {
    const fields = resolveConfigFields(
      z.object({ to: z.string().email("Invalid from email") }),
    );
    expect(fields[0].kind).toBe("string");
  });

  it("classifies numbers — including .int() — as number", () => {
    const fields = resolveConfigFields(
      z.object({ timeoutMs: z.number().int().min(250).max(60_000) }),
    );
    expect(fields[0].kind).toBe("number");
  });

  it("classifies booleans as boolean", () => {
    const fields = resolveConfigFields(z.object({ enabled: z.boolean() }));
    expect(fields[0].kind).toBe("boolean");
  });

  it("exposes enum values", () => {
    const fields = resolveConfigFields(
      z.object({ method: z.enum(["GET", "POST", "PUT"]) }),
    );
    expect(fields[0].kind).toBe("enum");
    expect(fields[0].enumValues).toEqual(["GET", "POST", "PUT"]);
  });

  it("classifies an array of enums as multiEnum (AF-M10-16)", () => {
    // "Which of these event types?" is a checkbox group, not a row editor.
    // Added for the QuickBooks trigger's entity/operation filters; the same
    // shape recurs for every webhook connector that lets you narrow events.
    const fields = resolveConfigFields(
      z.object({ operations: z.array(z.enum(["Create", "Update", "Delete"])) }),
    );
    expect(fields[0].kind).toBe("multiEnum");
    expect(fields[0].enumValues).toEqual(["Create", "Update", "Delete"]);
  });

  it("still rejects an array of bare strings, which has no choices to offer", () => {
    expect(() =>
      resolveConfigFields(z.object({ tags: z.array(z.string()) })),
    ).toThrow(UnsupportedConfigFieldError);
  });

  it("rejects a multiEnum nested inside a fieldList row", () => {
    // The row editor renders scalars; a checkbox group inside a table cell is
    // not a control it has, and silently dropping the column would lose data.
    expect(() =>
      resolveConfigFields(
        z.object({
          rules: z.array(
            z.object({
              name: z.string(),
              on: z.array(z.enum(["a", "b"])),
            }),
          ),
        }),
      ),
    ).toThrow(UnsupportedConfigFieldError);
  });

  it("classifies record<string,string> as kv-list", () => {
    const fields = resolveConfigFields(
      z.object({ headers: z.record(z.string(), z.string()) }),
    );
    expect(fields[0].kind).toBe("kv-list");
  });

  it("classifies array<{key,value}>.max(50) as keyValueList", () => {
    const fields = resolveConfigFields(
      z.object({
        values: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .max(50),
      }),
    );
    expect(fields[0].kind).toBe("keyValueList");
  });

  it("classifies a row of scalar columns as fieldList with column descriptors", () => {
    const fields = resolveConfigFields(
      z.object({
        extractionFields: z.array(
          z.object({
            name: z
              .string()
              .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
              .max(64),
            type: z.enum(["string", "number", "boolean", "object"]),
            description: z.string().max(2000).optional(),
          }),
        ),
      }),
    );
    expect(fields[0].kind).toBe("fieldList");
    expect(fields[0].columns?.map((c) => [c.key, c.kind, c.label])).toEqual([
      ["name", "string", "Name"],
      ["type", "enum", "Type"],
      ["description", "multiline", "Description"],
    ]);
    expect(fields[0].columns?.[1].enumValues).toEqual([
      "string",
      "number",
      "boolean",
      "object",
    ]);
  });

  it("does not misclassify a two-column row with a typed column as keyValueList", () => {
    const fields = resolveConfigFields(
      z.object({
        options: z.array(
          z.object({ label: z.string(), kind: z.enum(["a", "b"]) }),
        ),
      }),
    );
    expect(fields[0].kind).toBe("fieldList");
  });

  it("throws a keyed error when an array element column is unsupported", () => {
    expect(() =>
      resolveConfigFields(
        z.object({ rows: z.array(z.object({ at: z.date() })) }),
      ),
    ).toThrow(UnsupportedConfigFieldError);
  });

  it("throws a keyed error when an array element is a nested list column", () => {
    expect(() =>
      resolveConfigFields(
        z.object({
          rows: z.array(
            z.object({
              name: z.string(),
              tags: z.array(z.object({ key: z.string(), value: z.string() })),
            }),
          ),
        }),
      ),
    ).toThrow(UnsupportedConfigFieldError);
  });

  it("throws a keyed error when an array element is not an object row", () => {
    expect(() =>
      resolveConfigFields(z.object({ tags: z.array(z.string()) })),
    ).toThrow(UnsupportedConfigFieldError);
  });

  it("marks optional and default fields as optional", () => {
    const fields = resolveConfigFields(
      z.object({
        prompt: freeText(100_000).optional(),
        count: z.number().default(0),
      }),
    );
    expect(fields.find((f) => f.key === "prompt")?.optional).toBe(true);
    expect(fields.find((f) => f.key === "count")?.optional).toBe(true);
  });

  it("leaves bare fields required", () => {
    const fields = resolveConfigFields(z.object({ name: z.string() }));
    expect(fields[0].optional).toBe(false);
  });

  it("resolves credential refs from definition.credentials", () => {
    const fields = resolveConfigFields(
      z.object({ credentialId: credentialIdRef() }),
      [{ key: "credentialId", type: "smtp", required: true }],
    );
    expect(fields[0].kind).toBe("credential");
    expect(fields[0].credential?.type).toBe("smtp");
  });

  it("humanizes labels from camelCase keys", () => {
    const fields = resolveConfigFields(z.object({ queryParams: z.string() }));
    expect(fields[0].label).toBe("Query Params");
  });

  it("throws a keyed error for unsupported kinds", () => {
    expect(() =>
      resolveConfigFields(z.object({ born: z.date(), tag: z.string() })),
    ).toThrow(UnsupportedConfigFieldError);
  });

  it("throws for a nested object field", () => {
    expect(() =>
      resolveConfigFields(z.object({ meta: z.object({ a: z.string() }) })),
    ).toThrow(UnsupportedConfigFieldError);
  });

  it("returns no fields for an empty (trigger) config", () => {
    expect(resolveConfigFields(z.object({}).optional())).toEqual([]);
  });
});

describe("resolveConfigFields — real catalogue (AF-M1-06)", () => {
  it("resolves every manifest definition's config without throwing", () => {
    for (const definition of nodeManifest) {
      expect(() =>
        resolveConfigFields(definition.configSchema, definition.credentials),
      ).not.toThrow();
    }
  });

  it("resolves EMAIL_SEND with each expected kind", () => {
    const definition = findManifestEntry("EMAIL_SEND");
    expect(definition).toBeDefined();
    if (!definition) throw new Error("EMAIL_SEND missing from manifest");
    const fields = resolveConfigFields(
      definition.configSchema,
      definition.credentials,
    );
    const byKey = new Map(fields.map((f) => [f.key, f.kind]));
    expect(byKey.get("credentialId")).toBe("credential");
    expect(byKey.get("from")).toBe("string");
    expect(byKey.get("subject")).toBe("multiline");
    expect(byKey.get("body")).toBe("multiline");
    expect(fields.find((f) => f.key === "credentialId")?.optional).toBe(true);
  });

  it("exposes HTTP_REQUEST's enum, record, number, and boolean fields", () => {
    const definition = findManifestEntry("HTTP_REQUEST");
    expect(definition).toBeDefined();
    if (!definition) throw new Error("HTTP_REQUEST missing from manifest");
    const fields = resolveConfigFields(definition.configSchema);
    const byKey = new Map(fields.map((f) => [f.key, f]));
    expect(byKey.get("method")?.kind).toBe("enum");
    expect(byKey.get("method")?.enumValues).toEqual([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
    ]);
    expect(byKey.get("headers")?.kind).toBe("kv-list");
    expect(byKey.get("queryParams")?.kind).toBe("kv-list");
    expect(byKey.get("timeoutMs")?.kind).toBe("number");
    expect(byKey.get("failOnNon2xx")?.kind).toBe("boolean");
    expect(byKey.get("body")?.kind).toBe("multiline");
  });

  it("resolves AI_EXTRACT's field list and JSON schema escape hatch", () => {
    const definition = findManifestEntry("AI_EXTRACT");
    expect(definition).toBeDefined();
    if (!definition) throw new Error("AI_EXTRACT missing from manifest");
    const fields = resolveConfigFields(
      definition.configSchema,
      definition.credentials,
    );
    const byKey = new Map(fields.map((f) => [f.key, f]));
    expect(byKey.get("jsonSchema")?.kind).toBe("multiline");
    expect(byKey.get("fields")?.kind).toBe("fieldList");
    expect(byKey.get("fields")?.columns?.map((c) => c.key)).toEqual([
      "name",
      "type",
      "description",
    ]);
    expect(byKey.get("fields")?.optional).toBe(true);
  });
});
