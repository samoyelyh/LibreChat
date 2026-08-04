import { documentParserMimeTypes, megabyte } from 'librechat-data-provider';
import type { MistralOCRUploadResult } from '~/types';
import { parseDocument } from './crud';

interface AgentProvider {
  provider?: string | null;
}

type GetAgent = (search: { id: string }) => Promise<AgentProvider | null>;

/** Extracts message documents for custom providers that only accept text content parts. */
export async function extractAgentMessageDocument({
  file,
  agentId,
  messageAttachment,
  toolResource,
  textOnlyProvider,
  getAgent,
}: {
  file: Express.Multer.File;
  agentId?: string | null;
  messageAttachment: boolean;
  toolResource?: string | null;
  textOnlyProvider: string;
  getAgent: GetAgent;
}): Promise<MistralOCRUploadResult | undefined> {
  if (!messageAttachment || toolResource || !agentId) {
    return undefined;
  }
  if (!documentParserMimeTypes.some((pattern) => pattern.test(file.mimetype))) {
    return undefined;
  }

  const agent = await getAgent({ id: agentId });
  if (agent?.provider !== textOnlyProvider) {
    return undefined;
  }

  const result = await parseDocument({ file });
  const textBytes = Buffer.byteLength(result.text, 'utf8');
  if (textBytes > 15 * megabyte) {
    throw new Error(
      `Extracted text from "${file.originalname}" exceeds the 15MB storage limit (${Math.round(textBytes / megabyte)}MB). Try a shorter document.`,
    );
  }
  return result;
}
