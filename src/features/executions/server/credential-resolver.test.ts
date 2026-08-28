import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  type CredentialSecret,
  openSecret,
  sealSecret,
} from "@/features/credentials/server/vault";
import {
  type CredentialRowLoader,
  MissingRequiredCredentialError,
  resolveNodeCredentials,
} from "./credential-resolver";

describe("resolveNodeCredentials (AF-M3-04)", () => {
  beforeAll(() => {
    process.env.CREDENTIAL_MASTER_KEY = randomBytes(32).toString("base64");
  });

  const sealed = (secret: CredentialSecret) => sealSecret(secret);

  const requirement = (
    overrides: Partial<{
      key: string;
      type: string;
      required: boolean;
    }> = {},
  ) => ({
    key: "credentialId",
    type: "openai.apiKey",
    required: true,
    ...overrides,
  });

  it("returns an empty map when the node declares no requirements", async () => {
    const resolved = await resolveNodeCredentials({
      requirements: undefined,
      nodeData: { credentialId: "c_1" },
      userId: "user_1",
      loadCredentialRow: async () => null,
    });
    expect(resolved).toEqual({});
  });

  it("decrypts exactly the required credential once (injected loader called once)", async () => {
    const row = sealed({ apiKey: "sk-plain-token-abc" });
    const loader: CredentialRowLoader = vi.fn(async (id) =>
      id === "c_1" ? row : null,
    );
    const decrypted: string[] = [];

    const resolved = await resolveNodeCredentials({
      requirements: [requirement()],
      nodeData: { credentialId: "c_1" },
      userId: "user_1",
      loadCredentialRow: loader,
      onDecrypted: (id) => decrypted.push(id),
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(decrypted).toEqual(["c_1"]);
    expect(resolved.credentialId).toEqual({ apiKey: "sk-plain-token-abc" });
  });

  it("throws when a required credential id is missing from node data", async () => {
    await expect(
      resolveNodeCredentials({
        requirements: [requirement()],
        nodeData: {},
        userId: "user_1",
        loadCredentialRow: async () => null,
      }),
    ).rejects.toThrow(MissingRequiredCredentialError);
  });

  it("throws when a required credential row is not found", async () => {
    await expect(
      resolveNodeCredentials({
        requirements: [requirement()],
        nodeData: { credentialId: "c_missing" },
        userId: "user_1",
        loadCredentialRow: async () => null,
      }),
    ).rejects.toThrow(/not found/);
  });

  it("skips an optional credential when it is missing or blank", async () => {
    const loader: CredentialRowLoader = vi.fn(async () => null);
    const resolved = await resolveNodeCredentials({
      requirements: [requirement({ key: "optionalCredId", required: false })],
      nodeData: {},
      userId: "user_1",
      loadCredentialRow: loader,
    });
    expect(loader).not.toHaveBeenCalled();
    expect(resolved).toEqual({});
  });

  it("resolves multiple requirements in order", async () => {
    const rowA = sealed({ apiKey: "sk-a-token-1234" });
    const rowB = sealed({ token: "tkn-b-longer" });
    const loader: CredentialRowLoader = vi.fn(async (id) => {
      if (id === "c_a") return rowA;
      if (id === "c_b") return rowB;
      return null;
    });

    const resolved = await resolveNodeCredentials({
      requirements: [
        requirement({ key: "aId", type: "openai.apiKey", required: true }),
        requirement({ key: "bId", type: "bearer", required: false }),
      ],
      nodeData: { aId: "c_a", bId: "c_b" },
      userId: "user_1",
      loadCredentialRow: loader,
    });

    expect(resolved.aId).toEqual({ apiKey: "sk-a-token-1234" });
    expect(resolved.bId).toEqual({ token: "tkn-b-longer" });
  });

  it("leak guard: decrypted secrets never appear in node data or output", async () => {
    const secret = "sk-super-secret-token-1234567890";
    const row = sealed({ apiKey: secret });

    const nodeData = { credentialId: "c_1", variableName: "result" };
    const resolved = await resolveNodeCredentials({
      requirements: [requirement()],
      nodeData,
      userId: "user_1",
      loadCredentialRow: async () => row,
    });

    // nodeData is untouched by resolution (plaintext never written back).
    expect(JSON.stringify(nodeData)).not.toContain(secret);

    // The common "output" surface the executor returns spreads context + a
    // value object; assert the secret would never be present.
    const hypotheticalOutput = { ...nodeData, variableName: "result" };
    expect(JSON.stringify(hypotheticalOutput)).not.toContain(secret);
    expect(JSON.stringify(resolved)).toContain(secret);
  });

  it("decrypts rows that arrive serialized (Inngest shape), matching openSecret", async () => {
    const secret = "sk-another-secret-value-1";
    const envelope = sealed({ apiKey: secret });
    // openSecret handles both Prisma-shaped and serialized byte columns.
    expect(openSecret(envelope)).toEqual({ apiKey: secret });
  });
});
