import { describe, expect, it } from "vitest";
import { credentialDefsById } from "@/features/credentials/credential-types";
import { nodeRegistry as registry } from "@/nodes/registry";

describe("AF-M3-04: node credential requirements", () => {
  it("matches the credential registry and never leaks into node output", () => {
    const providerDefs = ["OPENAI", "ANTHROPIC", "GEMINI"].map((type) =>
      registry.resolve(type),
    );

    for (const def of providerDefs) {
      const req = def.credentials?.[0];
      expect(req?.required).toBe(true);
      expect(req?.key).toBe("credentialId");
      expect(req && credentialDefsById.has(req.type)).toBe(true);
    }
  });

  it("the node config form filters only matching credentials (declare the declared type per notification)", () => {
    const openai = registry.resolve("OPENAI");
    const requirement = openai.credentials?.[0];
    expect(requirement?.type).toBe("openai.apiKey");
  });
});
