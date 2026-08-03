import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type {
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from '@tanstack/react-query';
import type {
  TError,
  ListAdminUsersResponse,
  ListAdminGroupsResponse,
  AdminCreateUserRequest,
  AdminCreateUserResponse,
} from 'librechat-data-provider';

export function useAdminUsersQuery(
  options?: UseQueryOptions<ListAdminUsersResponse>,
): UseQueryResult<ListAdminUsersResponse> {
  return useQuery<ListAdminUsersResponse>(
    [QueryKeys.adminUsers],
    () => dataService.listAdminUsers(),
    { retry: false, refetchOnWindowFocus: false, ...options },
  );
}

export function useAdminGroupsQuery(
  options?: UseQueryOptions<ListAdminGroupsResponse>,
): UseQueryResult<ListAdminGroupsResponse> {
  return useQuery<ListAdminGroupsResponse>(
    [QueryKeys.adminGroups],
    () => dataService.listAdminGroups(),
    { retry: false, refetchOnWindowFocus: false, ...options },
  );
}

export function useCreateAdminUserMutation(
  options?: UseMutationOptions<AdminCreateUserResponse, TError, AdminCreateUserRequest>,
): UseMutationResult<AdminCreateUserResponse, TError, AdminCreateUserRequest> {
  const queryClient = useQueryClient();
  return useMutation<AdminCreateUserResponse, TError, AdminCreateUserRequest>(
    [MutationKeys.createAdminUser],
    (payload) => dataService.createAdminUser(payload),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        void queryClient.invalidateQueries([QueryKeys.adminUsers]);
        void queryClient.invalidateQueries([QueryKeys.adminGroups]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
}
