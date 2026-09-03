import { describe, expect, it } from "vitest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { HTTP_AUTH_MODES as DEFINITION_MODES } from "@/nodes/http/request/definition";
import { buildHttpAuth, HTTP_AUTH_MODES } from "./http-auth";

describe("buildHttpAuth (AF-M10-01)", () => {
  it("keeps the isomorphic mode list identical to the server one", () => {
    // The definition cannot import this module (it is server-only), so the
    // enum is duplicated. This is the guard that stops it drifting — a mode
    // offered in the config panel with no implementation would fail at run
    // time, on someone's workflow.
    expect([...DEFINITION_MODES]).toEqual([...HTTP_AUTH_MODES]);
  });

  it("sends nothing for mode none, with or without a credential", () => {
    expect(buildHttpAuth("none", { apiKey: "secret-value" })).toEqual({
      headers: {},
      query: {},
      secretValues: [],
      credentialHeaderNames: [],
    });
    expect(buildHttpAuth(undefined, undefined).headers).toEqual({});
  });

  it("builds a bearer header from token, accessToken or apiKey", () => {
    const secrets: CredentialSecret[] = [
      { token: "tok_abc123" },
      { accessToken: "tok_abc123" },
      { apiKey: "tok_abc123" },
    ];
    for (const secret of secrets) {
      const auth = buildHttpAuth("bearer", secret);
      expect(auth.headers.Authorization).toBe("Bearer tok_abc123");
      expect(auth.secretValues).toContain("tok_abc123");
      expect(auth.credentialHeaderNames).toEqual(["authorization"]);
    }
  });

  it("reads oauth2 strictly from accessToken", () => {
    expect(
      buildHttpAuth("oauth2", { accessToken: "ya29.live" }).headers
        .Authorization,
    ).toBe("Bearer ya29.live");
    // An API key is not an OAuth access token; falling back to one would send
    // the wrong secret to the wrong place and look like it worked.
    expect(() => buildHttpAuth("oauth2", { apiKey: "sk-nope" })).toThrow(
      /accessToken/,
    );
  });

  it("encodes basic auth and treats both forms as secret", () => {
    const auth = buildHttpAuth("basic", {
      username: "alice",
      password: "hunter2-long",
    });
    expect(auth.headers.Authorization).toBe(
      `Basic ${Buffer.from("alice:hunter2-long").toString("base64")}`,
    );
    expect(auth.secretValues).toContain("hunter2-long");
    expect(auth.secretValues).toContain(
      Buffer.from("alice:hunter2-long").toString("base64"),
    );
  });

  it("takes the header name from config first, then the credential", () => {
    expect(
      buildHttpAuth(
        "header",
        { name: "X-From-Credential", value: "v-secret-1" },
        { headerName: "X-From-Config" },
      ).headers,
    ).toEqual({ "X-From-Config": "v-secret-1" });

    expect(
      buildHttpAuth("header", {
        name: "X-From-Credential",
        value: "v-secret-1",
      }).headers,
    ).toEqual({ "X-From-Credential": "v-secret-1" });
  });

  it("reports a custom auth header so redirects can strip it", () => {
    const auth = buildHttpAuth(
      "header",
      { apiKey: "key-secret-1" },
      { headerName: "X-API-Key" },
    );
    // Not one of the fetch spec's credential headers — if this were not
    // reported, a cross-origin redirect would forward the key.
    expect(auth.credentialHeaderNames).toEqual(["x-api-key"]);
  });

  it("puts queryParam auth on the URL, never in a header", () => {
    const auth = buildHttpAuth(
      "queryParam",
      { apiKey: "gcs-key-1234" },
      { queryParamName: "key" },
    );
    expect(auth.query).toEqual({ key: "gcs-key-1234" });
    expect(auth.headers).toEqual({});
    expect(auth.credentialHeaderNames).toEqual([]);
  });

  it("fails loudly when a mode is selected with no credential bound", () => {
    expect(() => buildHttpAuth("bearer", undefined)).toThrow(
      /no credential is bound/i,
    );
  });

  it("never puts secret material in an error message", () => {
    const secret = { irrelevantField: "super-secret-value" };
    try {
      buildHttpAuth("bearer", secret);
      throw new Error("expected buildHttpAuth to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-value");
      expect((error as Error).message).toContain("bearer");
    }
  });
});
