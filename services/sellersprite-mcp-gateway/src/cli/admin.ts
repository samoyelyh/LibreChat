import { loadConfig } from '../config.js';
import { createSignedHeaders } from '../security.js';

const command = process.argv[2] || 'status';
const config = loadConfig();
const baseUrl = `http://127.0.0.1:${config.port}/admin`;

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const method = init?.method ?? 'GET';
  const bodyText = typeof init?.body === 'string' ? init.body : '';
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...createSignedHeaders({
        secret: config.internalKey,
        method,
        path: `/admin${path}`,
        bodyText,
      }),
      ...(init?.headers ?? {}),
    },
  });
  const value = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Admin request failed with HTTP ${response.status}`);
  return value;
}

function printSafe(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (command === 'status') {
  printSafe(await request('/status'));
} else if (command === 'test') {
  printSafe(await request('/test', { method: 'POST', body: '{}' }));
} else if (command === 'audits') {
  const limit = Number(process.argv[3] || 50);
  printSafe(await request(`/audits?limit=${encodeURIComponent(String(limit))}`));
} else if (command === 'credential-sync') {
  const operatorIndex = process.argv.indexOf('--operator');
  const operator = operatorIndex >= 0 ? process.argv[operatorIndex + 1] : undefined;
  if (!operator) throw new Error('Use credential-sync --operator <name-or-email>');
  printSafe(
    await request('/credential/sync', {
      method: 'POST',
      body: JSON.stringify({ operator }),
    }),
  );
} else {
  throw new Error('Usage: admin <status|test|audits [limit]|credential-sync --operator value>');
}
