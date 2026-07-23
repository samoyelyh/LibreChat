# Phase 1 权限与部门矩阵

## 角色

| 业务角色 | LibreChat Role | 基础会话/提示词 | Admin Panel | Agent/MCP/Remote Agent | 高成本与写工具 |
|---|---|---|---|---|---|
| 超级管理员 | 内置 `ADMIN` | 由 LibreChat 系统角色管理 | 全部平台治理能力 | Agent、MCP、Remote Agent、Skills 全局显式关闭 | 代码执行、Web 搜索、记忆、文件检索全局关闭 |
| 业务管理员 | `admin` | 会话、提示词创建、多会话、临时会话 | 用户只读；角色/部门管理；配置、用量、审计只读 | 显式关闭 | 显式关闭 |
| 技术人员 | `technical` | 会话、提示词创建、多会话、临时会话 | 无 SystemGrant | 显式关闭 | 显式关闭 |
| 运营人员 | `operation` | 会话、提示词创建、多会话、临时会话 | 无 SystemGrant | 显式关闭 | 显式关闭 |
| 广告人员 | `advertising` | 会话、提示词创建、多会话、临时会话 | 无 SystemGrant | 显式关闭 | 显式关闭 |
| 财务人员 | `finance` | 基础只读，无提示词创建 | 无 SystemGrant | 显式关闭 | 显式关闭 |
| 只读访客 | `viewer` | 基础只读，无提示词创建 | 无 SystemGrant | 显式关闭 | 显式关闭 |

`admin` 的平台能力为：`access:admin`、`read:users`、`manage:groups`、`manage:roles`、`read:configs`、`read:usage`、`read:audit_log`。不授予 `manage:users`、`manage:configs`、`manage:mcpservers`、`manage:agents` 或其他内容管理能力。

## 部门

| Group | 建议成员角色 | Phase 1 初始成员关系 |
|---|---|---|
| 管理层 | `ADMIN` / `admin` | 首个系统 `ADMIN` 自动加入 |
| 技术部 | `technical` | 空，管理员按实际人员加入 |
| 运营部 | `operation` | 空，管理员按实际人员加入 |
| 广告组 | `advertising` | 空，管理员按实际人员加入 |
| 财务组 | `finance` | 空，管理员按实际人员加入 |
| 只读访客 | `viewer` | 空，管理员按实际人员加入 |

Role 是单用户岗位权限，Group 是部门归属，两者不得混作同一维度。预置脚本不会猜测尚未创建用户的部门或岗位。
