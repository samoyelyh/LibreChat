# Phase 5：服务端执行型 Skill 与共享业务 Agent

## 目标

本阶段把系统管理员已有的两个提示词迁移为可复用的业务能力，同时满足：

- 所有已授权用户可看到并使用业务 Agent；
- 普通用户只能看到 Skill 名称、说明和调用状态，不能读取正文、frontmatter、来源元数据或附件；
- Skill 正文仅在 Agent 运行时由服务器从 MongoDB 注入模型上下文；
- New API 继续采用“一名 LibreChat 用户对应一枚独立 Token”的映射，不共享管理员 Token。

## 业务对象

| 共享 Agent                                    | 私有 Skill                           | 模型      |
| --------------------------------------------- | ------------------------------------ | --------- |
| 亚马逊 FBA 容量管理器扩容申请测算专家         | `amazon-fba-capacity-expansion`      | `gpt-5.6-sol` |
| 亚马逊Listing竞品调研、图片分析与文案生成专家 | `amazon-listing-competitor-research` | `gpt-5.6-sol` |

预置脚本从管理员拥有的 PromptGroup 的 `productionId` 读取当前正式 Prompt，复制到 `executionOnly: true` 的 Skill。脚本不把提示词正文、Token 或用户隐私写入 Git、标准输出或部署记录。原 PromptGroup 保留为管理员历史源，不自动删除。

## 权限模型

- 内置 `ADMIN`：`AGENTS` 与 `SKILLS` 的 `USE`、`CREATE`、`SHARE` 为 `true`，`SHARE_PUBLIC` 为 `false`。
- 内置 `USER` 与 `admin`、`technical`、`operation`、`advertising`、`finance`、`viewer`：只开放 `USE`。
- 两个 Agent 和两个 Skill 均给系统管理员用户授予 Owner ACL，并给上述普通角色授予 Viewer ACL。
- Skill 设置 `user-invocable: false`，用户不能通过 `$skill` 手工把正文附加到消息；Agent 设置 `skills_enabled: true` 且只允许对应 Skill。
- 共享 Skill 默认激活，避免新用户需要先进入 Skill 页面手工开启。

## 内容隔离

`executionOnly` 是本项目在 LibreChat v0.8.7 上增加的持久化字段。对于既不是 Skill 作者、也不是系统 `ADMIN` 的 Viewer：

- `GET /api/skills/:id` 返回空 `body`、`bodyRedacted: true`，且不返回 `frontmatter` 和 `sourceMetadata`；
- `GET /api/skills/:id/files` 返回 403；
- `GET /api/skills/:id/files/SKILL.md` 和其他附件读取返回 403；
- 非作者即使被误授予 Editor ACL，也不能关闭 `executionOnly` 或修改受管 Skill；
- Skill 列表只返回名称、说明、分类和安全调用元数据；
- 前端隐藏正文/源码切换，显示“服务端执行型 Skill”说明。

Agent 运行时不通过上述 HTTP 详情接口取正文，而是使用已完成 ACL 过滤的服务端数据库方法，因此模型仍能执行 Skill。Skill 工具卡片只返回“Skill 已加载”的状态文本，不直接返回正文。

## New API 边界

业务 Agent 固定使用 `woda-ai` Endpoint。AI Quota Adapter 仍按当前 LibreChat 用户 ID 与 Email 查询独立映射，再注入该用户自己的 New API Token。

截至 2026-07-24：

- 只有系统管理员存在 `active` 映射，允许 29 个模型；
- Phase 1 测试用户没有映射，因此能看到共享 Agent，但在录入自己的 New API Token 前不能发起模型调用；
- 本阶段没有复制、共享或降级使用管理员 Token，也没有新增自动开通用户逻辑。

## 部署和验证

```bash
cd /opt/cross-border-ai
deploy/backup.sh
deploy/build-librechat-phase4.sh
deploy/start.sh
deploy/verify-phase5.sh
```

`seed-phase5-private-skills.sh` 可重复执行：它只在源 Prompt 或受管配置变化时更新 Skill/Agent，并使用 upsert 方式维护 ACL。`verify-phase5.sh` 连续执行两次预置，并验证：

- Compose 与界面配置；
- 两个 Skill、两个 Agent、八个角色权限和 Owner/Viewer ACL；
- 普通用户能列出共享 Skill/Agent；
- 普通用户详情被脱敏，正文和附件接口均被拒绝；
- 系统管理员能读取完整 Skill 正文。

2026-07-24 实际结果：

- 完整生产镜像构建成功，前端 Vite 构建转换 9305 个模块；
- 后端 TypeScript 构建成功；
- `PHASE5_VERIFY_OK`；
- `PHASE2_VERIFY_OK`、`PHASE3_VERIFY_OK`、`PHASE4_VERIFY_OK` 回归通过；
- 路由 Jest 测试在执行断言前被上游 `mongodb-memory-server` 的 Alpine 不支持限制阻断，真实 MongoDB 双账号 API 验收已覆盖新增安全边界。

## 回滚

本次部署前备份为：

`/opt/cross-border-ai/deploy/backups/20260724T102044Z`

恢复配置和镜像：

```bash
deploy/rollback.sh /opt/cross-border-ai/deploy/backups/20260724T102044Z
```

只有确认需要回退数据库中的 Skill、Agent、ACL 和 Role 时才附加 `--restore-db`。回滚脚本不会删除命名卷。

## 已知安全限制

API 与文件存储隔离可以阻止普通用户直接读取提示词，但任何被发送到大模型上下文的内部指令都无法从理论上保证抵御全部提示词套取或模型复述。当前额外使用服务端执行、禁止手工调用、隐藏工具中间输出和保密指令降低风险。若提示词属于不可泄露的高价值算法，应把关键规则实现为确定性的服务端代码或受控工具，只把必要结果提供给模型。
