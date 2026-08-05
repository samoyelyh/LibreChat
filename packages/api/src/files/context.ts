import { logger } from '@librechat/data-schemas';
import { FileSources, mergeFileConfig } from 'librechat-data-provider';
import type { IMongoFile } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types';
import { processTextWithTokenLimit } from '~/utils/text';
import type { TokenCountFn } from '~/utils/text';

const FILE_CONTEXT_BUDGET_RATIO = 0.4;
const MAX_TOTAL_FILE_CONTEXT_TOKENS = 120_000;
const MIN_FILE_CONTEXT_TOKENS = 1_000;

/** Returns whether a file carries plain text extracted for model context. */
export function hasExtractedFileContext(
  file: Pick<IMongoFile, 'source' | 'text' | 'textFormat'>,
): boolean {
  if (!file.text) {
    return false;
  }
  return file.source === FileSources.text || file.textFormat === 'text';
}

/** Shares a bounded portion of the model context across all extracted files in a run. */
export function resolveFileContextTokenLimit({
  req,
  maxContextTokens,
  fileCount,
}: {
  req?: ServerRequest;
  maxContextTokens?: number | null;
  fileCount: number;
}): number | undefined {
  if (!Number.isFinite(fileCount) || fileCount <= 0) {
    return undefined;
  }

  const fileConfig = mergeFileConfig(req?.config?.fileConfig);
  const configuredLimit = Number(req?.body?.fileTokenLimit ?? fileConfig.fileTokenLimit);
  if (!Number.isFinite(configuredLimit) || configuredLimit <= 0) {
    return undefined;
  }

  const contextBudget =
    maxContextTokens != null && Number.isFinite(maxContextTokens) && maxContextTokens > 0
      ? Math.floor(maxContextTokens * FILE_CONTEXT_BUDGET_RATIO)
      : MAX_TOTAL_FILE_CONTEXT_TOKENS;
  const totalBudget = Math.min(MAX_TOTAL_FILE_CONTEXT_TOKENS, contextBudget);
  const sharedLimit = Math.floor(totalBudget / fileCount);

  return Math.min(configuredLimit, Math.max(MIN_FILE_CONTEXT_TOKENS, sharedLimit));
}

/**
 * Extracts text context from attachments and returns formatted text.
 * This handles text that was already extracted from files (OCR, transcriptions, document text, etc.)
 * @param params - The parameters object
 * @param params.attachments - Array of file attachments
 * @param params.req - Express request object for config access
 * @param params.tokenCountFn - Function to count tokens in text
 * @returns The formatted file context text, or undefined if no text found
 */
export async function extractFileContext({
  attachments,
  req,
  tokenCountFn,
  fileTokenLimit: tokenLimitOverride,
}: {
  attachments: IMongoFile[];
  req?: ServerRequest;
  tokenCountFn: TokenCountFn;
  fileTokenLimit?: number;
}): Promise<string | undefined> {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }

  const fileConfig = mergeFileConfig(req?.config?.fileConfig);
  const fileTokenLimit =
    tokenLimitOverride ?? req?.body?.fileTokenLimit ?? fileConfig.fileTokenLimit;

  if (!fileTokenLimit) {
    // If no token limit, return undefined (no processing)
    return undefined;
  }

  let resultText = '';

  for (const file of attachments) {
    const extractedText = file.text;
    if (extractedText && hasExtractedFileContext(file)) {
      const { text: limitedText, wasTruncated } = await processTextWithTokenLimit({
        text: extractedText,
        tokenLimit: fileTokenLimit,
        tokenCountFn,
      });

      if (wasTruncated) {
        logger.debug(
          `[extractFileContext] Text content truncated for file: ${file.filename} due to token limits`,
        );
      }

      resultText += `${!resultText ? 'Attached document(s):\n```md' : '\n\n---\n\n'}# "${file.filename}"\n${limitedText}\n`;
    }
  }

  if (resultText) {
    resultText += '\n```';
    return resultText;
  }

  return undefined;
}
