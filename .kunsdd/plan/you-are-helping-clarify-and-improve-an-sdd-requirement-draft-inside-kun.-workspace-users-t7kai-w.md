文件还是有一部分损坏（白名单节被项目结构内容覆盖了），但核心设计我已经完整理解。以下是我的架构审视。

---

## 架构审视

### 一、整体评价：B+ / A-

设计在**约束条件下做出的取舍非常务实**：不碰 Kun 核心 API、独立 Gateway 进程、新端口监听 `0.0.0.0`。Gateway 作为 BFF（Backend for Frontend）解耦了认证和安全，这是标准实践。

---

### 二、五个值得肯定

| 领域 | 评价 |
|------|------|
| **Kun API 完全不动** | 非侵入式设计，风险极低。对现有功能零影响，也是正确的模块边界 |
| **Gateway 独立端口** | 不是改造 Kun server，而是新增独立服务。关注点分离清晰 |
| **`/mobile` 前缀 + 白名单** | 最少权限原则。即使 token 泄露，攻击面被限制在 11 个端点 |
| **纯 API 消费者** | 手机端没有 agent 逻辑、没有模型调用、没有工具执行。这是一个 thin client |
| **Expo managed workflow** | 避免原生构建复杂度，OTA 更新能力对快速迭代至关重要 |

---

### 三、需要修正的问题

#### P0（Launch Blocking）：Gateway 对 Kun 端口做了硬编码 `127.0.0.1:18899`

需求文档写：

> Gateway 剥离 `/mobile` 前缀转发到 `127.0.0.1:18899`

但 Kun 端口是**动态分配**的（`MIN_KUN_LOCAL_PORT = 10000`，实际可能因端口冲突被分配不同值）。Gateway 需要从 Kun 进程的 `runtime.port` 读取真实的端口，不能写死 18899。

**修复**：Gateway 接收 Kun 端口作为构造参数，或从 settings store 读取。

---

#### P0（Launch Blocking）：`/mobile` 前缀剥离会导致响应里的链接断裂

Kun SSE 事件可能包含绝对路径或需要客户端基于 base URL 拼接。如果 API 返回的字段里嵌了 `/v1/...` 路径（比如 `attachment` 链接），手机端拿到后直接拼接 Gateway URL 会失败。

不过当前白名单不包含 attachment，所以这个问题在 MVP 范围内不存在。但如果后续扩展白名单，需要注意响应体的 URL 改写。

**标记为 Track**，不需要在 MVP 处理。

---

#### P1（Fast Follow）：手机端没有离线/缓存能力

需求文档提到"局域网断开后保留最后缓存状态"，但验收标准和非功能约束都没有明确的缓存设计。手机端应该：

- 本地持久化线程列表（AsyncStorage）
- SSE 断连时显示缓存的最后状态
- 重新连接后平滑合并差异

**建议在 P1 非功能约束中补充**。

---

#### P1（Fast Follow）：没有 session token 的存储安全性

需求写 token 展示在 Settings 页面。但手机端拿到 token 后**存哪里**？React Native 的 AsyncStorage 或 SecureStore（Expo 提供 Keychain/Keystore 绑定）。建议明确定义：

- 手机端：`expo-secure-store`（安全存储，适合敏感数据）
- 桌面端：`electron-store`（已定义，正确）

---

### 四、Phase 拆分的真实问题

| Phase | 当前工作 | 实际工作量评估 |
|-------|---------|---------------|
| P1 | Gateway + 手机端所有核心功能 + SSE | **过重**。Gateway 约 3-5 天，手机端约 2-3 周。2-3 周估计偏乐观 |
| P2 | QR + interrupt/steer + 流式 + 用量 + 深色 + 多连接 | **合理** |
| P3 | mDNS + 推送 + Tunnel + 语音 + Widget | **过轻**。几个几乎独立的小功能 |

**建议**：可以把 Gateway 实现作为 P1 的 Week 1 目标（独立交付、独立验证），手机端 Week 2-3 陆续接入。这样 Gateway 可以先上线验证连通性。

---

### 五、缺失的设计维度

| 维度 | 现状 | 建议 |
|------|------|------|
| **Gateway 生命周期** | 文档未描述 | Gateway 何时启动（Settings 开关），何时关闭，崩溃后如何重启 |
| **手机端状态一致性** | 未讨论 | 当 Dashboard 和 Thread Detail 同时打开时，SSE 事件如何传播到两个页面（共享 session？分开连接？） |
| **版本兼容** | 未讨论 | 手机端版本 vs 桌面端版本不匹配时的处理 |
| **日志/调试** | 未讨论 | Gateway 请求日志、错误日志放在哪里。至少需要一个 `mobile-gateway.log` |
| **Gateway 对 Kun 启动顺序的依赖** | 已有定义 | ✅ Gateway 启动前探测 `/health`，文档已覆盖 |
| **SSE 连接的并发限制** | 未讨论 | 如果有多个手机连同一个 Gateway，每个手机都开一条 SSE 连接，Kun 能否承受？需要限制吗？ |

---

### 六、最危险的风险（Pre-mortem Top 3）

| # | 风险 | 分类 | 后果 |
|---|------|------|------|
| 1 | **Expo SDK 版本与 `@microsoft/fetch-event-source` 不兼容** | Tiger / Launch Blocking | SSE 客户端完全无法工作，P1 核心功能废掉 |
| 2 | **手机端和桌面端不在同一网络（公司 VPN、访客网络隔离等）** | Tiger / Track | 用户无法连接，支持负担激增 |
| 3 | **SSE 事件格式变化导致手机端解析崩溃** | Tiger / Fast Follow | 新增事件类型或字段变化时，手机端可能白屏 |

---

要我把以上审视结论也更新到需求文档里吗？还是你先逐条反馈哪条要采纳？