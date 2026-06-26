# Kun Mobile — 手机端伴侣 App

## 背景

桌面端 Kun 已暴露完整的 REST + SSE API（`kun-endpoints.ts`），覆盖线程、审批、用量等全部操作，但目前仅被桌面端 renderer 消费。

用户离开桌面后，Kun 桌面端 agent 仍在运行，但用户无法：

- 实时查看 agent 执行进度和输出
- 审批 agent 发出的危险操作请求（导致 agent 卡住）
- 向 agent 下发新指令
- 统一查看多个项目/线程的运行状态
- 及时获知 agent 报错或需要干预

目前已有的"连接手机（Claw）"通过 IM 聊天方式部分解决了远程交互，但信息密度低、缺少结构化看板，不适合多线程监控和批量管理。

## 目标

构建 **Kun Mobile**：一个 React Native (Expo) 跨平台手机 App，定位为桌面端 Kun 的"遥控器 + 仪表盘"。手机端不实现任何 agent 逻辑，纯复用桌面端已有 REST + SSE API。与 Claw（IM 聊天式交互）互补，Kun Mobile 侧重结构化看板管理。

核心目标：

1. **远程监控与看板**：实时查看所有线程列表、对话输出、todo 进度、用量统计，多线程状态一目了然
2. **远程干预**：手机端 approve/deny 审批、发送消息、中断 (interrupt)、转向 (steer)
3. **随时连接**：离开桌面后通过 Mobile Gateway 接入桌面端 Kun

## 架构方案：Mobile Gateway

### 概述

桌面端新增一个 **Mobile Gateway** 服务，在独立端口监听 `0.0.0.0`，作为手机端访问的唯一入口。Gateway 负责认证校验和 API 白名单转发，Kun 原有 HTTP server（`127.0.0.1`）不做任何改动。

```
手机 App                    Kun 桌面端
───────                    ──────────
   │                           │
   │  /mobile/v1/threads       │
   │  Authorization: Bearer    │
   │    <session-token>        │
   │                           │
   ▼  LAN / Tailscale /        │
      Cloudflare Tunnel        │
      (任意网络层)              │
   │                           │
   ▼                           │
┌─────────────────────┐        │
│ Mobile Gateway       │        │
│ listen: 0.0.0.0:XXXX│        │
│                      │        │
│ 1. 校验 Bearer token │        │
│ 2. 检查白名单         │        │
│ 3. 剥离 /mobile 前缀  │        │
│ 4. 转发到 Kun API    │───────►│
└─────────────────────┘        │
                     内部转发    │
                     localhost  │
                               ▼
                      ┌─────────────────┐
                      │ Kun HTTP Server  │
                      │ 127.0.0.1:18899  │
                      │ (不做任何改动)    │
                      └─────────────────┘
```

### 路径规范

手机端所有请求使用 `/mobile/*` 前缀。Gateway 剥离前缀后转发到 Kun API。完整端点列表见下方 API 白名单。


| 手机端调用                                      | Gateway 转发到 Kun               |
| ------------------------------------------ | ----------------------------- |
| `GET /mobile/health`                       | `GET /health`                 |
| `GET /mobile/v1/threads`                   | `GET /v1/threads`             |
| `GET /mobile/v1/threads/{id}/events` (SSE) | `GET /v1/threads/{id}/events` |
| `POST /mobile/v1/threads/{id}/turns`       | `POST /v1/threads/{id}/turns` |
| …                                          | …                             |


### API 白名单

Gateway 仅转发以下端点，不在白名单的请求返回 404：


| 端点                                             | 用途              |
| ---------------------------------------------- | --------------- |
| `GET /health`                                  | 连接检测            |
| `GET /v1/threads`                              | 线程列表            |
| `GET /v1/threads/{id}`                         | 线程详情            |
| `GET /v1/threads/{id}/todos`                   | todo 列表         |
| `GET /v1/threads/{id}/events`                  | SSE 实时事件流       |
| `POST /v1/threads/{id}/turns`                  | 发送消息            |
| `POST /v1/threads/{id}/turns/{turn}/interrupt` | 中断              |
| `POST /v1/threads/{id}/turns/{turn}/steer`     | 转向              |
| `POST /v1/approvals/{id}`                      | 审批 approve/deny |
| `POST /v1/user-inputs/{id}`                    | 用户输入回复          |
| `GET /v1/usage`                                | 用量统计            |


**不开放**：attachment、memory、debug、settings、runtime info、session、todo 更新等端点。

## 认证方案

### Token 生命周期

```
桌面端 Settings → "开启手机连接"
→ 自动启动 Mobile Gateway
→ 生成随机 session token (crypto.randomUUID)
→ 写入 electron-store: mobile.sessions = [{ id, name, token, createdAt }]

Settings 展示 Gateway 端口和 token（供手动输入），
后续 Phase 2 展示配对二维码（含本机 LAN IP + Gateway 端口 + token）

→ 手机手动输入或扫码
→ 后续所有请求带 Authorization: Bearer <token>
→ Gateway 校验 token，不匹配返回 401
```

### 桌面端新增


| 组件            | 说明                                              |
| ------------- | ----------------------------------------------- |
| Token 存储      | `electron-store` key: `mobile.sessions`         |
| Gateway 认证中间件 | 校验 Bearer token，拦截所有 Gateway 请求                 |
| Token 展示      | Settings 页面展示当前 token 供用户复制到手机端                 |
| 刷新 token      | Settings 页面支持手动刷新 token（生成新 token，旧 token 立即失效） |
| 撤销机制          | Settings 页面列出已配对设备，支持单条撤销                       |


### 安全约束

- session token 使用 `crypto.randomUUID()` 生成
- token 仅存储于桌面端 `electron-store`，不记录日志
- 撤销或刷新后旧 token 立即失效，关联请求返回 401

## 技术选型

### 移动端


| 层        | 选型                                  | 说明                                                                                |
| -------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| 框架       | **React Native (Expo managed)**     | iOS + Android 一套代码，团队 TS/React 技术栈一致，Expo 管理模式零原生配置                               |
| 状态管理     | **Zustand**                         | 与桌面端 renderer 一致，轻量、TypeScript 友好                                                 |
| SSE 客户端  | **`@microsoft/fetch-event-source`** | 纯 JS 实现，兼容 Expo managed workflow；内置自动重连、支持 POST；Expo SDK 51+ 已完整支持 ReadableStream |
| HTTP 客户端 | **原生 `fetch`**                      | Expo 内置，无需额外依赖                                                                    |
| 推送通知     | **`expo-notifications`**            | 封装 APNs (iOS) + FCM (Android)，Phase 3 使用                                          |


### 桌面端 Gateway


| 层       | 选型                       | 说明                                                                               |
| ------- | ------------------------ | -------------------------------------------------------------------------------- |
| HTTP 服务 | **Node.js 原生 `http` 模块** | 零依赖，SSE 流式响应通过 `res.pipe(res)` 透传，约 100-150 行代码，可放在 `src/main/mobile-gateway.ts` |
| 认证存储    | **`electron-store`**     | 桌面端已有，无需引入新方案                                                                    |


### 平台差异


| 场景       | iOS                  | Android                              |
| -------- | -------------------- | ------------------------------------ |
| App 进入后台 | SSE 断开，回前台自动重连       | SSE 可能保持（Foreground Service），受电池优化影响 |
| 后台推送     | APNs（Phase 3）        | FCM（Phase 3）                         |
| 构建要求     | 需 Apple Developer 账号 | 免费                                   |


> Phase 1 和 2 双平台体验完全一致，平台差异在 Phase 3 做后台推送时才需处理。

### UI 框架与视觉风格


| 层     | 选型             | 说明                                                                              |
| ----- | -------------- | ------------------------------------------------------------------------------- |
| UI 框架 | **NativeWind** | Tailwind CSS for React Native，可直接复用桌面端 `tailwind.config.js` 中的 token 定义，团队零学习成本 |


### 视觉语言（继承桌面端）

手机端继承桌面端 `base-shell.css` 的 `--ds-*` 设计 token，适配移动端触控交互。

**色彩体系：**


| Token              | Light                   | Dark                     | 用途              |
| ------------------ | ----------------------- | ------------------------ | --------------- |
| `--bg-app`         | `#f3f5fc`               | `#0f1422`                | 应用背景            |
| `--bg-canvas`      | `#fafbff`               | `#161d30`                | 内容区背景           |
| `--surface-1`      | `rgba(255,255,255,0.9)` | `rgba(22,29,47,0.92)`    | 卡片              |
| `--text-primary`   | `#233659`               | `#f0f5fc`                | 主文字             |
| `--text-secondary` | `#54678c`               | `#bdc9de`                | 次文字             |
| `--text-tertiary`  | `#8492b1`               | `#8593b1`                | 辅助文字            |
| `--border-soft`    | `rgba(20,47,95,0.13)`   | `rgba(151,192,235,0.13)` | 边框              |
| Accent             | `#3b82d8`               | `#6fb0e8`                | 主色调（Whale Blue） |
| Success            | `#128a4a`               | `#40c977`                | 成功/完成           |
| Danger             | `#d6493f`               | `#f8736a`                | 危险/错误           |
| Skill/Tool         | `#7a68e8`               | `#a89bf5`                | 工具调用            |


**设计原则：**


| 维度  | 桌面端                                  | 手机端适配                             |
| --- | ------------------------------------ | --------------------------------- |
| 背景  | 多层渐变 + 径向光晕                          | 简化为单层渐变，保持淡紫/深海色调                 |
| 卡片  | 半透明毛玻璃 `backdrop-filter: blur(18px)` | 保留毛玻璃效果                           |
| 圆角  | 卡片 14-18px，按钮 8-14px，输入框 24px        | 保持一致（12-16px）                     |
| 阴影  | 大面积弥散、蓝色调、多层叠加                       | 保持，iOS 原生阴影天然适配                   |
| 字体  | SF Pro Text / PingFang SC，正文 15px    | iOS 系统字体 / Android Roboto，保持 15px |
| 间距  | 卡片间 `gap-3`（12px）                    | 略收紧为 `gap-2`（8px），屏幕更紧凑           |
| 交互  | hover 效果（提升 + 阴影增强）                  | 改为 press 反馈（缩放 + 阴影变化），去掉 hover   |
| 过渡  | 150ms ease                           | 保持一致                              |


> 深色模式在 Phase 2 实现，但 token 体系从 Day 1 就按双主题设计，避免后续重构。

## 项目结构

### 总览

```
Kun/
├── src/
│   ├── main/
│   │   ├── mobile-gateway.ts        # NEW: Gateway 服务
│   │   ├── mobile-gateway.test.ts   # NEW: Gateway 测试
│   │   ├── mobile-session.ts        # NEW: session token 管理
│   │   └── ...                      # 现有文件不动
│   ├── shared/
│   │   ├── kun-endpoints.ts         # 现有，路径常量
│   │   └── mobile-api-types.ts      # NEW: 手机端 API 响应类型定义
│   ├── renderer/                    # 现有桌面端渲染进程，不动
│   └── ...
│
├── mobile/                          # NEW: Expo 项目（独立构建）
│   ├── app.json                     # Expo 配置
│   ├── package.json                 # Expo 依赖（独立于根 package.json）
│   ├── tsconfig.json
│   ├── app/                         # Expo Router 页面
│   │   ├── (tabs)/
│   │   │   ├── index.tsx            # Dashboard
│   │   │   ├── approvals.tsx        # 审批中心
│   │   │   └── settings.tsx         # 设置
│   │   ├── thread/[id].tsx          # 线程详情
│   │   └── _layout.tsx              # 根布局
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.ts            # HTTP client（fetch + auth header）
│   │   │   ├── threads.ts           # GET /mobile/v1/threads 等
│   │   │   ├── approvals.ts         # POST /mobile/v1/approvals/{id}
│   │   │   └── sse.ts               # SSE 连接管理
│   │   ├── store/
│   │   │   ├── connection.ts        # 连接状态 + token（Zustand）
│   │   │   ├── threads.ts           # 线程列表 + 详情
│   │   │   └── approvals.ts         # 审批队列
│   │   ├── components/
│   │   │   ├── ThreadCard.tsx
│   │   │   ├── TodoList.tsx
│   │   │   ├── ApprovalCard.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── StatusBar.tsx
│   │   └── types/
│   │       └── api.ts               # 从 shared 重导出类型
│   └── assets/
│
├── package.json                     # 根 package.json，不动
└── ...
```

### 关键决策


| 决策                                     | 理由                                                              |
| -------------------------------------- | --------------------------------------------------------------- |
| `mobile/` 放根目录，不放 `src/`               | Expo 用 Metro bundler，构建体系与 Electron (Vite) 完全独立                 |
| Gateway 放 `src/main/`                  | 与 `claw-runtime.ts`、`schedule-runtime.ts` 同级，是 Electron 主进程的一部分 |
| 共享类型放 `src/shared/mobile-api-types.ts` | 手机端和 Gateway 都需要 API 响应类型，放 shared 两边引用                         |
| 手机端用 Expo Router                       | Expo 推荐的文件路由方案                                                  |
| 手机端独立 `package.json`                   | Expo 依赖不污染根 `package.json` 的 Electron 依赖                        |


### 类型共享

```typescript
// src/shared/mobile-api-types.ts — 手机端和 Gateway 共享
export interface ThreadDTO { id: string; title: string; status: string; /* ... */ }
export interface TodoDTO { id: string; content: string; status: string; /* ... */ }
export interface ApprovalDTO { id: string; summary: string; status: string; /* ... */ }

// mobile/src/types/api.ts — 手机端重导出
export type { ThreadDTO, TodoDTO, ApprovalDTO } from '../../../src/shared/mobile-api-types'
```

### 开发工作流

```bash
# 桌面端（现有流程不变）
npm run dev

# 手机端（新流程）
cd mobile
npx expo start
# 扫码在手机上打开 Expo Go，或用 iOS Simulator / Android Emulator
```

两个进程独立运行，手机端通过 LAN 连接到桌面端的 Gateway。

## 验收标准

### Phase 1 — 能用 (MVP, 2-3 周)

**桌面端：**

- [ ] Mobile Gateway 服务：独立端口监听 `0.0.0.0`，剥离 `/mobile` 前缀转发到 `127.0.0.1:18899`
- [ ] Gateway 认证中间件：校验 Bearer token
- [ ] Gateway API 白名单：上述 11 个端点，其他返回 404
- [ ] `electron-store` 新增 `mobile.sessions` 存储
- [ ] Settings → "连接手机" 区域：Gateway 开关、本机 LAN IP 展示、Gateway 端口、session token 展示（供复制）、已配对设备列表、撤销连接

**手机端：**

- [ ] 手动输入连接地址（Gateway 的 IP:Port）+ 手动输入 token 建立连接
- [ ] Dashboard 展示线程列表及每个线程的 todo 进度
- [ ] 线程详情页：通过 SSE 事件流展示对话历史和 todo 面板，与桌面端 renderer 实时同步
- [ ] SSE 事件处理：完整对齐桌面端 renderer（assistant\_text\_delta、tool\_call、todo\_updated、approval\_requested、turn\_completed、turn\_failed、usage、user\_input\_requested）
- [ ] 审批功能：SSE 收到 approval\_requested 后弹出卡片，支持 approve / deny（`POST /v1/approvals/{id}`）
- [ ] 用户输入：SSE 收到 user\_input\_requested 后弹出输入框，提交后调用 `POST /v1/user-inputs/{id}`
- [ ] 发送消息：向指定线程发送文本消息，触发 agent 新 turn
- [ ] 连接断开自动重连 + 切回前台时恢复 SSE 连接

### Phase 2 — 好用 (2-3 周)

- [ ] 扫码连接（桌面端展示含连接地址 + token 的二维码，手机扫描后自动填入）
- [ ] interrupt（中断当前 turn）和 steer（转向）操作
- [ ] assistant\_text\_delta 流式逐字输出（P1 先在 turn 完成时显示完整内容）
- [ ] 用量统计页面
- [ ] 深色模式
- [ ] 支持记住多个桌面端连接

### Phase 3 — 离不开 (2-3 周)

- [ ] mDNS 局域网自动发现桌面端
- [ ] APNs (iOS) / FCM (Android) 后台推送通知
- [ ] Cloudflare Tunnel / Tailscale 一键配置引导
- [ ] 语音输入
- [ ] iOS / Android 主屏幕 Widget（显示活跃线程状态）

### 非功能约束

- [ ] Gateway 端口动态分配，复用 Kun 端口池逻辑，端口通过 Settings UI 展示
- [ ] 连接失败时明确提示"桌面端未运行或不可达"

## 错误处理策略

### 手机端


| 场景           | 表现               | 处理                                   |
| ------------ | ---------------- | ------------------------------------ |
| Gateway 不可达  | 连接超时或拒绝          | 全屏提示"无法连接到桌面端"，提供重试按钮和设置入口           |
| Token 无效/已撤销 | Gateway 返回 401   | 清除本地 token，跳转到连接设置页面，提示"请重新输入 token" |
| SSE 连接断开     | 网络波动或 Gateway 重启 | 自动重连（指数退避，最大间隔 30s），顶部显示"重连中…"状态条    |
| App 切回前台     | iOS 后台期间 SSE 断开  | 立即重连 SSE + 拉取最新状态，无缝恢复               |
| API 返回 404   | 白名单外的端点          | 不应发生（手机端代码只调白名单内的端点），捕获后上报           |
| API 返回 5xx   | Kun 内部错误         | Toast 提示"服务异常，请稍后重试"                 |


### 桌面端 Gateway


| 场景            | 处理                                                         |
| ------------- | ---------------------------------------------------------- |
| Kun API 不可达   | Gateway 启动时探测 Kun `/health`，不可达则不启动 Gateway 并在 Settings 提示 |
| Kun API 运行中断开 | Gateway 转发时收到连接拒绝，返回 502 给手机端                              |
| 无效 token      | 返回 401，不记录详细错误信息（防止 token 泄露）                              |
| 白名单外请求        | 返回 404，静默丢弃                                                |
