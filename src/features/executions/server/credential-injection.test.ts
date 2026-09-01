import { describe, expect, it } from "vitest";
import { credentialDefsById } from "@/features/credentials/credential-types";
import { nodeManifest } from "@/nodes/manifest";
import { nodeRegistry as registry } from "@/nodes/registry";

/**
 * AF-M3-04: a node declares which credentials it needs, the engine resolves
 * them in one place, and the resolved secret never reaches node output.
 *
 * AF-M8-24 rewrote these. They used to resolve `OPENAI`/`ANTHROPIC`/`GEMINI`
 * by name and check those three, which broke when AF-M8-12 deleted them - but
 * the more useful point is that naming three nodes only ever guarded three
 * nodes. Every requirement in the catalogue is checked now, so a new
 * credentialed node is covered the day it is added rather than the day someone
 * remembers to extend this list.
 */
describe("AF-M3-04: node credential requirements", () => {
  const declared = nodeManifest.flatMap((definition) =>
    (definition.credentials ?? []).map((requirement) => ({
      nodeType: definition.type,
      requirement,
    })),
  );

  it("has credentialed nodes to check", () => {
    // Guard the guard: an empty catalogue would satisfy every assertion below.
    expect(declared.length).toBeGreaterThan(0);
  });

  it("declares only credential types the registry knows", () => {
    // A requirement naming a type the credential registry has never heard of
    // cannot be resolved at run time and cannot be filtered in the config
    // form - the user is offered nothing and the node fails with no clue why.
    const unknown = declared
      .filter(({ requirement }) => !credentialDefsById.has(requirement.type))
      .map(({ nodeType, requirement }) => `${nodeType}.${requirement.key}`);

    expect(
      unknown,
      `these credential requirements name a type the registry does not define: ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("gives every requirement a config key to bind to", () => {
    for (const { nodeType, requirement } of declared) {
      expect(
        requirement.key,
        `${nodeType} requirement has no key`,
      ).toBeTruthy();
      expect(typeof requirement.required).toBe("boolean");
    }
  });

  it("keeps every credentialed node resolvable through the registry", () => {
    for (const { nodeType } of declared) {
      expect(registry.has(nodeType)).toBe(true);
    }
  });

  it("the node config form filters only matching credentials", () => {
    // The declared type is what the form filters the user's saved credentials
    // by, so it has to be the registry id and not a provider nickname. Checked
    // against AI_LLM, which is what the retired per-provider nodes were
    // migrated onto (ADR-0011) and which declares one requirement per provider.
    const llm = registry.resolve("AI_LLM");
    const byKey = new Map(
      (llm.credentials ?? []).map((requirement) => [
        requirement.key,
        requirement.type,
      ]),
    );

    expect(byKey.get("openaiCredentialId")).toBe("openai.apiKey");
    expect(byKey.get("anthropicCredentialId")).toBe("anthropic.apiKey");
    expect(byKey.get("geminiCredentialId")).toBe("gemini.apiKey");
  });
});
