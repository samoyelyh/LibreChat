import { fireEvent, render, screen } from '@testing-library/react';
import AdminUsers from './AdminUsers';

const mockMutate = jest.fn();
const mockShowToast = jest.fn();

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: { 0?: string | number }) =>
    options?.[0] == null ? key : `${key}:${options[0]}`,
}));

jest.mock(
  '~/data-provider',
  () => ({
    useGetStartupConfig: () => ({ data: { minPasswordLength: 8 } }),
    useListRoles: () => ({
      data: {
        roles: [{ name: 'ADMIN' }, { name: 'USER' }, { name: 'operation' }],
      },
      isLoading: false,
    }),
    useAdminGroupsQuery: () => ({
      data: {
        groups: [{ _id: '507f1f77bcf86cd799439011', name: 'Operations', source: 'local' }],
      },
      isLoading: false,
    }),
    useAdminUsersQuery: () => ({
      data: { users: [], total: 0, limit: 25, offset: 0 },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    }),
    useCreateAdminUserMutation: () => ({ mutate: mockMutate, isLoading: false }),
  }),
  { virtual: true },
);

describe('AdminUsers', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockShowToast.mockClear();
  });

  it('submits a regular business role and department without exposing system ADMIN', () => {
    render(<AdminUsers />);

    expect(screen.queryByRole('option', { name: 'ADMIN' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('com_auth_full_name'), {
      target: { value: 'Test User' },
    });
    fireEvent.change(screen.getByLabelText('com_auth_username'), {
      target: { value: 'testuser' },
    });
    fireEvent.change(screen.getByLabelText('com_auth_email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('com_ui_role'), {
      target: { value: 'operation' },
    });
    fireEvent.change(screen.getByLabelText('com_auth_password'), {
      target: { value: 'secure-password' },
    });
    fireEvent.change(screen.getByLabelText('com_auth_password_confirm'), {
      target: { value: 'secure-password' },
    });
    fireEvent.change(screen.getByLabelText('com_ui_admin_users_department'), {
      target: { value: '507f1f77bcf86cd799439011' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_create' }));

    expect(mockMutate).toHaveBeenCalledWith({
      name: 'Test User',
      username: 'testuser',
      email: 'test@example.com',
      password: 'secure-password',
      confirmPassword: 'secure-password',
      role: 'operation',
      groupId: '507f1f77bcf86cd799439011',
    });
  });

  it('explains why an incomplete form cannot be submitted', () => {
    render(<AdminUsers />);

    const createButton = screen.getByRole('button', { name: 'com_ui_create' });
    expect(createButton).toBeEnabled();

    fireEvent.click(createButton);

    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      status: 'error',
      message: 'com_auth_name_required',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('com_auth_name_required');
  });
});
