# 版本与许可证清单

| 组件 | 固定版本 | 许可证/义务 |
|---|---|---|
| LibreChat | v0.8.7 / `9e74cc0e57b395926122bd4062c1fcedc48ed465` | 根 `LICENSE` 为 MIT，必须保留版权与许可证文本；上游 `package.json` 同时标注 ISC，作为已知不一致记录，不擅自删除任一声明。 |
| LibreChat Admin Panel | `sha256:9a78851f84f448eab780ac658c4d17db51974c240492affc789a72d61e35f678` | AGPL-3.0；保留上游可见链接、版权和对应源码义务。 |
| New API | v1.0.0-rc.21 / `bde9b2f44887d34ec54799ae191d50f97914359e` | AGPL-3.0；Phase 1 只做外部只读/最小请求验证，不分发或修改其源码。 |
| MongoDB | 8.0.20 | SSPL；内部自托管使用，遵循镜像内许可证。 |
| Meilisearch | 1.35.1 | MIT；保留镜像内声明。 |
| PostgreSQL/pgvector | PostgreSQL 15 + pgvector 0.8.0 | PostgreSQL License；保留镜像内声明。 |
| Nginx | 1.28.0 Alpine | BSD-2-Clause；保留镜像内声明。 |
| LibreChat RAG API | `sha256:c0ad82657b556c1e16dcfca85d045788f67caa223e25e70eb687f4d16b41dedc` | 以镜像随附许可证和官方仓库声明为准，分发时保留对应文本与来源。 |

本项目不移除 LibreChat 或第三方版权声明，不制作冒充上游的 Logo。生产交付必须同时保存 Compose 中的全部不可变 digest。
