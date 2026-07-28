const crypto = require('crypto');

function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`)
    .join(',')}}`;
}

function canonicalBody(body) {
  if (!body) return '';
  try {
    return canonicalJSON(JSON.parse(body));
  } catch {
    return body;
  }
}

function headerValue(headers, name) {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? String(headers[key]).trim() : '';
}

function signedHeaders({ secret, url, method = 'GET', body = '', headers = {}, now, nonce }) {
  const target = new URL(url);
  const timestamp = String(now ?? Date.now());
  const requestNonce = nonce ?? crypto.randomUUID();
  const bodyHash = crypto.createHash('sha256').update(canonicalBody(body)).digest('hex');
  const actor = [
    'x-librechat-user-id',
    'x-librechat-user-email',
    'x-librechat-user-role',
    'x-librechat-conversation-id',
    'x-librechat-message-id',
    'x-librechat-agent-id',
  ]
    .map((name) => headerValue(headers, name))
    .join('\n');
  const canonical = [
    'v1',
    method.toUpperCase(),
    `${target.pathname}${target.search}`,
    timestamp,
    requestNonce,
    bodyHash,
    actor,
  ].join('\n');
  return {
    ...headers,
    'X-Woda-Signature-Version': 'v1',
    'X-Woda-Timestamp': timestamp,
    'X-Woda-Nonce': requestNonce,
    'X-Woda-Content-SHA256': bodyHash,
    'X-Woda-Signature': crypto.createHmac('sha256', secret).update(canonical).digest('hex'),
  };
}

module.exports = { canonicalBody, signedHeaders };
