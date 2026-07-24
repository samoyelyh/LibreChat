import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Label, Spinner, useToastContext } from '@librechat/client';
import { getTokenHeader } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

type CredentialState = {
  configured: boolean;
  status: 'active' | 'invalid' | 'revoked' | 'untested' | 'missing';
  configuredBy: 'self' | 'admin' | null;
  fingerprintLast4: string | null;
  updatedAt: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  lastUsedAt: string | null;
  toolCount: number | null;
};

type UserSummary = {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  credential: CredentialState;
};

const EMPTY_STATE: CredentialState = {
  configured: false,
  status: 'missing',
  configuredBy: null,
  fingerprintLast4: null,
  updatedAt: null,
  lastTestedAt: null,
  lastTestOk: null,
  lastTestMessage: null,
  lastUsedAt: null,
  toolCount: null,
};

const statusText: Record<CredentialState['status'], string> = {
  active: '已连接',
  invalid: '密钥无效',
  revoked: '已撤销',
  untested: '待测试',
  missing: '未配置',
};

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无';
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const authorization = getTokenHeader();
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || payload.data == null) {
    throw new Error(payload.error?.message || `请求失败（HTTP ${response.status}）`);
  }
  return payload.data;
}

function StatusBadge({ value }: { value: CredentialState['status'] }) {
  const style =
    value === 'active'
      ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
      : value === 'invalid'
        ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${style}`}>
      {statusText[value]}
    </span>
  );
}

function CredentialDetails({ status }: { status: CredentialState }) {
  return (
    <dl className="grid grid-cols-1 gap-2 text-xs text-text-secondary sm:grid-cols-2">
      <div>
        <dt className="inline">密钥指纹：</dt>
        <dd className="inline">
          {status.fingerprintLast4 ? `•••• ${status.fingerprintLast4}` : '暂无'}
        </dd>
      </div>
      <div>
        <dt className="inline">配置来源：</dt>
        <dd className="inline">
          {status.configuredBy === 'self'
            ? '本人'
            : status.configuredBy === 'admin'
              ? '管理员'
              : '暂无'}
        </dd>
      </div>
      <div>
        <dt className="inline">最近测试：</dt>
        <dd className="inline">{dateTime(status.lastTestedAt)}</dd>
      </div>
      <div>
        <dt className="inline">最近调用：</dt>
        <dd className="inline">{dateTime(status.lastUsedAt)}</dd>
      </div>
      <div>
        <dt className="inline">工具数量：</dt>
        <dd className="inline">{status.toolCount ?? '暂无'}</dd>
      </div>
      <div>
        <dt className="inline">更新时间：</dt>
        <dd className="inline">{dateTime(status.updatedAt)}</dd>
      </div>
    </dl>
  );
}

function SelfCredential() {
  const { showToast } = useToastContext();
  const [status, setStatus] = useState<CredentialState>(EMPTY_STATE);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | 'delete' | null>('load');

  const load = useCallback(async () => {
    setBusy('load');
    try {
      setStatus(await api<CredentialState>('/api/lingxing/status'));
    } catch (error) {
      showToast({
        status: 'error',
        message: error instanceof Error ? error.message : '状态读取失败',
      });
    } finally {
      setBusy(null);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (key.trim().length < 8) {
      showToast({ status: 'error', message: '请输入完整的领星 MCP 密钥' });
      return;
    }
    setBusy('save');
    try {
      setStatus(
        await api<CredentialState>('/api/lingxing/credential', {
          method: 'PUT',
          body: JSON.stringify({ key: key.trim() }),
        }),
      );
      setKey('');
      showToast({ status: 'success', message: '密钥已加密保存，请继续测试连接' });
    } catch (error) {
      showToast({ status: 'error', message: error instanceof Error ? error.message : '保存失败' });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const result = await api<{ result: { ok: boolean }; status: CredentialState }>(
        '/api/lingxing/test',
        { method: 'POST', body: '{}' },
      );
      setStatus(result.status);
      showToast({
        status: 'success',
        message: `连接成功，共发现 ${result.status.toolCount ?? 0} 个工具`,
      });
    } catch (error) {
      await load();
      showToast({
        status: 'error',
        message: error instanceof Error ? error.message : '连接测试失败',
      });
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    if (!window.confirm('确定删除自己的领星密钥吗？删除后领星工具会立即不可用。')) {
      return;
    }
    setBusy('delete');
    try {
      setStatus(await api<CredentialState>('/api/lingxing/credential', { method: 'DELETE' }));
      showToast({ status: 'success', message: '领星密钥已撤销' });
    } catch (error) {
      showToast({ status: 'error', message: error instanceof Error ? error.message : '撤销失败' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-base">领星 ERP</Label>
          <p className="mt-1 text-xs text-text-secondary">
            每个用户使用自己的领星密钥；保存后系统不会再次显示密钥原文。
          </p>
        </div>
        {busy === 'load' ? <Spinner className="h-4 w-4" /> : <StatusBadge value={status.status} />}
      </div>
      <CredentialDetails status={status} />
      {status.lastTestMessage && status.lastTestOk === false && (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          最近测试失败：{status.lastTestMessage}
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="lingxing-self-key">
          {status.configured ? '输入新密钥以覆盖' : '领星 MCP 密钥'}
        </Label>
        <Input
          id="lingxing-self-key"
          type="password"
          autoComplete="new-password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="请粘贴领星 X-Mcp-Key"
          disabled={busy != null}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {status.configured && (
          <Button variant="outline" onClick={revoke} disabled={busy != null}>
            {busy === 'delete' ? <Spinner className="h-4 w-4" /> : '删除密钥'}
          </Button>
        )}
        <Button variant="outline" onClick={test} disabled={busy != null || !status.configured}>
          {busy === 'test' ? <Spinner className="h-4 w-4" /> : '测试连接'}
        </Button>
        <Button variant="submit" onClick={save} disabled={busy != null || key.trim().length < 8}>
          {busy === 'save' ? (
            <Spinner className="h-4 w-4" />
          ) : status.configured ? (
            '更新密钥'
          ) : (
            '保存密钥'
          )}
        </Button>
      </div>
    </div>
  );
}

function AdminCredentialManager() {
  const { showToast } = useToastContext();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [targetId, setTargetId] = useState('');
  const [key, setKey] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const target = useMemo(
    () => users.find((user) => user.userId === targetId) ?? null,
    [users, targetId],
  );

  const search = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api<UserSummary[]>(
        `/api/lingxing/admin/users?q=${encodeURIComponent(query.trim())}&limit=30`,
      );
      setUsers(result);
      setTargetId((current) =>
        result.some((user) => user.userId === current) ? current : (result[0]?.userId ?? ''),
      );
    } catch (error) {
      showToast({
        status: 'error',
        message: error instanceof Error ? error.message : '用户查询失败',
      });
    } finally {
      setBusy(false);
    }
  }, [query, showToast]);

  useEffect(() => {
    void search();
    // Run once when the administrative control becomes visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateTargetStatus = (credential: CredentialState) => {
    setUsers((current) =>
      current.map((user) => (user.userId === targetId ? { ...user, credential } : user)),
    );
  };

  const setCredential = async () => {
    if (!target || key.trim().length < 8 || reason.trim().length < 3) return;
    setBusy(true);
    try {
      updateTargetStatus(
        await api<CredentialState>(`/api/lingxing/admin/users/${target.userId}/credential`, {
          method: 'PUT',
          body: JSON.stringify({ key: key.trim(), reason: reason.trim() }),
        }),
      );
      setKey('');
      showToast({ status: 'success', message: '目标用户密钥已加密保存' });
    } catch (error) {
      showToast({
        status: 'error',
        message: error instanceof Error ? error.message : '代配置失败',
      });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!target || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const result = await api<{ status: CredentialState }>(
        `/api/lingxing/admin/users/${target.userId}/test`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      updateTargetStatus(result.status);
      showToast({ status: 'success', message: '目标用户连接测试成功' });
    } catch (error) {
      void search();
      showToast({
        status: 'error',
        message: error instanceof Error ? error.message : '连接测试失败',
      });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!target || reason.trim().length < 3) return;
    if (!window.confirm(`确定撤销 ${target.email} 的领星密钥吗？`)) return;
    setBusy(true);
    try {
      updateTargetStatus(
        await api<CredentialState>(`/api/lingxing/admin/users/${target.userId}/credential`, {
          method: 'DELETE',
          body: JSON.stringify({ reason: reason.trim() }),
        }),
      );
      showToast({ status: 'success', message: '目标用户密钥已撤销' });
    } catch (error) {
      showToast({ status: 'error', message: error instanceof Error ? error.message : '撤销失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-4 border-t border-border-light pt-5">
      <div>
        <Label className="text-base">管理员代配置</Label>
        <p className="mt-1 text-xs text-text-secondary">
          可为目标用户设置、测试或撤销密钥；管理员无法读取、导出或复制已保存的密钥。
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按姓名或邮箱搜索用户"
        />
        <Button variant="outline" onClick={search} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : '搜索'}
        </Button>
      </div>
      <select
        className="w-full rounded-md border border-border-medium bg-surface-primary px-3 py-2 text-sm"
        value={targetId}
        onChange={(event) => setTargetId(event.target.value)}
      >
        {users.length === 0 && <option value="">未找到用户</option>}
        {users.map((user) => (
          <option key={user.userId} value={user.userId}>
            {user.email}（{user.role} / {statusText[user.credential.status]}）
          </option>
        ))}
      </select>
      {target && <CredentialDetails status={target.credential} />}
      <Input
        type="password"
        autoComplete="new-password"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        placeholder="输入新密钥（只支持新增或覆盖，不回显旧密钥）"
      />
      <Input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="操作原因（必填，至少 3 个字）"
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          onClick={revoke}
          disabled={busy || !target?.credential.configured || reason.trim().length < 3}
        >
          撤销
        </Button>
        <Button
          variant="outline"
          onClick={test}
          disabled={busy || !target?.credential.configured || reason.trim().length < 3}
        >
          测试
        </Button>
        <Button
          variant="submit"
          onClick={setCredential}
          disabled={busy || !target || key.trim().length < 8 || reason.trim().length < 3}
        >
          保存/覆盖
        </Button>
      </div>
    </div>
  );
}

export default function LingxingDataSource() {
  const { user } = useAuthContext();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'admin';
  return (
    <div className="rounded-xl border border-border-light p-4">
      <SelfCredential />
      {isAdmin && <AdminCredentialManager />}
    </div>
  );
}
