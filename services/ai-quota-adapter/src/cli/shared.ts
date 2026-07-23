export function parseArgs(argv: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    result.set(key, [...(result.get(key) ?? []), value]);
    index += 1;
  }
  return result;
}

export function requiredArg(args: Map<string, string[]>, name: string): string {
  const value = args.get(name)?.[0];
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

export async function readSecretFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const value = Buffer.concat(chunks).toString('utf8').trim();
  if (!value) throw new Error('New API token must be provided on stdin');
  return value;
}
