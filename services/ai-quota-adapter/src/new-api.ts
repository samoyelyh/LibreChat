import type { NewApiClientContract, NewApiProvisioningClient } from './contracts.js';
import { AdapterError, UpstreamError } from './errors.js';
import type {
  NewApiLog,
  NewApiToken,
  NewApiUser,
  ProvisionedNewApiAccount,
  TokenUsage,
} from './types.js';

export function normalizedUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  if (path.startsWith('/api/')) return new URL(path, base.origin).toString();
  if (path.startsWith('/v1/') && base.pathname.replace(/\/+$/, '') === '/v1') {
    return new URL(path.replace(/^\/v1\//, ''), `${base.toString().replace(/\/+$/, '')}/`).toString();
  }
  return new URL(path.replace(/^\//, ''), `${base.toString().replace(/\/+$/, '')}/`).toString();
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

interface NewApiResponse<T> {
  success?: boolean;
  message?: string;
  data?: T;
}

interface Page<T> {
  items?: T[];
  total?: number;
}

interface LoginUser {
  id?: number;
  require_2fa?: boolean;
}

interface LoginData extends LoginUser {
  access_token?: string;
  user?: LoginUser;
}

export function loginIdentity(data?: LoginData): {
  userId: number | undefined;
  accessToken: string | undefined;
  requireTwoFactor: boolean;
} {
  return {
    userId: data?.id ?? data?.user?.id,
    accessToken:
      typeof data?.access_token === 'string' && data.access_token.length > 0
        ? data.access_token
        : undefined,
    requireTwoFactor: data?.require_2fa === true || data?.user?.require_2fa === true,
  };
}

function fullRuntimeToken(value: string): string {
  return value.startsWith('sk-') ? value : `sk-${value}`;
}

export class NewApiClient implements NewApiClientContract, NewApiProvisioningClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly adminToken?: string,
    private readonly adminUserId?: number,
  ) {}

  private async rawRequest(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    return fetch(normalizedUrl(this.baseUrl, path), { ...init, signal: combined });
  }

  private async jsonRequest<T>(path: string, token?: string, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = bearer(token);
    const response = await this.rawRequest(path, { headers }, signal);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) {
      throw new UpstreamError(
        response.status,
        'new_api_request_failed',
        `New API request failed with HTTP ${response.status}`,
        bytes,
        response.headers.get('content-type') ?? undefined,
      );
    }
    try {
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
    } catch {
      throw new AdapterError(502, 'invalid_new_api_response', 'New API returned invalid JSON');
    }
  }

  private adminHeaders(): Record<string, string> {
    if (!this.adminToken || !this.adminUserId) {
      throw new AdapterError(
        503,
        'new_api_admin_unavailable',
        'New API administrator credential is unavailable',
      );
    }
    return {
      Accept: 'application/json',
      Authorization: bearer(this.adminToken),
      'Content-Type': 'application/json',
      'New-Api-User': String(this.adminUserId),
    };
  }

  private async managementRequest<T>(
    path: string,
    options: {
      method?: string;
      body?: object;
      accessToken?: string;
      userId?: number;
      cookie?: string;
    } = {},
  ): Promise<T> {
    const headers = options.accessToken
      ? {
          Accept: 'application/json',
          Authorization: bearer(options.accessToken),
          'Content-Type': 'application/json',
          'New-Api-User': String(options.userId),
        }
      : options.cookie
        ? {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Cookie: options.cookie,
            'New-Api-User': String(options.userId),
          }
        : this.adminHeaders();
    const response = await this.rawRequest(path, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = (await response.json().catch(() => null)) as NewApiResponse<T> | null;
    if (!response.ok || !payload || payload.success === false) {
      throw new AdapterError(
        502,
        'new_api_management_failed',
        `New API management request failed with HTTP ${response.status}`,
      );
    }
    if (payload.data === undefined) {
      return undefined as T;
    }
    return payload.data;
  }

  private async findUser(username: string): Promise<NewApiUser | null> {
    const data = await this.managementRequest<Page<NewApiUser>>(
      `/api/user/search?keyword=${encodeURIComponent(username)}&p=0&page_size=50`,
    );
    return data.items?.find((user) => user.username === username) ?? null;
  }

  private async login(
    username: string,
    password: string,
  ): Promise<{ userId: number; cookie: string; accessToken: string | undefined }> {
    const response = await this.rawRequest('/api/user/login', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const payload = (await response.json().catch(() => null)) as NewApiResponse<LoginData> | null;
    const setCookie = response.headers.get('set-cookie') ?? '';
    const session = setCookie.match(/(?:^|,\s*)([^=;,]+=[^;]+)/)?.[1] ?? '';
    const { userId, accessToken, requireTwoFactor } = loginIdentity(payload?.data);
    if (
      !response.ok ||
      payload?.success !== true ||
      !userId ||
      (!session && !accessToken) ||
      requireTwoFactor
    ) {
      throw new AdapterError(
        502,
        'new_api_user_login_failed',
        'New API managed user login failed',
      );
    }
    return { userId, cookie: session, accessToken };
  }

  private async tokens(accessToken: string, userId: number): Promise<NewApiToken[]> {
    const data = await this.managementRequest<Page<NewApiToken>>('/api/token/?p=0&page_size=100', {
      accessToken,
      userId,
    });
    return data.items ?? [];
  }

  private async setUserGroup(user: NewApiUser, group: string): Promise<void> {
    await this.managementRequest<void>('/api/user/', {
      method: 'PUT',
      body: {
        id: user.id,
        username: user.username,
        display_name: user.display_name ?? user.username,
        role: user.role,
        group,
        remark: 'Managed by Woda LibreChat AI quota adapter',
      },
    });
    user.group = group;
  }

  private async setUserQuota(userId: number, quota: number): Promise<void> {
    await this.managementRequest<void>('/api/user/manage', {
      method: 'POST',
      body: { id: userId, action: 'add_quota', mode: 'override', value: quota },
    });
  }

  private async applyTokenPolicy(
    token: NewApiToken,
    accessToken: string,
    userId: number,
    quota: number,
    group: string,
    allowedModels: string[],
  ): Promise<void> {
    await this.managementRequest<NewApiToken>('/api/token/', {
      method: 'PUT',
      accessToken,
      userId,
      body: {
        id: token.id,
        name: token.name,
        expired_time: -1,
        remain_quota: quota,
        unlimited_quota: false,
        model_limits_enabled: true,
        model_limits: [...new Set(allowedModels)].sort().join(','),
        allow_ips: '',
        group,
        cross_group_retry: false,
      },
    });
    if (quota > 0 && token.status !== 1) {
      await this.managementRequest<NewApiToken>('/api/token/?status_only=1', {
        method: 'PUT',
        accessToken,
        userId,
        body: { id: token.id, status: 1 },
      });
    }
  }

  async provision(input: {
    username: string;
    displayName: string;
    password: string;
    quota: number;
    group: string;
    allowedModels: string[];
    tokenName: string;
  }): Promise<ProvisionedNewApiAccount> {
    let user = await this.findUser(input.username);
    if (!user) {
      await this.managementRequest<void>('/api/user/', {
        method: 'POST',
        body: {
          username: input.username,
          password: input.password,
          display_name: input.displayName,
          role: 1,
        },
      });
      user = await this.findUser(input.username);
    }
    if (!user) {
      throw new AdapterError(
        502,
        'new_api_user_create_failed',
        'New API user could not be created',
      );
    }
    await this.setUserGroup(user, input.group);
    await this.setUserQuota(user.id, input.quota);
    const login = await this.login(input.username, input.password);
    const managementToken = await this.managementRequest<string>('/api/user/token', {
      userId: login.userId,
      ...(login.accessToken
        ? { accessToken: login.accessToken }
        : { cookie: login.cookie }),
    });
    let tokens = await this.tokens(managementToken, user.id);
    let token = tokens.find((candidate) => candidate.name === input.tokenName);
    if (!token) {
      await this.managementRequest<void>('/api/token/', {
        method: 'POST',
        accessToken: managementToken,
        userId: user.id,
        body: {
          name: input.tokenName,
          expired_time: -1,
          remain_quota: input.quota,
          unlimited_quota: false,
          model_limits_enabled: true,
          model_limits: [...new Set(input.allowedModels)].sort().join(','),
          allow_ips: '',
          group: input.group,
          cross_group_retry: false,
        },
      });
      tokens = await this.tokens(managementToken, user.id);
      token = tokens.find((candidate) => candidate.name === input.tokenName);
    }
    if (!token) {
      throw new AdapterError(
        502,
        'new_api_token_create_failed',
        'New API token could not be created',
      );
    }
    await this.applyTokenPolicy(
      token,
      managementToken,
      user.id,
      input.quota,
      input.group,
      input.allowedModels,
    );
    const key = await this.managementRequest<{ key?: string }>(`/api/token/${token.id}/key`, {
      method: 'POST',
      accessToken: managementToken,
      userId: user.id,
    });
    if (!key.key) {
      throw new AdapterError(
        502,
        'new_api_token_key_missing',
        'New API token key was not returned',
      );
    }
    return {
      user,
      token,
      runtimeToken: fullRuntimeToken(key.key),
      managementToken,
    };
  }

  async applyPolicy(input: {
    user: NewApiUser;
    token: NewApiToken;
    managementToken: string;
    quota: number;
    group: string;
    allowedModels: string[];
  }): Promise<void> {
    await this.setUserGroup(input.user, input.group);
    await this.setUserQuota(input.user.id, input.quota);
    await this.applyTokenPolicy(
      input.token,
      input.managementToken,
      input.user.id,
      input.quota,
      input.group,
      input.allowedModels,
    );
  }

  async disableUser(userId: number): Promise<void> {
    await this.managementRequest<void>('/api/user/manage', {
      method: 'POST',
      body: { id: userId, action: 'disable', mode: '', value: 0 },
    });
  }

  async restoreUser(userId: number): Promise<void> {
    await this.managementRequest<void>('/api/user/manage', {
      method: 'POST',
      body: { id: userId, action: 'enable', mode: '', value: 0 },
    });
  }

  async groups(): Promise<string[]> {
    return this.managementRequest<string[]>('/api/group/');
  }

  async status(): Promise<Record<string, unknown>> {
    return this.jsonRequest<Record<string, unknown>>('/api/status');
  }

  async listModels(token: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.jsonRequest<Record<string, unknown>>('/v1/models', token, signal);
  }

  async tokenUsage(token: string, signal?: AbortSignal): Promise<TokenUsage> {
    const response = await this.jsonRequest<{ data?: TokenUsage }>('/api/usage/token', token, signal);
    if (!response.data) throw new AdapterError(502, 'invalid_usage_response', 'New API usage data is missing');
    return response.data;
  }

  async tokenLogs(token: string, signal?: AbortSignal): Promise<NewApiLog[]> {
    const response = await this.jsonRequest<{ data?: NewApiLog[] }>('/api/log/token', token, signal);
    return Array.isArray(response.data) ? response.data : [];
  }

  async relay(path: string, init: RequestInit, token: string, signal: AbortSignal): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.delete('authorization');
    headers.delete('x-adapter-internal-key');
    headers.delete('x-woda-signature-version');
    headers.delete('x-woda-timestamp');
    headers.delete('x-woda-nonce');
    headers.delete('x-woda-content-sha256');
    headers.delete('x-woda-signature');
    headers.delete('x-librechat-user-id');
    headers.delete('x-librechat-user-email');
    headers.delete('x-librechat-conversation-id');
    headers.delete('x-librechat-message-id');
    headers.set('authorization', bearer(token));
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    timer.unref();
    try {
      return await fetch(normalizedUrl(this.baseUrl, path), {
        ...init,
        headers,
        signal: AbortSignal.any([signal, timeout.signal]),
      });
    } catch (error) {
      if (timeout.signal.aborted && !signal.aborted) {
        throw new AdapterError(
          504,
          'new_api_response_timeout',
          'New API did not start responding before the timeout',
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function modelIds(response: Record<string, unknown>): string[] {
  const data = response.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => (item && typeof item === 'object' && typeof item.id === 'string' ? item.id : null))
    .filter((value): value is string => value !== null);
}

export function filterModels(
  response: Record<string, unknown>,
  allowedModels: string[],
): Record<string, unknown> {
  const allowed = new Set(allowedModels);
  const data = Array.isArray(response.data)
    ? response.data.filter(
        (item) => item && typeof item === 'object' && typeof item.id === 'string' && allowed.has(item.id),
      )
    : [];
  return { ...response, data };
}
