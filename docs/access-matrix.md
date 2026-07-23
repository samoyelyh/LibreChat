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

## Phase 2 AI 权限补充

- 只有存在 `active` AI Gateway 映射的 LibreChat 用户才能访问公司模型；本阶段只映射一个非管理员测试用户。
- 用户只能看到映射中的模型白名单，当前为 `kimi-k2`；伪造模型 ID 会在 Adapter 后端返回 403。
- 用户不能提供或覆盖 New API Base URL、Token 或最终 `Authorization` Header。
- 余额与使用记录接口根据 LibreChat JWT 的用户 ID 和 Email 再次匹配映射；不能读取其他用户数据。
- 角色与部门没有在 Phase 2 自动获得 AI 权限。批量开通、部门策略和完整模型权限管理仍属于 Phase 5。

## Phase 3 卖家精灵 MCP 权限补充

Phase 3 只开放 `MCP_SERVERS.USE`，所有角色的 `CREATE`、`SHARE`、`SHARE_PUBLIC` 和 `CONFIGURE_OBO` 继续关闭。

整个 `interface.mcpServers` 在 Phase 3 的 YAML 中刻意省略：v0.8.7 只要看到该对象，就会把它当作启动时系统角色权限迁移输入。省略后，数据库中的角色级 `MCP_SERVERS` 是唯一权限来源，API 单独重启不会把内置 `ADMIN` 或 `USER` 重置为内置默认值。

| LibreChat Role | 必需部门 | 卖家精灵权限 |
|---|---|---|
| 内置 `ADMIN` / `admin` | 管理层（内置 `ADMIN` 已预置） | 全部当前只读工具 |
| `operation` | 运营部 | ASIN、关键词、市场、评论四组 |
| `advertising` | 广告组 | 关键词组及两项竞品工具 |
| `technical` | 技术部 | 无普通用户调用权限；服务器管理员使用连接测试 CLI |
| `finance` | 财务组 | 无 |
| `viewer` | 只读访客 | 无 |
| 内置 `USER` | 任意 | 无 |

网关按 Role 与 Group 双重校验，界面权限不是安全边界。用户缺少其中任一归属时，后端返回 403。
