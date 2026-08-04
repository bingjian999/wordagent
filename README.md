# WordAgent — Pi Agent 扩展工具集

为 [Pi Agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 构建的附件管理平台和通用工具扩展，围绕 Word 文档 / 财务会计场景提供文件管理、计算器、网页抓取、文件编辑、技能写入和沙箱命令执行能力。

## 快速开始

```bash
# 安装依赖
npm install

# 复制环境配置
cp .env.example .env

# 类型检查
npm run typecheck

# 运行全部测试
npm run test:all

# 启动 Pi Agent（加载所有扩展）
npx pi-coding-agent -e ./extensions/tools/index.ts -e ./extensions/attachments/index.ts
```

## 工具清单

| 工具 | 功能 | 安全特性 |
|------|------|----------|
| `calc_eval_expression` | 算术表达式求值（千分位、会计负数、万元单位、百分比） | 表达式长度 / token 数限制 |
| `web_fetch` | 抓取公开网页并提取文本 | SSRF 防护（拦截内网/回环/链路本地）、HTML 清洗 |
| `file_edit` | 文件编辑（write/append/replace/replace_lines/delete） | 路径遍历防护、工作目录锁定 |
| `skill_write` | 沙箱内文件写入（仅 skills/ 目录） | 路径遍历防护、沙箱边界检查 |
| `shell_exec` | 执行白名单 Shell 命令 | execFile（非 exec）、命令白名单、参数正则验证、超时、输出限制 |

## 架构

```
src/
  domain/attachment/       # 领域模型（AttachmentInfo, IAttachmentRepository, Result）
  services/
    attachment/            # 附件业务逻辑
    parser/                # 文件智能分析（哈希、编码检测、预览）
    shell/                 # Shell 命令注册表
  infrastructure/
    express/               # HTTP API（路由、中间件、服务器）
    fs/                    # 文件系统实现（FsAttachmentRepository）
  config/                  # 环境变量配置 + CORS 验证器
  di/                      # 依赖注入容器
  auth/                    # HMAC 会话令牌
  tools/                   # 工具实现（计算器、网页抓取、文件编辑等）
extensions/
  demo/                    # 示例扩展
  attachments/             # 附件管理扩展
  tools/                   # 工具扩展（5 个工具注册）
skills/                    # SKILL.md 声明文件
tests/
  unit/                    # 单元测试
  integration/             # 集成测试
  e2e/                     # 端到端测试
```

## HTTP API

所有端点需要 `x-session-id` 请求头，使用 `/api/attachments` 前缀。

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/attachments/upload` | 单文件上传（multipart） |
| POST | `/api/attachments/upload-batch` | 批量上传 |
| GET | `/api/attachments` | 列表（分页 `?page=1&limit=20`） |
| GET | `/api/attachments/:id` | 获取附件信息 |
| GET | `/api/attachments/:id/download` | 下载原始文件 |
| GET | `/api/attachments/:id/text` | 读取文本内容 |
| DELETE | `/api/attachments/:id` | 删除单个附件 |
| DELETE | `/api/attachments` | 清空所有（需 `?confirm=true`） |
| GET | `/health` | 健康检查 |

## 配置

所有配置通过环境变量读取，参见 `.env.example`。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WORD_AI_STORAGE_PATH` | `./data/attachments` | 附件存储路径 |
| `WORD_AI_MAX_FILE_SIZE` | `52428800` (50MB) | 单文件大小上限 |
| `WORD_AI_MAX_BATCH` | `20` | 批量上传数量上限 |
| `WORD_AI_CORS_ORIGINS` | `http://localhost:*` | CORS 来源（支持通配符） |
| `WORD_AI_HTTP_PORT` | `3141` | HTTP 服务端口 |
| `WORD_AI_SESSION_SECRET` | (空) | 会话 HMAC 密钥（非本地部署需设置） |
| `WORD_AI_SHELL_TIMEOUT` | `30000` | Shell 命令超时（ms） |
| `WORD_AI_SESSION_TTL` | `604800` (7天) | 会话 TTL（秒） |

## 测试

```bash
npm run test:unit        # 单元测试（285 个）
npm run test:integration # 集成测试（14 个）
npm run test:e2e         # 端到端测试（42 个）
npm run test:all         # 全量测试（341 个）
npm run lint             # ESLint 检查
npm run typecheck        # TypeScript 类型检查
```

## CI/CD

GitHub Actions 管道（`.github/workflows/ci.yml`）在推送和 PR 时自动触发：

- **Type Check & Lint** — Ubuntu
- **Unit Tests** — Ubuntu + Windows（跨平台验证）
- **Integration Tests** — Ubuntu
- **E2E Tests** — Ubuntu + Windows
- **Full Suite** — 全量测试门禁

## 项目里程碑

| 阶段 | 状态 | 核心交付 |
|------|------|----------|
| Phase 0 | ✅ | 架构验证、demo 扩展、sessionId 隔离 |
| Phase 1 | ✅ | 附件 CRUD API、文件系统持久化、安全加固 |
| Phase 2 | ✅ | 计算器、网页抓取、文件编辑、技能写入工具 |
| Phase 3 | ✅ | PathResolver 跨平台修复、CORS 通配符、ESLint、会话安全 |
| Phase 4 | ✅ | Shell 沙箱、E2E 测试、CI/CD 管道 |
| Phase 5 | ✅ | 性能基线、审计日志、数据保留、README、RC 版本 |

## 技术栈

- **Runtime**: Node.js 20+, TypeScript 5.3+
- **Framework**: @earendil-works/pi-coding-agent
- **HTTP**: Express 4 + Multer + CORS + express-rate-limit
- **Validation**: TypeBox
- **Testing**: Node.js built-in test runner (`node:test`)
- **Linting**: ESLint 9 (Flat Config) + typescript-eslint

## 许可证

MIT
