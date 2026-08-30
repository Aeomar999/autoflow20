import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import { openSecret } from "@/features/credentials/server/vault";
import prisma from "@/lib/db";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 64;

export interface EmbedderOptions {
  apiKey?: string;
  credentialId?: string;
  userId?: string;
}

export async function resolveOpenAiKey(
  options: EmbedderOptions,
): Promise<string> {
  if (options.apiKey) {
    return options.apiKey;
  }

  if (options.credentialId && options.userId) {
    const credential = await prisma.credential.findFirst({
      where: {
        id: options.credentialId,
        userId: options.userId,
      },
    });

    if (credential) {
      const secret = openSecret(credential);
      if (secret.apiKey) {
        return secret.apiKey;
      }
    }
  }

  if (options.userId) {
    const userCredential = await prisma.credential.findFirst({
      where: {
        userId: options.userId,
        type: "openai.apiKey",
      },
      orderBy: { updatedAt: "desc" },
    });

    if (userCredential) {
      const secret = openSecret(userCredential);
      if (secret.apiKey) {
        return secret.apiKey;
      }
    }
  }

  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  throw new Error(
    "No OpenAI API key found for knowledge base embeddings. Please configure an OpenAI credential.",
  );
}

export async function embedQuery(
  text: string,
  options: EmbedderOptions = {},
): Promise<number[]> {
  const apiKey = await resolveOpenAiKey(options);
  const openai = createOpenAI({ apiKey });

  const result = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
    value: text,
  });

  return result.embedding;
}

export async function embedTexts(
  texts: string[],
  options: EmbedderOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const apiKey = await resolveOpenAiKey(options);
  const openai = createOpenAI({ apiKey });
  const model = openai.embedding(EMBEDDING_MODEL);

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const result = await embedMany({
      model,
      values: batch,
    });
    allEmbeddings.push(...result.embeddings);
  }

  return allEmbeddings;
}
