import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHmacSignature } from "./webhook-signature";

const SECRET = "shhh-verifier-token";
const BODY = '{"eventNotifications":[{"realmId":"123"}]}';

const base64Sig = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body, "utf8").digest("base64");
const hexSig = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body, "utf8").digest("hex");

describe("verifyHmacSignature (AF-M10-18)", () => {
  it("accepts a correct base64 signature — the Intuit form", () => {
    expect(
      verifyHmacSignature({
        rawBody: BODY,
        signature: base64Sig(BODY),
        secret: SECRET,
        encoding: "base64",
      }),
    ).toBe(true);
  });

  it("accepts a correct hex signature behind a prefix — the GitHub form", () => {
    expect(
      verifyHmacSignature({
        rawBody: BODY,
        signature: `sha256=${hexSig(BODY)}`,
        secret: SECRET,
        encoding: "hex",
        prefix: "sha256=",
      }),
    ).toBe(true);
  });

  it("rejects a correct digest sent without the expected prefix", () => {
    // GitHub always sends the prefix. A bare digest means something built the
    // header by hand, and accepting it would widen what counts as valid.
    expect(
      verifyHmacSignature({
        rawBody: BODY,
        signature: hexSig(BODY),
        secret: SECRET,
        encoding: "hex",
        prefix: "sha256=",
      }),
    ).toBe(false);
  });

  it("rejects a signature over a re-serialised body", () => {
    // The reason routes must keep the raw text: parse+stringify is a
    // byte-for-byte different document, so this is what a subtly broken route
    // would produce, and it must not pass.
    // Pretty-printed exactly as a provider might send it. Canonical-looking
    // JSON round-trips unchanged, which is why this fixture is indented: the
    // bug only shows on a body that is not already in JSON.stringify form.
    const sent = JSON.stringify({ realmId: "123", n: 1.5 }, null, 2);
    const reserialised = JSON.stringify(JSON.parse(sent));
    expect(reserialised).not.toBe(sent);
    expect(
      verifyHmacSignature({
        rawBody: sent,
        signature: base64Sig(reserialised),
        secret: SECRET,
        encoding: "base64",
      }),
    ).toBe(false);
    // ...and the same body signed raw does verify.
    expect(
      verifyHmacSignature({
        rawBody: sent,
        signature: base64Sig(sent),
        secret: SECRET,
        encoding: "base64",
      }),
    ).toBe(true);
  });

  it("rejects a body altered after signing", () => {
    const signature = base64Sig(BODY);
    expect(
      verifyHmacSignature({
        rawBody: `${BODY} `,
        signature,
        secret: SECRET,
        encoding: "base64",
      }),
    ).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(
      verifyHmacSignature({
        rawBody: BODY,
        signature: base64Sig(BODY, "the-wrong-token"),
        secret: SECRET,
        encoding: "base64",
      }),
    ).toBe(false);
  });

  it("rejects an absent header rather than throwing", () => {
    for (const signature of [null, undefined, ""]) {
      expect(
        verifyHmacSignature({
          rawBody: BODY,
          signature,
          secret: SECRET,
          encoding: "base64",
        }),
      ).toBe(false);
    }
  });

  it("rejects an empty secret, so an unset env var cannot open the route", () => {
    // The dangerous shape: HMAC with "" is a perfectly valid digest, so a
    // route with no secret configured would happily verify a signature an
    // attacker can compute. This must be a closed door, not an open one.
    expect(
      verifyHmacSignature({
        rawBody: BODY,
        signature: base64Sig(BODY, ""),
        secret: "",
        encoding: "base64",
      }),
    ).toBe(false);
  });

  it("rejects garbage that decodes short instead of throwing", () => {
    // Buffer.from is lenient — it drops invalid characters rather than
    // failing — so a junk header becomes a short buffer. The length check is
    // what rejects it, which is why it is not merely an optimisation.
    expect(
      verifyHmacSignature({
        rawBody: BODY,
        signature: "!!!!not-a-signature!!!!",
        secret: SECRET,
        encoding: "base64",
      }),
    ).toBe(false);
  });

  it("rejects a truncated but otherwise correct digest", () => {
    expect(
      verifyHmacSignature({
        rawBody: BODY,
        signature: hexSig(BODY).slice(0, 32),
        secret: SECRET,
        encoding: "hex",
      }),
    ).toBe(false);
  });

  it("does not confuse the two encodings", () => {
    // A hex digest read as base64 decodes to the wrong bytes at the wrong
    // length. Getting `encoding` wrong must fail closed.
    expect(
      verifyHmacSignature({
        rawBody: BODY,
        signature: hexSig(BODY),
        secret: SECRET,
        encoding: "base64",
      }),
    ).toBe(false);
  });

  it("supports sha1 for providers that still sign with it", () => {
    const sha1 = createHmac("sha1", SECRET).update(BODY, "utf8").digest("hex");
    expect(
      verifyHmacSignature({
        rawBody: BODY,
        signature: `sha1=${sha1}`,
        secret: SECRET,
        encoding: "hex",
        algorithm: "sha1",
        prefix: "sha1=",
      }),
    ).toBe(true);
    // ...and does not accept a sha1 digest where sha256 is expected.
    expect(
      verifyHmacSignature({
        rawBody: BODY,
        signature: `sha256=${sha1}`,
        secret: SECRET,
        encoding: "hex",
        prefix: "sha256=",
      }),
    ).toBe(false);
  });
});
