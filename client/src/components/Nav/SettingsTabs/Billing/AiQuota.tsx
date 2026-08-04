import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Label, Spinner, useToastContext } from '@librechat/client';
import { getTokenHeader } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
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
  error?: { code?: string; message?: string };
};

type QuotaValidationInput = {
  hasTarget: boolean;
  modelCount: number;
  quota: string;
  reason: string;
  scopeValue: string;
};

const quotaErrorKeys: Record<string, TranslationKeys> = {
  admin_required: 'com_ui_ai_quota_error_admin_required',
  invalid_request: 'com_ui_ai_quota_error_invalid_request',
  legacy_mapping_read_only: 'com_ui_ai_quota_error_legacy_mapping',
  new_api_admin_unavailable: 'com_ui_ai_quota_error_gateway_unavailable',
  new_api_management_failed: 'com_ui_ai_quota_error_gateway_failed',
  user_not_found: 'com_ui_ai_quota_error_user_not_found',
};

function quotaValidationError({
  hasTarget,
  modelCount,
  quota,
  reason,
  scopeValue,
}: QuotaValidationInput): TranslationKeys | null {
  if (!hasTarget) {
    return 'com_ui_ai_quota_validation_user';
  }
  if (!scopeValue.trim()) {
    return 'com_ui_ai_quota_validation_scope';
  }
  const parsedQuota = Number(quota);
  if (quota.trim() === '' || !Number.isInteger(parsedQuota) || parsedQuota < 0) {
    return 'com_ui_ai_quota_validation_amount';
  }
  if (modelCount === 0) {
    return 'com_ui_ai_quota_validation_models';
  }
  if (reason.trim().length < 3) {
    return 'com_ui_ai_quota_validation_reason';
  }
  return null;
}

function quotaErrorKey(error: unknown, fallback: TranslationKeys): TranslationKeys {
  if (!(error instanceof Error)) {
    return fallback;
  }
  return quotaErrorKeys[error.name] ?? fallback;
}

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
    const error = new Error(payload.error?.message || `HTTP ${response.status}`);
    error.name = payload.error?.code ?? 'quota_api_error';
    throw error;
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

function statusKey(status: CredentialStatus | 'missing'): TranslationKeys {
  if (status === 'active') {
    return 'com_ui_ai_quota_status_active';
  }
  if (status === 'revoked') {
    return 'com_ui_ai_quota_status_revoked';
  }
  if (status === 'error') {
    return 'com_ui_ai_quota_status_error';
  }
  if (status === 'disabled') {
    return 'com_ui_ai_quota_status_disabled';
  }
  if (status === 'missing') {
    return 'com_ui_ai_quota_status_missing';
  }
  return 'com_ui_ai_quota_status_pending';
}

function StatusBadge({ status }: { status: CredentialStatus | 'missing' }) {
  const localize = useLocalize();
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(status)}`}>
      {localize(statusKey(status))}
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
            <p className="text-xs text-text-secondary">
              {localize(key as Parameters<typeof localize>[0])}
            </p>
            <p className="mt-1 text-lg font-semibold">{number(value as number | undefined)}</p>
          </div>
        ))}
      </div>

      {summary && (
        <dl className="grid grid-cols-1 gap-2 text-xs text-text-secondary sm:grid-cols-2">
          <div className="flex gap-1">
            <dt>{localize('com_ui_ai_quota_policy')}</dt>
            <dd>{summary.effectivePolicy.name}</dd>
          </div>
          <div className="flex gap-1">
            <dt>{localize('com_ui_ai_quota_group')}</dt>
            <dd>{summary.mapping?.gatewayGroup ?? '-'}</dd>
          </div>
          <div className="flex gap-1">
            <dt>{localize('com_ui_ai_quota_departments')}</dt>
            <dd>{summary.identity.departments.join(', ') || '-'}</dd>
          </div>
          <div className="flex gap-1">
            <dt>{localize('com_ui_ai_quota_token')}</dt>
            <dd>{summary.mapping?.tokenFingerprint ?? '-'}</dd>
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
                <tr
                  key={`${item.createdAt}-${item.model}-${index}`}
                  className="border-t border-border-light"
                >
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
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const target = useMemo(
    () => users.find((user) => user.identity.userId === targetId) ?? null,
    [targetId, users],
  );
  const filteredModels = useMemo(() => {
    const normalized = modelQuery.trim().toLowerCase();
    if (!normalized) {
      return catalog.models;
    }
    return catalog.models.filter((model) => model.toLowerCase().includes(normalized));
  }, [catalog.models, modelQuery]);
  const selectedModelSet = useMemo(() => new Set(selectedModels), [selectedModels]);
  const validationError = quotaValidationError({
    hasTarget: target != null,
    modelCount: selectedModels.length,
    quota,
    reason,
    scopeValue,
  });

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
        message: localize(quotaErrorKey(error, 'com_ui_ai_quota_load_failed')),
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
    const allowedModelSet = new Set(policy.allowedModels);
    setSelectedModels(catalog.models.filter((model) => allowedModelSet.has(model)));
    setModelQuery('');
    setReason('');
    setShowValidation(false);
  }, [catalog.models, target]);

  const toggleModel = (model: string) => {
    setSelectedModels((current) => {
      const next = new Set(current);
      if (next.has(model)) {
        next.delete(model);
      } else {
        next.add(model);
      }
      return catalog.models.filter((catalogModel) => next.has(catalogModel));
    });
  };

  const selectFilteredModels = () => {
    setSelectedModels((current) => {
      const next = new Set([...current, ...filteredModels]);
      return catalog.models.filter((model) => next.has(model));
    });
  };

  const savePolicy = async () => {
    setShowValidation(true);
    if (validationError != null) {
      showToast({ status: 'error', message: localize(validationError) });
      return;
    }
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
          allowedModels: selectedModels,
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
      setShowValidation(false);
      await load();
    } catch (error) {
      showToast({
        status: 'error',
        message: localize(quotaErrorKey(error, 'com_ui_ai_quota_save_failed')),
      });
    } finally {
      setBusy(false);
    }
  };

  const accountAction = async (action: 'apply' | 'revoke' | 'restore') => {
    if (!target) {
      showToast({ status: 'error', message: localize('com_ui_ai_quota_validation_user') });
      return;
    }
    if (reason.trim().length < 3) {
      showToast({ status: 'error', message: localize('com_ui_ai_quota_validation_reason') });
      return;
    }
    setBusy(true);
    try {
      await quotaApi<Summary>(
        `/api/ai-quota/admin/users/${encodeURIComponent(target.identity.userId)}/${action}`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      showToast({ status: 'success', message: localize('com_ui_ai_quota_action_complete') });
      setShowValidation(false);
      await load();
    } catch (error) {
      showToast({
        status: 'error',
        message: localize(quotaErrorKey(error, 'com_ui_ai_quota_action_failed')),
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
            {localize(statusKey(user.mapping?.credentialStatus ?? 'missing'))})
          </option>
        ))}
        {users.length === 0 && <option value="">{localize('com_ui_ai_quota_no_users')}</option>}
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
              let nextScopeValue = '';
              if (next === 'user') {
                nextScopeValue = targetId;
              } else if (next === 'default') {
                nextScopeValue = '*';
              }
              setScope(next);
              setScopeValue(nextScopeValue);
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
          <Label htmlFor="ai-policy-quota">{localize('com_ui_ai_quota_assignment')}</Label>
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
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="ai-policy-model-search">{localize('com_ui_ai_quota_models')}</Label>
          <span className="text-xs text-text-secondary">
            {localize('com_ui_ai_quota_selected_count', { 0: selectedModels.length })}
          </span>
        </div>
        <Input
          id="ai-policy-model-search"
          className="mt-1"
          value={modelQuery}
          onChange={(event) => setModelQuery(event.target.value)}
          placeholder={localize('com_ui_ai_quota_search_models')}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-text-secondary">
            {localize('com_ui_ai_quota_catalog_count', { 0: catalog.models.length })}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={selectFilteredModels}>
              {localize('com_ui_select_all')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setSelectedModels([])}>
              {localize('com_ui_clear_all')}
            </Button>
          </div>
        </div>
        <div
          className="mt-2 max-h-52 overflow-y-auto rounded-md border border-border-medium bg-surface-primary p-2"
          role="group"
          aria-label={localize('com_ui_ai_quota_models')}
        >
          {filteredModels.map((model) => (
            <label
              key={model}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-secondary"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border-medium"
                checked={selectedModelSet.has(model)}
                onChange={() => toggleModel(model)}
              />
              <span className="break-all">{model}</span>
            </label>
          ))}
          {filteredModels.length === 0 && (
            <p className="px-2 py-3 text-sm text-text-secondary">
              {localize(
                catalog.models.length === 0
                  ? 'com_ui_ai_quota_catalog_empty'
                  : 'com_ui_ai_quota_model_no_results',
              )}
            </p>
          )}
        </div>
      </div>
      <Input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={localize('com_ui_ai_quota_reason')}
        aria-describedby="ai-policy-validation"
      />
      <p className="text-xs text-text-secondary">{localize('com_ui_ai_quota_reason_hint')}</p>
      {showValidation && validationError != null && (
        <p
          id="ai-policy-validation"
          className="text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {localize(validationError)}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          onClick={() =>
            accountAction(target?.mapping?.credentialStatus === 'revoked' ? 'restore' : 'revoke')
          }
          disabled={busy || !target?.mapping}
        >
          {target?.mapping?.credentialStatus === 'revoked'
            ? localize('com_ui_ai_quota_restore')
            : localize('com_ui_ai_quota_revoke')}
        </Button>
        <Button variant="outline" onClick={() => accountAction('apply')} disabled={busy}>
          {localize('com_ui_ai_quota_provision_sync')}
        </Button>
        <Button variant="submit" onClick={savePolicy} disabled={busy}>
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
        message: localize(quotaErrorKey(error, 'com_ui_ai_quota_load_failed')),
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
