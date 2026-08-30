export interface ChunkOptions {
  maxChunkCharacters?: number;
  overlapCharacters?: number;
}

export interface TextChunk {
  content: string;
  chunkIndex: number;
  tokens: number;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function chunkText(
  text: string,
  options: ChunkOptions = {},
): TextChunk[] {
  const maxChars = options.maxChunkCharacters ?? 1000;
  const overlap = options.overlapCharacters ?? 150;

  if (!text || text.trim().length === 0) {
    return [];
  }

  const cleanText = text.trim();
  if (cleanText.length <= maxChars) {
    return [
      {
        content: cleanText,
        chunkIndex: 0,
        tokens: estimateTokens(cleanText),
      },
    ];
  }

  const paragraphs = cleanText.split(/\n\s*\n/);
  const chunks: TextChunk[] = [];
  let currentChunk = "";
  let chunkIdx = 0;

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    if (trimmedPara.length > maxChars) {
      if (currentChunk.trim().length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIdx++,
          tokens: estimateTokens(currentChunk.trim()),
        });
        const overlapStart = Math.max(0, currentChunk.length - overlap);
        currentChunk = currentChunk.slice(overlapStart).trim();
      }

      const sentences = trimmedPara.split(/(?<=[.?!])\s+/);
      for (const sentence of sentences) {
        const trimmedSentence = sentence.trim();
        if (!trimmedSentence) continue;

        if (currentChunk.length + trimmedSentence.length + 1 > maxChars) {
          if (currentChunk.trim().length > 0) {
            chunks.push({
              content: currentChunk.trim(),
              chunkIndex: chunkIdx++,
              tokens: estimateTokens(currentChunk.trim()),
            });
            const overlapStart = Math.max(0, currentChunk.length - overlap);
            currentChunk = currentChunk.slice(overlapStart).trim();
          }
        }

        currentChunk = currentChunk
          ? `${currentChunk} ${trimmedSentence}`
          : trimmedSentence;
      }
    } else {
      if (currentChunk.length + trimmedPara.length + 2 > maxChars) {
        if (currentChunk.trim().length > 0) {
          chunks.push({
            content: currentChunk.trim(),
            chunkIndex: chunkIdx++,
            tokens: estimateTokens(currentChunk.trim()),
          });
          const overlapStart = Math.max(0, currentChunk.length - overlap);
          currentChunk = currentChunk.slice(overlapStart).trim();
        }
      }

      currentChunk = currentChunk
        ? `${currentChunk}\n\n${trimmedPara}`
        : trimmedPara;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({
      content: currentChunk.trim(),
      chunkIndex: chunkIdx++,
      tokens: estimateTokens(currentChunk.trim()),
    });
  }

  return chunks;
}
