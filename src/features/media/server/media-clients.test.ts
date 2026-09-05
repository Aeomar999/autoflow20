import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiMediaModels,
  estimateMediaCostUsd,
  findMediaModel,
} from "@/lib/ai/registry";
import {
  generateOpenAiImage,
  generatePollinationsImage,
} from "./image-clients";
import {
  pollCreatomateRender,
  pollVeoOperation,
  startCreatomateRender,
  startVeoGeneration,
} from "./video-clients";

function stub(
  responses: Array<{ body: unknown; status?: number; contentType?: string }>,
) {
  const calls: Array<{ url: string; body: unknown }> = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const contentType = next.contentType ?? "application/json";
    const payload =
      contentType.startsWith("image/") || contentType.startsWith("text/html")
        ? String(next.body)
        : JSON.stringify(next.body);
    return new Response(payload, {
      status: next.status ?? 200,
      headers: { "content-type": contentType },
    });
  }) as typeof fetch);
  return { calls };
}

describe("media pricing registry (AF-M10-23)", () => {
  it("prices images per image and video per second", () => {
    // The two units differ, which is exactly why this could not live in
    // AiModelDef's per-1M-token fields.
    expect(findMediaModel("openai:gpt-image-1")?.unit).toBe("image");
    expect(findMediaModel("google:veo-3")?.unit).toBe("second");
  });

  it("multiplies video cost by duration", () => {
    const perSecond = findMediaModel("google:veo-3")?.costPerUnitUsd ?? 0;
    expect(estimateMediaCostUsd("google:veo-3", 8)).toBeCloseTo(perSecond * 8);
  });

  it("records a free provider as zero rather than unknown", () => {
    // A cost report should say a step was free, not say nothing about it.
    expect(estimateMediaCostUsd("pollinations:flux", 1)).toBe(0);
    expect(findMediaModel("pollinations:flux")).toBeDefined();
  });

  it("returns 0 for a model with no pricing yet, rather than throwing", () => {
    // A missing price is a reporting gap; refusing the run would be worse.
    expect(estimateMediaCostUsd("someone:new-model", 5)).toBe(0);
  });

  it("gives every entry a credential type unless it is genuinely keyless", () => {
    for (const model of aiMediaModels) {
      if (model.id.startsWith("pollinations:")) {
        expect(model.credentialType).toBeUndefined();
      } else {
        expect(model.credentialType, model.id).toBeTruthy();
      }
    }
  });
});

describe("generateOpenAiImage (AF-M10-23)", () => {
  const secret = { apiKey: "sk-test" };
  afterEach(() => vi.restoreAllMocks());

  it("asks dall-e-3 for base64 so there is no second request", async () => {
    // dall-e-3 returns a URL by default, and that URL expires within the hour.
    const { calls } = stub([
      { body: { data: [{ b64_json: Buffer.from("png").toString("base64") }] } },
    ]);

    await generateOpenAiImage({
      secret,
      model: "dall-e-3",
      prompt: "a cat",
      size: "1024x1024",
      where: "test",
    });

    expect(calls[0].body).toMatchObject({ response_format: "b64_json" });
  });

  it("does not retry a content-filter refusal", async () => {
    // Retrying sends the same prompt to the same filter and pays again to be
    // told no again.
    stub([
      {
        body: {
          error: { code: "content_policy_violation", message: "Refused" },
        },
        status: 400,
      },
    ]);

    const error = (await generateOpenAiImage({
      secret,
      model: "gpt-image-1",
      prompt: "x",
      size: "1024x1024",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/reword|will not change/i);
  });

  it("surfaces the revised prompt the model actually used", async () => {
    const image = await (async () => {
      stub([
        {
          body: {
            data: [
              {
                b64_json: Buffer.from("png").toString("base64"),
                revised_prompt: "A photorealistic cat, studio lit",
              },
            ],
          },
        },
      ]);
      return generateOpenAiImage({
        secret,
        model: "dall-e-3",
        prompt: "a cat",
        size: "1024x1024",
        where: "test",
      });
    })();

    expect(image.revisedPrompt).toContain("photorealistic");
  });

  it("retries a rate limit", async () => {
    stub([{ body: {}, status: 429 }]);
    await expect(
      generateOpenAiImage({
        secret,
        model: "gpt-image-1",
        prompt: "x",
        size: "1024x1024",
        where: "test",
      }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("refuses a node with no credential bound", async () => {
    await expect(
      generateOpenAiImage({
        secret: undefined,
        model: "gpt-image-1",
        prompt: "x",
        size: "1024x1024",
        where: "Test node",
      }),
    ).rejects.toThrow(/no OpenAI credential/i);
  });
});

describe("generatePollinationsImage (AF-M10-23)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the bytes from a direct GET", async () => {
    stub([{ body: "fake-jpeg-bytes", contentType: "image/jpeg" }]);

    const image = await generatePollinationsImage({
      prompt: "a lighthouse",
      width: 512,
      height: 512,
      where: "test",
    });

    expect(image.mimeType).toBe("image/jpeg");
    expect(image.data.byteLength).toBeGreaterThan(0);
  });

  it("refuses a 200 that is not an image", async () => {
    // A free service under load answers 200 with an HTML error page. Storing
    // that would produce a "successful" run whose output is a corrupt file
    // nobody notices until a downstream upload fails.
    stub([{ body: "<html>busy</html>", contentType: "text/html" }]);

    await expect(
      generatePollinationsImage({
        prompt: "x",
        width: 512,
        height: 512,
        where: "test",
      }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("refuses an empty image", async () => {
    stub([{ body: "", contentType: "image/jpeg" }]);
    await expect(
      generatePollinationsImage({
        prompt: "x",
        width: 512,
        height: 512,
        where: "test",
      }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("passes a seed so a prompt can reproduce an image", async () => {
    const { calls } = stub([{ body: "bytes", contentType: "image/jpeg" }]);
    await generatePollinationsImage({
      prompt: "x",
      width: 512,
      height: 512,
      seed: 42,
      where: "test",
    });
    expect(calls[0].url).toContain("seed=42");
  });
});

describe("Veo (AF-M10-23)", () => {
  const secret = {
    accessToken: "g-token",
    projectId: "proj-1",
    location: "us-central1",
  };
  afterEach(() => vi.restoreAllMocks());

  it("says what is missing when the credential has no project id", async () => {
    // Vertex is addressed per project and per region; neither is inferable
    // from the token, so there is no default to fall back to.
    await expect(
      startVeoGeneration({
        secret: { accessToken: "t" },
        model: "veo-3.0-generate-001",
        prompt: "x",
        durationSeconds: 8,
        aspectRatio: "16:9",
        where: "Test node",
      }),
    ).rejects.toThrow(/project id/i);
  });

  it("fails a done operation that carries an error", async () => {
    // `done: true` with an `error` is how Vertex reports a refused or crashed
    // generation. Treating done as success would hand an empty result on.
    stub([{ body: { done: true, error: { message: "unsafe prompt" } } }]);

    const error = (await pollVeoOperation({
      secret,
      model: "veo-3.0-generate-001",
      operationName: "op-1",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toContain("unsafe prompt");
  });

  it("reports an unfinished operation as not done", async () => {
    stub([{ body: { done: false } }]);
    const progress = await pollVeoOperation({
      secret,
      model: "veo-3.0-generate-001",
      operationName: "op-1",
      where: "test",
    });
    expect(progress.done).toBe(false);
    expect(progress.status).toBe("generating");
  });

  it("explains a 403 in terms of the project, not the scopes", async () => {
    stub([{ body: { error: { message: "denied" } }, status: 403 }]);
    const error = (await startVeoGeneration({
      secret,
      model: "veo-3.0-generate-001",
      prompt: "x",
      durationSeconds: 8,
      aspectRatio: "16:9",
      where: "test",
    }).catch((e) => e)) as Error;
    expect(error.message).toMatch(/Vertex AI API enabled|Vertex AI User/i);
  });
});

describe("Creatomate (AF-M10-23)", () => {
  const secret = { apiKey: "cm-key" };
  afterEach(() => vi.restoreAllMocks());

  it("reads the first render from the ARRAY the API returns", async () => {
    // Creatomate answers with one render per output format the template
    // defines. Reading the response as an object gives undefined.
    stub([{ body: [{ id: "r1", status: "planned" }] }]);

    const render = await startCreatomateRender({
      secret,
      templateId: "t1",
      modifications: {},
      where: "test",
    });

    expect(render.id).toBe("r1");
  });

  it("treats succeeded as done and failed as an error", async () => {
    // Both are terminal, and only one is success — polling for "not
    // rendering" would call a failure done.
    stub([{ body: { id: "r1", status: "succeeded", url: "https://x/v.mp4" } }]);
    const ok = await pollCreatomateRender({
      secret,
      renderId: "r1",
      where: "test",
    });
    expect(ok.done).toBe(true);

    vi.restoreAllMocks();
    stub([
      { body: { id: "r1", status: "failed", error_message: "bad asset" } },
    ]);
    await expect(
      pollCreatomateRender({ secret, renderId: "r1", where: "test" }),
    ).rejects.toThrow(/bad asset/);
  });

  it("reports a rendering job as not done", async () => {
    stub([{ body: { id: "r1", status: "rendering" } }]);
    const progress = await pollCreatomateRender({
      secret,
      renderId: "r1",
      where: "test",
    });
    expect(progress.done).toBe(false);
    expect(progress.status).toBe("rendering");
  });

  it("names the modification-key rule on a 400", async () => {
    stub([{ body: "bad modifications", status: 400 }]);
    const error = (await startCreatomateRender({
      secret,
      templateId: "t1",
      modifications: { Wrong: "x" },
      where: "test",
    }).catch((e) => e)) as Error;
    expect(error.message).toMatch(/element names/i);
  });
});
