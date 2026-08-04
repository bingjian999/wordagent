# Phase 3 — 项目审核修复验证报告

## 概述

根据项目审核反馈，Phase 3 针对四个主要问题进行了修复：
1. PathResolver 跨平台 bug（8 个测试失败）
2. lint 脚本不可用（缺少 ESLint 依赖和配置）
3. CORS 默认配置不生效（通配符不被支持）
4. Session 机制过于简单（无签名校验）

额外修复：lockfile 镜像源锁定问题。

## 修复详情

### 1. PathResolver 跨平台 bug

**问题**：`src/tools/PathResolver.ts` 直接使用 `node:path`（在 POSIX 系统上等价于 `path.posix`），导致 Windows 路径（如 `C:\projects\app`）在非 Windows 系统上无法正确解析，8 个测试失败。

**修复方案**：
- 引入 `path.win32` 和 `path.posix` 模块
- 新增 `pathFor()` 函数根据输入路径风格自动选择对应的 path 模块
- Windows 盘符绝对路径（`C:\...`）在任何平台上都使用 `path.win32` 解析
- POSIX 绝对路径（`/home/...`）在任何平台上都使用 `path.posix` 解析
- 相对路径使用宿主平台的 path 模块
- 新增 7 个跨平台测试用例

**文件变更**：
- `src/tools/PathResolver.ts` — 核心修复
- `tests/unit/PathResolver.test.ts` — 新增跨平台测试

### 2. ESLint 配置

**问题**：`package.json` 中配置了 `lint` 脚本，但 ESLint 既不在 `devDependencies` 中，也没有 `eslint.config.js` 配置文件，脚本完全不可用。

**修复方案**：
- 添加 `@eslint/js`、`eslint`、`typescript-eslint` 到 `devDependencies`
- 创建 `eslint.config.mjs`（ESLint 9+ Flat Config 格式）
- 配置规则：`@typescript-eslint/no-unused-vars` (error)、`@typescript-eslint/no-explicit-any` (warn)、`prefer-const` (error)
- 从 lint 脚本中移除 `skills/`（仅包含 Markdown 文件）
- 修复 `PathResolver.ts` 中的 `no-control-regex` 错误（添加 eslint-disable 注释）

**文件变更**：
- `package.json` — 添加 ESLint 依赖
- `eslint.config.mjs` — 新建配置文件
- `src/tools/PathResolver.ts` — 修复 lint 错误

### 3. CORS 通配符支持

**问题**：`WORD_AI_CORS_ORIGINS` 默认值 `"http://localhost:*"` 直接传给 `cors` 中间件的 origin 数组，但 `cors` 库对字符串数组是精确匹配，不支持 `*` 通配符，导致 `http://localhost:3000` 等来源被拒绝。

**修复方案**：
- 新增 `createCorsOriginValidator()` 函数，将通配符模式转换为正则表达式验证器
- 支持模式如 `http://localhost:*`、`https://*.example.com` 等
- 无 Origin 头的请求（同源、curl 等）默认允许
- 更新 `server.ts` 使用新的验证器函数

**文件变更**：
- `src/config/index.ts` — 新增 `createCorsOriginValidator()`
- `src/infrastructure/express/server.ts` — 使用新的 CORS 验证器

### 4. Session HMAC 签名校验

**问题**：`requireSessionId` 中间件只检查 `x-session-id` 头是否非空，没有签名/校验，任何调用方可以自报 sessionId。

**修复方案**：
- 新建 `src/auth/SessionToken.ts` 模块，提供 `sign()` 和 `verify()` 函数
- Token 格式：`sessionId.base64url(hmacSha256(sessionId, secret))`
- 使用 `timingSafeEqual` 进行常量时间比较，防止时序攻击
- 新增 `WORD_AI_SESSION_SECRET` 环境变量配置
- 将 `requireSessionId` 重构为工厂函数 `createRequireSessionId(secret)`
- 当 secret 为空时（默认，localhost 模式），保持向后兼容，不校验签名
- 当 secret 非空时，验证 HMAC 签名，无效签名返回 401
- 保留 `requireSessionId` 作为向后兼容导出（使用空 secret）
- 新增 15 个单元测试覆盖签名、验证、篡改检测等场景

**文件变更**：
- `src/auth/SessionToken.ts` — 新建 HMAC 签名工具
- `src/config/index.ts` — 添加 `sessionSecret` 配置项
- `src/infrastructure/express/middleware.ts` — 重构为工厂模式
- `src/infrastructure/express/routes.ts` — 使用工厂函数
- `.env.example` — 添加 `WORD_AI_SESSION_SECRET` 文档
- `tests/unit/SessionToken.test.ts` — 新增 15 个测试

### 5. Lockfile 镜像源清理

**问题**：`package-lock.json` 中 223 处 `resolved` URL 指向 `registry.npmmirror.com`（国内镜像），在其他网络环境下可能安装失败。

**修复方案**：将所有 `registry.npmmirror.com` 替换为 `registry.npmjs.org`。

## 验证结果

| 检查项 | 结果 |
|--------|------|
| `tsc --noEmit` | ✅ 0 errors |
| `eslint src/ extensions/` | ✅ 0 errors, 24 warnings (`no-explicit-any`) |
| `tsx --test tests/unit/*.test.ts` | ✅ 256 pass, 0 fail |
| `tsx --test tests/integration/*.test.ts` | ✅ 14 pass, 0 fail |
| **总计** | **270 pass, 0 fail** |

### 测试分布

| 测试文件 | 用例数 |
|----------|--------|
| AttachmentService.test.ts | 14 |
| CalculatorTool.test.ts | 13 |
| Container.test.ts | 6 |
| ExpressionEvaluator.test.ts | 22 |
| FileEditTool.test.ts | 18 |
| FileIntelligenceService.test.ts | 12 |
| FsAttachmentRepository.test.ts | 12 |
| HtmlCleaner.test.ts | 32 |
| LineDocument.test.ts | 15 |
| MockAttachmentRepository.test.ts | 11 |
| PathResolver.test.ts | 24 |
| SessionToken.test.ts | 15 |
| SkillWriteTool.test.ts | 10 |
| SsrfGuard.test.ts | 16 |
| attachment-workflow.test.ts (integration) | 14 |
| **总计** | **270** |

## 环境变量变更

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `WORD_AI_SESSION_SECRET` | `""` (空) | Session HMAC 密钥。空值=无签名校验（仅限 localhost）；非空=启用 token 签名校验 |

## 使用说明

### 启用 Session 签名校验

```bash
# 生成随机密钥
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 设置环境变量
export WORD_AI_SESSION_SECRET="<生成的密钥>"
```

### 客户端生成签名 Token

```javascript
import crypto from 'node:crypto';

const sessionId = "my-session-id";
const secret = process.env.WORD_AI_SESSION_SECRET;
const sig = crypto.createHmac('sha256', secret).update(sessionId).digest('base64url');
const token = `${sessionId}.${sig}`;

// 在请求头中使用
// x-session-id: my-session-id.<signature>
```
