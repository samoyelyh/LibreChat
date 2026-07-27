import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Label, Spinner, useToastContext } from '@librechat/client';
import { getTokenHeader } from 'librechat-data-provider';
import { useAuthContext, useLocalize } from '~/hooks';

type CredentialStatus = 'pending' | 'active' | 'disabled' | 'error' | 'revoked';
type PolicyScope = 'default' | 'role' | 'department' | 'user';

type Mapping = {
  credentialStatus: CredentialStatus;
  newApiUsername: string;
  tokenFingerprint: string;
  gatewayGroup: string;
  allowedModels: string[];
  provisionedBy?: 'manual' | 'automatic';
};

type Policy = {
  policyId: string;
  name: string;
  scope: PolicyScope;
  scopeValue: string;
  priority: number;
  quota: number;
  gatewayGroup: string;
  allowedModels: string[];
  enabled: boolean;
};

type Summary = {
  identity: {
    userId: string;
    email: string;
    name: string | null;
    role: string;
    departments: string[];
    admin: boolean;
  };
  mapping: Mapping | null;
  effectivePolicy: Policy;
  balance: {
    totalGranted: number;
    totalUsed: number;
    totalAvailable: number;
    unlimitedQuota: boolean;
  } | null;
};

type Usage = {
  model: string;
  quota: number;
  promptTokens: number;
  completionTokens: number;
  createdAt: string | null;
};

type Catalog = {
  models: string[];
  groups: string[];
};

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: { message?: string };
};

async function quotaApi<T>(path: string, init?: RequestInit): Promise<T> {
  const authorization = getTokenHeader();
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || payload.data == null) {
    throw new Error(payload.error?.message || `HTTP ${response.status}`);
  }
  return payload.data;
}

function number(value: number | undefined): string {
  return new Intl.NumberFormat().format(value ?? 0);
}

function statusClass(status: CredentialStatus | 'missing'): string {
  if (status === 'active') {
    return 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300';
  }
  if (status === 'revoked' || status === 'error') {
    return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
}

function StatusBadge({ status }: { status: CredentialStatus | 'missing' }) {
  const localize = useLocalize();
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(status)}`}>
      {localize(
        status === 'active'
          ? 'com_ui_ai_quota_status_active'
          : status === 'revoked'
            ? 'com_ui_ai_quota_status_revoked'
            : status === 'error'
              ? 'com_ui_ai_quota_status_error'
              : 'com_ui_ai_quota_status_pending',
      )}
    </span>
  );
}

function UserQuota({
  summary,
  usage,
  loading,
  refresh,
}: {
  summary: Summary | null;
  usage: Usage[];
  loading: boolean;
  refresh: () => void;
}) {
  const localize = useLocalize();
  const balance = summary?.balance;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-base">{localize('com_ui_ai_quota_title')}</Label>
          <p className="mt-1 text-xs text-text-secondary">
            {localize('com_ui_ai_quota_description')}
          </p>
        </div>
        {loading ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <StatusBadge status={summary?.mapping?.credentialStatus ?? 'missing'} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ['com_ui_ai_quota_granted', balance?.totalGranted],
          ['com_ui_ai_quota_used', balance?.totalUsed],
          ['com_ui_ai_quota_available', balance?.totalAvailable],
        ].map(([key, value]) => (
          <div key={String(key)} className="rounded-lg border border-border-light p-3">
            <p className="text-xs text-text-secondary">{localize(key as Parameters<typeof localize>[0])}</p>
            <p className="mt-1 text-lg font-semibold">{number(value as number | undefined)}</p>
          </div>
        ))}
      </div>

      {summary && (
        <dl className="grid grid-cols-1 gap-2 text-xs text-text-secondary sm:grid-cols-2">
          <div>
            <dt className="inline">{localize('com_ui_ai_quota_policy')}：</dt>
            <dd className="inline">{summary.effectivePolicy.name}</dd>
          </div>
          <div>
            <dt className="inline">{localize('com_ui_ai_quota_group')}：</dt>
            <dd className="inline">{summary.mapping?.gatewayGroup ?? '-'}</dd>
          </div>
          <div>
            <dt className="inline">{localize('com_ui_ai_quota_departments')}：</dt>
            <dd className="inline">{summary.identity.departments.join(', ') || '-'}</dd>
          </div>
          <div>
            <dt className="inline">{localize('com_ui_ai_quota_token')}：</dt>
            <dd className="inline">{summary.mapping?.tokenFingerprint ?? '-'}</dd>
          </div>
        </dl>
      )}

      <div>
        <Label>{localize('com_ui_ai_quota_models')}</Label>
        <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          {(summary?.mapping?.allowedModels ?? []).map((model) => (
            <span key={model} className="rounded bg-surface-tertiary px-2 py-1 text-xs">
              {model}
            </span>
          ))}
          {(summary?.mapping?.allowedModels.length ?? 0) === 0 && (
            <span className="text-xs text-text-secondary">
              {localize('com_ui_ai_quota_no_models')}
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>{localize('com_ui_ai_quota_recent_usage')}</Label>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {localize('com_ui_ai_quota_refresh')}
          </Button>
        </div>
        <div className="max-h-44 overflow-auto rounded-lg border border-border-light">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-secondary text-text-secondary">
              <tr>
                <th className="px-3 py-2">{localize('com_ui_model')}</th>
                <th className="px-3 py-2">{localize('com_ui_ai_quota_used')}</th>
                <th className="px-3 py-2">{localize('com_ui_ai_quota_time')}</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((item, index) => (
                <tr key={`${item.createdAt}-${item.model}-${index}`} className="border-t border-border-light">
                  <td className="px-3 py-2">{item.model || '-'}</td>
                  <td className="px-3 py-2">{number(item.quota)}</td>
                  <td className="px-3 py-2">
                    {item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
              {usage.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-text-secondary" colSpan={3}>
                    {localize('com_ui_ai_quota_no_usage')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminQuota() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [users, setUsers] = useState<Summary[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({ models: [], groups: ['default'] });
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState('');
  const [scope, setScope] = useState<PolicyScope>('user');
  const [scopeValue, setScopeValue] = useState('');
  const [quota, setQuota] = useState('0');
  const [group, setGroup] = useState('default');
  const [models, setModels] = useState('kimi-k2');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const target = useMemo(
    () => users.find((user) => user.identity.userId === targetId) ?? null,
    [targetId, users],
  );

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [nextUsers, nextPolicies, nextCatalog] = await Promise.all([
        quotaApi<Summary[]>(
          `/api/ai-quota/admin/users?q=${encodeURIComponent(query.trim())}&limit=50`,
        ),
        quotaApi<Policy[]>('/api/ai-quota/admin/policies'),
        quotaApi<Catalog>('/api/ai-quota/admin/catalog'),
      ]);
      setUsers(nextUsers);
      setPolicies(nextPolicies);
      setCatalog(nextCatalog);
      setTargetId((current) =>
        nextUsers.some((user) => user.identity.userId === current)
          ? current
          : (nextUsers[0]?.identity.userId ?? ''),
      );
    } catch (error) {
      showToast({
        status: 'error',
        message: error instanceof Error ? error.message : localize('com_ui_ai_quota_load_failed'),
      });
    } finally {
      setBusy(false);
    }
  }, [localize, query, showToast]);

  useEffect(() => {
    void load();
    // Initial administrative snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!target) return;
    const policy = target.effectivePolicy;
    setScope('user');
    setScopeValue(target.identity.userId);
    setQuota(String(policy.quota));
    setGroup(policy.gatewayGroup);
    setModels(policy.allowedModels.join(', '));
  }, [target]);

  const savePolicy = async () => {
    const parsedModels = models
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);
    if (reason.trim().length < 3 || parsedModels.length === 0) return;
    setBusy(true);
    try {
      await quotaApi<Policy>('/api/ai-quota/admin/policies', {
        method: 'PUT',
        body: JSON.stringify({
          name:
            scope === 'user'
              ? `${localize('com_ui_ai_quota_user_override')} ${scopeValue.slice(-8)}`
              : `${scope} ${scopeValue || '*'}`,
          scope,
          scopeValue: scope === 'default' ? '*' : scopeValue.trim(),
          priority: scope === 'user' ? 1000 : 100,
          quota: Number(quota),
          gatewayGroup: group,
          allowedModels: parsedModels,
          enabled: true,
          reason: reason.trim(),
        }),
      });
      if (scope === 'user' && scopeValue) {
        await quotaApi<Summary>(
          `/api/ai-quota/admin/users/${encodeURIComponent(scopeValue)}/apply`,
          {
            method: 'POST',
            body: JSON.stringify({ reason: reason.trim() }),
          },
        );
      }
      showToast({ status: 'success', message: localize('com_ui_ai_quota_saved') });
      await load();
    } catch (error) {
      showToast({
        status: 'error',
        message: error instanceof Error ? error.message : localize('com_ui_ai_quota_save_failed'),
      });
    } finally {
      setBusy(false);
    }
  };

  const accountAction = async (action: 'apply' | 'revoke' | 'restore') => {
    if (!target || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await quotaApi<Summary>(
        `/api/ai-quota/admin/users/${encodeURIComponent(target.identity.userId)}/${action}`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      showToast({ status: 'success', message: localize('com_ui_ai_quota_action_complete') });
      await load();
    } catch (error) {
      showToast({
        status: 'error',
        message: error instanceof Error ? error.message : localize('com_ui_ai_quota_action_failed'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-4 border-t border-border-light pt-5">
      <div>
        <Label className="text-base">{localize('com_ui_ai_quota_admin')}</Label>
        <p className="mt-1 text-xs text-text-secondary">
          {localize('com_ui_ai_quota_admin_description')}
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={localize('com_ui_ai_quota_search_users')}
        />
        <Button variant="outline" onClick={load} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : localize('com_ui_search')}
        </Button>
      </div>
      <select
        className="w-full rounded-md border border-border-medium bg-surface-primary px-3 py-2 text-sm"
        value={targetId}
        onChange={(event) => setTargetId(event.target.value)}
      >
        {users.map((user) => (
          <option key={user.identity.userId} value={user.identity.userId}>
            {user.identity.email} ({user.identity.role} /{' '}
            {user.mapping?.credentialStatus ?? 'missing'})
          </option>
        ))}
      </select>
      {target && (
        <div className="flex items-center justify-between rounded-lg border border-border-light p-3 text-xs">
          <span>
            {target.identity.departments.join(', ') || '-'} · {target.effectivePolicy.name}
          </span>
          <StatusBadge status={target.mapping?.credentialStatus ?? 'missing'} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="ai-policy-scope">{localize('com_ui_ai_quota_scope')}</Label>
          <select
            id="ai-policy-scope"
            className="mt-1 w-full rounded-md border border-border-medium bg-surface-primary px-3 py-2 text-sm"
            value={scope}
            onChange={(event) => {
              const next = event.target.value as PolicyScope;
              setScope(next);
              setScopeValue(next === 'user' ? targetId : next === 'default' ? '*' : '');
            }}
          >
            {(['user', 'department', 'role', 'default'] as PolicyScope[]).map((value) => (
              <option key={value} value={value}>
                {localize(`com_ui_ai_quota_scope_${value}` as Parameters<typeof localize>[0])}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="ai-policy-value">{localize('com_ui_ai_quota_scope_value')}</Label>
          <Input
            id="ai-policy-value"
            value={scopeValue}
            disabled={scope === 'default' || scope === 'user'}
            onChange={(event) => setScopeValue(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ai-policy-quota">{localize('com_ui_ai_quota_available')}</Label>
          <Input
            id="ai-policy-quota"
            type="number"
            min="0"
            value={quota}
            onChange={(event) => setQuota(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ai-policy-group">{localize('com_ui_ai_quota_group')}</Label>
          <select
            id="ai-policy-group"
            className="mt-1 w-full rounded-md border border-border-medium bg-surface-primary px-3 py-2 text-sm"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          >
            {catalog.groups.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="ai-policy-models">{localize('com_ui_ai_quota_models')}</Label>
        <textarea
          id="ai-policy-models"
          className="mt-1 min-h-20 w-full rounded-md border border-border-medium bg-surface-primary px-3 py-2 text-sm"
          value={models}
          onChange={(event) => setModels(event.target.value)}
          placeholder={catalog.models.join(', ')}
        />
        <p className="mt-1 text-xs text-text-secondary">
          {localize('com_ui_ai_quota_catalog_count', { 0: catalog.models.length })}
        </p>
      </div>
      <Input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={localize('com_ui_ai_quota_reason')}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => accountAction(target?.mapping?.credentialStatus === 'revoked' ? 'restore' : 'revoke')}
          disabled={busy || !target?.mapping || reason.trim().length < 3}
        >
          {target?.mapping?.credentialStatus === 'revoked'
            ? localize('com_ui_ai_quota_restore')
            : localize('com_ui_ai_quota_revoke')}
        </Button>
        <Button
          variant="outline"
          onClick={() => accountAction('apply')}
          disabled={busy || !target || reason.trim().length < 3}
        >
          {localize('com_ui_ai_quota_provision_sync')}
        </Button>
        <Button
          variant="submit"
          onClick={savePolicy}
          disabled={
            busy ||
            reason.trim().length < 3 ||
            Number(quota) < 0 ||
            !scopeValue ||
            models.trim().length === 0
          }
        >
          {localize('com_ui_ai_quota_save_apply')}
        </Button>
      </div>
      <p className="text-xs text-text-secondary">
        {localize('com_ui_ai_quota_policy_count', { 0: policies.length })}
      </p>
    </div>
  );
}

export default function AiQuota() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSummary, nextUsage] = await Promise.all([
        quotaApi<Summary>('/api/ai-quota/summary'),
        quotaApi<Usage[]>('/api/ai-quota/usage?limit=25'),
      ]);
      setSummary(nextSummary);
      setUsage(nextUsage);
    } catch (error) {
      showToast({
        status: 'error',
        message: error instanceof Error ? error.message : localize('com_ui_ai_quota_load_failed'),
      });
    } finally {
      setLoading(false);
    }
  }, [localize, showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'admin';
  return (
    <div className="rounded-xl border border-border-light p-4">
      <UserQuota summary={summary} usage={usage} loading={loading} refresh={refresh} />
      {isAdmin && <AdminQuota />}
    </div>
  );
}
