import path from 'path';
import { FileSources } from 'librechat-data-provider';
import { extractAgentMessageDocument } from './context';
import { hasExtractedFileContext } from '../context';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('agent message document context', () => {
  const file = {
    originalname: 'sample.xlsx',
    path: path.join(__dirname, 'sample.xlsx'),
    mimetype: XLSX_MIME,
  } as Express.Multer.File;

  test('extracts an xlsx attachment for a text-only custom provider', async () => {
    const getAgent = jest.fn().mockResolvedValue({ provider: 'woda-ai' });

    const result = await extractAgentMessageDocument({
      file,
      agentId: 'agent_woda-amazon-market-analysis',
      messageAttachment: true,
      textOnlyProvider: 'woda-ai',
      getAgent,
    });

    expect(getAgent).toHaveBeenCalledWith({ id: 'agent_woda-amazon-market-analysis' });
    expect(result?.text).toContain('Sheet One:\nData,on,first,sheet');
  });

  test('does not extract documents for providers with native document support', async () => {
    const getAgent = jest.fn().mockResolvedValue({ provider: 'openAI' });

    await expect(
      extractAgentMessageDocument({
        file,
        agentId: 'agent-native',
        messageAttachment: true,
        textOnlyProvider: 'woda-ai',
        getAgent,
      }),
    ).resolves.toBeUndefined();
  });

  test('does not replace explicit agent tool resources', async () => {
    const getAgent = jest.fn();

    await expect(
      extractAgentMessageDocument({
        file,
        agentId: 'agent_woda-amazon-market-analysis',
        messageAttachment: true,
        toolResource: 'file_search',
        textOnlyProvider: 'woda-ai',
        getAgent,
      }),
    ).resolves.toBeUndefined();
    expect(getAgent).not.toHaveBeenCalled();
  });

  test('recognizes text extracted alongside an original stored file', () => {
    expect(
      hasExtractedFileContext({
        source: FileSources.local,
        text: 'Sheet One:\nvalue',
        textFormat: 'text',
      }),
    ).toBe(true);
    expect(
      hasExtractedFileContext({
        source: FileSources.local,
        text: '<table><tr><td>preview</td></tr></table>',
        textFormat: 'html',
      }),
    ).toBe(false);
  });
});
