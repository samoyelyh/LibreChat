import { useMemo, useState } from 'react';
import { Button, Input, Label, Spinner, useToastContext } from '@librechat/client';
import { SystemRoles } from 'librechat-data-provider';
import type { FormEvent } from 'react';
import type { TranslationKeys } from '~/hooks';
import {
  useListRoles,
  useAdminUsersQuery,
  useAdminGroupsQuery,
  useGetStartupConfig,
  useCreateAdminUserMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

type FormState = {
  name: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: string;
  groupId: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: SystemRoles.USER,
  groupId: '',
};

const errorKeys: Record<string, TranslationKeys> = {
  INVALID_INPUT: 'com_ui_admin_users_error_invalid',
  EMAIL_EXISTS: 'com_ui_admin_users_error_exists',
  ROLE_NOT_FOUND: 'com_ui_admin_users_error_role',
  GROUP_NOT_FOUND: 'com_ui_admin_users_error_department',
  ADMIN_ROLE_FORBIDDEN: 'com_ui_admin_users_error_admin_role',
  CREATE_FAILED: 'com_ui_admin_users_error_create',
};

export default function AdminUsers() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const startupQuery = useGetStartupConfig();
  const rolesQuery = useListRoles();
  const groupsQuery = useAdminGroupsQuery();
  const usersQuery = useAdminUsersQuery();
  const minPasswordLength = startupQuery.data?.minPasswordLength ?? 8;

  const roles = useMemo(
    () =>
      (rolesQuery.data?.roles ?? [])
        .filter((role) => role.name !== SystemRoles.ADMIN)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [rolesQuery.data?.roles],
  );
  const groups = useMemo(
    () =>
      (groupsQuery.data?.groups ?? []).sort((left, right) => left.name.localeCompare(right.name)),
    [groupsQuery.data?.groups],
  );

  const mutation = useCreateAdminUserMutation({
    onSuccess: (response) => {
      setForm(EMPTY_FORM);
      showToast({
        status: 'success',
        message: localize('com_ui_admin_users_success', { 0: response.user.email }),
      });
    },
    onError: (error) => {
      const errorCode = error.response?.data?.error_code ?? '';
      const key = errorKeys[errorCode] ?? 'com_ui_admin_users_error_create';
      showToast({ status: 'error', message: localize(key) });
    },
  });

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      showToast({ status: 'error', message: localize('com_auth_password_not_match') });
      return;
    }
    mutation.mutate({
      ...form,
      name: form.name.trim(),
      username: form.username.trim() || undefined,
      email: form.email.trim(),
      groupId: form.groupId || undefined,
    });
  };

  const loadingOptions = rolesQuery.isLoading || groupsQuery.isLoading;
  const canSubmit =
    !mutation.isLoading &&
    !loadingOptions &&
    form.name.trim().length >= 3 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    form.password.length >= minPasswordLength &&
    form.password === form.confirmPassword &&
    form.role.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-base">{localize('com_ui_admin_users_title')}</Label>
        <p className="mt-1 text-xs text-text-secondary">
          {localize('com_ui_admin_users_description')}
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={submit}
        aria-label={localize('com_ui_admin_users_title')}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="admin-user-name">{localize('com_auth_full_name')}</Label>
            <Input
              id="admin-user-name"
              value={form.name}
              autoComplete="off"
              minLength={3}
              maxLength={80}
              required
              onChange={(event) => update('name', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="admin-user-username">{localize('com_auth_username')}</Label>
            <Input
              id="admin-user-username"
              value={form.username}
              autoComplete="off"
              minLength={2}
              maxLength={80}
              onChange={(event) => update('username', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="admin-user-email">{localize('com_auth_email')}</Label>
            <Input
              id="admin-user-email"
              type="email"
              value={form.email}
              autoComplete="off"
              maxLength={120}
              required
              onChange={(event) => update('email', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="admin-user-role">{localize('com_ui_role')}</Label>
            <select
              id="admin-user-role"
              className="mt-1 w-full rounded-md border border-border-medium bg-surface-primary px-3 py-2 text-sm text-text-primary"
              value={form.role}
              required
              onChange={(event) => update('role', event.target.value)}
            >
              {roles.length === 0 && <option value={SystemRoles.USER}>{SystemRoles.USER}</option>}
              {roles.map((role) => (
                <option key={role.name} value={role.name}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="admin-user-password">{localize('com_auth_password')}</Label>
            <Input
              id="admin-user-password"
              type="password"
              value={form.password}
              autoComplete="new-password"
              minLength={minPasswordLength}
              maxLength={128}
              required
              onChange={(event) => update('password', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="admin-user-confirm-password">
              {localize('com_auth_password_confirm')}
            </Label>
            <Input
              id="admin-user-confirm-password"
              type="password"
              value={form.confirmPassword}
              autoComplete="new-password"
              minLength={minPasswordLength}
              maxLength={128}
              required
              aria-invalid={
                form.confirmPassword.length > 0 && form.confirmPassword !== form.password
              }
              onChange={(event) => update('confirmPassword', event.target.value)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="admin-user-department">{localize('com_ui_admin_users_department')}</Label>
          <select
            id="admin-user-department"
            className="mt-1 w-full rounded-md border border-border-medium bg-surface-primary px-3 py-2 text-sm text-text-primary"
            value={form.groupId}
            onChange={(event) => update('groupId', event.target.value)}
          >
            <option value="">{localize('com_ui_none')}</option>
            {groups.map((group) => (
              <option key={group._id} value={group._id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-text-secondary">
          {localize('com_ui_admin_users_password_hint', { 0: minPasswordLength })}
        </p>
        <div className="flex justify-end">
          <Button type="submit" variant="submit" disabled={!canSubmit}>
            {mutation.isLoading ? <Spinner className="h-4 w-4" /> : localize('com_ui_create')}
          </Button>
        </div>
      </form>

      <div className="border-t border-border-light pt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Label className="text-base">{localize('com_ui_admin_users_recent')}</Label>
          <Button
            type="button"
            variant="outline"
            disabled={usersQuery.isFetching}
            onClick={() => void usersQuery.refetch()}
          >
            {usersQuery.isFetching ? <Spinner className="h-4 w-4" /> : localize('com_ui_refresh')}
          </Button>
        </div>
        <div className="max-h-52 overflow-auto rounded-lg border border-border-light">
          {usersQuery.isLoading ? (
            <div className="flex justify-center p-5">
              <Spinner className="h-5 w-5" />
            </div>
          ) : (
            <ul className="divide-y divide-border-light" aria-live="polite">
              {(usersQuery.data?.users ?? []).map((user) => (
                <li key={user.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">{user.name}</p>
                    <p className="truncate text-xs text-text-secondary">{user.email}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-surface-secondary px-2 py-1 text-xs text-text-secondary">
                    {user.role}
                  </span>
                </li>
              ))}
              {(usersQuery.data?.users.length ?? 0) === 0 && (
                <li className="p-4 text-sm text-text-secondary">{localize('com_ui_none')}</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
