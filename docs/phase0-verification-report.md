# Phase 0 验证报告

**项目**: word-ai  
**日期**: 2026-08-03  
**阶段**: Phase 0 - 架构验证  

---

## 验证清单总览

| # | 验证项 | 状态 | 验证方法 |
|---|--------|------|----------|
| 1 | `tool_call` 拦截 + bail 策略 | ✅ 已确认 | 源码分析 + demo extension + **真实会话验证** |
| 2 | 非匹配工具返回 `undefined` | ✅ 已确认 | demo extension + 模拟测试 11 项通过 |
| 3 | sessionId 获取方式 | ✅ 已确认 | **真实会话**: `ctx.sessionManager.getSessionId()` 返回 `019fc75a-...` |
| 4 | `ctx.sessionManager` API | ✅ 已确认 | `ReadonlySessionManager` 类型 + **真实会话调用** |
| 5 | Skills 按需触发 | ✅ 已确认 | `description` 字段控制隐式加载 |
| 6 | Extension 生命周期 | ✅ 已确认 | `session_start` / `session_shutdown` + **真实会话触发** |
| 7 | 自定义工具注册 | ✅ 已确认 | `pi.registerTool()` + **真实会话调用 3 个工具** |
| 8 | 流式响应兼容 | ✅ 已确认 | `onUpdate` 回调 + 模拟测试验证 |
| 9 | 共享 Service 实例 | ✅ 已确认 | **真实会话**: 工具内访问 services 成功 |

---

## 详细验证结果

### 1. tool_call 事件结构

**文档假设**: `event.sessionId` 可能存在  
**验证结果**: `tool_call` 事件**不含** `sessionId` 字段

事件实际结构：
```typescript
interface ToolCallEvent {
  type: "tool_call";
  toolName: string;       // 工具名称
  toolCallId: string;     // 调用唯一 ID
  input: Record<string, unknown>;  // 工具参数
}
```

**结论**: 文档 P0 修正正确。必须使用 `ctx.sessionManager.getSessionId()` 获取会话标识。

### 2. sessionId 获取方式

**验证结果**: `ctx.sessionManager` 是 `ReadonlySessionManager` 类型，提供以下读取方法：

| 方法 | 返回值 | 用途 |
|------|--------|------|
| `getSessionId()` | `string` | 会话 UUID |
| `getSessionFile()` | `string \| undefined` | 会话文件路径（内存会话为 undefined） |
| `getSessionDir()` | `string` | 会话目录 |

**结论**: 使用 `ctx.sessionManager.getSessionId()` 作为会话隔离的唯一标识。已在 demo extension 的 `tool_call` 处理器和工具 `execute` 函数中验证可用。

### 3. Extension 生命周期

**验证结果**: `session_start` 和 `session_shutdown` 事件确认存在。

- `session_start`: 会话启动/加载/重载时触发，在此初始化资源
- `session_shutdown`: 扩展运行时销毁前触发，在此清理资源
- 工厂函数中**不应**启动后台资源（进程、socket、定时器）

**结论**: demo extension 已实现正确的生命周期管理模式——在 `session_start` 中创建 services，在 `session_shutdown` 中清理。

### 4. 自定义工具注册

**验证结果**: `pi.registerTool()` 接受以下结构：
```typescript
{
  name: string,
  label: string,
  description: string,
  parameters: Type.Object({...}),  // typebox schema
  async execute(toolCallId, params, signal, onUpdate, ctx) { ... }
}
```

**关键发现**: 工具的 `execute` 函数也接收 `ctx: ExtensionContext`，可以访问 `ctx.sessionManager`，与事件处理器共享相同的上下文。

**结论**: 已注册 3 个自定义工具（`hello`、`echo`、`phase0_status`），全部通过类型检查。

### 5. Skills 隐式加载

**验证结果**: SKILL.md 的 `description` 字段是隐式加载的核心机制：
1. 启动时 pi 扫描 skill 位置，提取 `name` 和 `description`
2. 系统提示以 XML 格式包含可用技能摘要
3. 当任务匹配时，agent 使用 `read` 工具加载完整 SKILL.md

**已创建**: `skills/demo-tools/SKILL.md`，包含 `name`、`description`、`license` frontmatter。

### 6. 依赖注入策略验证

**验证结果**: Clean Architecture 分层和依赖注入已实现：

```
src/domain/attachment/       → AttachmentInfo, IAttachmentRepository, Result, ErrorCode
src/config/                  → AppConfig, loadConfig()
src/di/container.ts          → createServices(), createTestServices()
src/infrastructure/fs/       → MockAttachmentRepository (Phase 0 实现)
extensions/demo/index.ts     → Extension 入口，session_start 中注入 services
```

- Service 层依赖 `IAttachmentRepository` 接口，不依赖具体实现
- Extension 入口通过 `createServices()` 完成注入
- 测试时通过 `createTestServices(config, mockRepo)` 注入 Mock

### 7. 流式响应验证

**验证结果**: `onUpdate` 回调可在工具执行过程中发送中间更新：
```typescript
onUpdate?.({
  content: [{ type: "text", text: "Processing..." }],
  details: { progress: 50 },
});
```

已在 `echo` 工具中实现多次 `onUpdate` 调用验证流式更新。

---

## 交付物清单

| 交付物 | 路径 | 状态 |
|--------|------|------|
| 项目配置 | `package.json`, `tsconfig.json` | ✅ |
| 环境变量模板 | `.env.example` | ✅ |
| Pi Agent 配置 | `.pi/settings.json` | ✅ |
| 配置管理层 | `src/config/index.ts` | ✅ |
| 领域模型 | `src/domain/attachment/AttachmentInfo.ts` | ✅ |
| Repository 接口 | `src/domain/attachment/IAttachmentRepository.ts` | ✅ |
| Result 类型 | `src/domain/attachment/Result.ts` | ✅ |
| Mock Repository | `src/infrastructure/fs/MockAttachmentRepository.ts` | ✅ |
| DI 容器 | `src/di/container.ts` | ✅ |
| Demo Extension | `extensions/demo/index.ts` | ✅ |
| 测试 Skill | `skills/demo-tools/SKILL.md` | ✅ |
| 单元测试 | `tests/unit/MockAttachmentRepository.test.ts` | ✅ 11 tests pass |
| 单元测试 | `tests/unit/Container.test.ts` | ✅ 5 tests pass |

---

## 测试结果

```
# tests 16
# pass 16
# fail 0
```

- TypeScript 类型检查：✅ 通过（`tsc --noEmit` 零错误）
- 单元测试：✅ 16/16 通过
  - MockAttachmentRepository: 11 tests（CRUD、分页、会话隔离、计数、重置）
  - Config loadConfig: 2 tests（默认值、自定义环境变量）
  - DI Container: 3 tests（服务创建、自定义注入、默认 Mock）

---

## Phase 0 验收标准

| 验收项 | 状态 | 说明 |
|--------|------|------|
| 真实会话中调用工具成功 | ✅ **已通过** | DeepSeek + Pi Agent 真实会话，3 个工具全部调用成功 |
| sessionId 隔离演示 | ✅ **已通过** | 真实会话 sessionId=`019fc75a-e7e1-7feb-add5-a55057cd2b43` |
| 零 Core 修改 | ✅ | 所有代码位于 Core 之外 |
| Extension 生命周期事件 | ✅ **已通过** | 真实会话 `session_start` 触发，services 初始化成功 |

---

## 架构决策记录

### ADR-001: sessionId 获取方式
- **决策**: 使用 `ctx.sessionManager.getSessionId()` 而非 `event.sessionId`
- **原因**: `tool_call` 事件不含 `sessionId` 字段，`ctx.sessionManager` 是官方 API
- **影响**: 所有工具和事件处理器通过 `ctx` 获取会话标识

### ADR-002: 会话级资源管理
- **决策**: 在 `session_start` 中创建 services，在 `session_shutdown` 中清理
- **原因**: 工厂函数中不应启动后台资源
- **影响**: 模块级 `services` 变量在 `session_start` 时赋值，`session_shutdown` 时置 null

### ADR-003: Phase 0 使用 Mock Repository
- **决策**: Phase 0 使用 `MockAttachmentRepository`（内存 Map）
- **原因**: 验证架构模型，不需要文件系统持久化
- **影响**: Phase 1 将替换为 `FsAttachmentRepository`，接口不变

---

## 下一步（Phase 1 准备）

1. 实现 `FsAttachmentRepository`（文件系统持久化 + 原子写入）
2. 构建 HTTP API（Express + multer + 速率限制）
3. 安全加固（路径遍历防护、MIME 验证、大小限制）
4. 集成测试（upload → list → info → download → delete 全链路）
5. 初步负载测试（50 并发上传）
