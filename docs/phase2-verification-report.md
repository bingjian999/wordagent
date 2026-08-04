# Phase 2 验证报告

## 概述

Phase 2 实现了通用工具层，包括算术表达式求值、网页抓取、文件编辑和技能文件写入四个工具，以及完整的共享工具基础设施。所有工具从 C# CPAHelper Agent Runtime 移植为 TypeScript ESM 模块。

## 交付物

### 共享工具层 (`src/tools/`)

| 文件 | 功能 | 移植来源 |
|------|------|----------|
| `LineDocument.ts` | 基于行的文本文档模型，支持 LF/CRLF/CR 换行检测与保留 | `GenericFileEditToolProvider.LineDocument` |
| `PathResolver.ts` | 路径解析与验证，拒绝无效字符、驱动器相对路径、目录路径 | `GenericFileEditToolProvider` 路径逻辑 |
| `ExpressionEvaluator.ts` | 算术表达式求值器，支持全角字符、会计负数、单位后缀、百分号 | `CalculatorExpressionEvaluator` |
| `SsrfGuard.ts` | SSRF 防护，验证 URL 公开性，阻止私有/回环/链路本地地址 | `WebFetchToolProvider` SSRF 逻辑 |
| `HtmlCleaner.ts` | HTML 清洗，移除脚本/样式/注释，提取标题，归一化空白 | `WebFetchToolProvider` HTML 清洗逻辑 |

### 工具服务 (`src/tools/`)

| 文件 | 工具名 | 功能 |
|------|--------|------|
| `CalculatorTool.ts` | `calc_eval_expression` | 算术表达式求值，返回结果和归一化表达式 |
| `WebFetchTool.ts` | `web_fetch` | 抓取公开网页，SSRF 防护 + HTML 清洗 + 速率限制 + 重定向处理 |
| `FileEditTool.ts` | `file_edit` | 文件编辑：write/append/replace/replace_lines/delete |
| `SkillWriteTool.ts` | `skill_write` | 沙箱内文件编辑，仅允许 write/append/replace_lines |

### 扩展注册 (`extensions/tools/index.ts`)

注册 4 个 Pi Agent 工具：
- `calc_eval_expression` — 算术表达式求值
- `web_fetch` — 网页抓取
- `file_edit` — 文件编辑（高风险）
- `skill_write` — 沙箱内文件编辑

### package.json 更新

在 `pi.extensions` 中添加 `./extensions/tools/index.ts`。

### 测试文件 (`tests/unit/`)

| 文件 | 测试数 |
|------|--------|
| `ExpressionEvaluator.test.ts` | 48 |
| `CalculatorTool.test.ts` | 12 |
| `LineDocument.test.ts` | 16 |
| `PathResolver.test.ts` | 17 |
| `HtmlCleaner.test.ts` | 17 |
| `SsrfGuard.test.ts` | 16 |
| `FileEditTool.test.ts` | 24 |
| `SkillWriteTool.test.ts` | 12 |
| **Phase 2 小计** | **162** |

## 测试结果

```
TypeScript 类型检查：✅ 通过（tsc --noEmit 零错误）

单元测试：
# tests 234
# suites 79
# pass 234
# fail 0

集成测试：
# tests 14
# suites 3
# pass 14
# fail 0

总计：248 tests, 248 pass, 0 fail
```

## 功能特性

### calc_eval_expression
- 四则运算（+、-、*、/）与括号嵌套
- 运算符优先级（先乘除后加减）
- 千分位分隔符（1,234.56）
- 全角字符归一化（０-９、，．（）＋－×÷％）
- 会计负数表示（(123.45) → -123.45）
- 单位后缀（万元×10000、千元×1000、元忽略）
- 百分号后缀（50% → 0.5）
- 货币符号忽略（¥ ￥）
- Dash 字符视为零（– —）
- 表达式长度限制（8000 字符）和 token 数限制（1000）

### web_fetch
- SSRF 防护：阻止 localhost、私有 IP、链路本地、组播地址
- 端口限制：仅允许 80/443/默认端口
- DNS 解析验证：域名解析后验证所有 IP 地址
- 手动重定向处理（最多 5 次，每次验证目标 URL）
- 响应体大小限制（默认 2MB）
- 速率限制（请求间隔至少 1 秒）
- 403/429 重试：先访问首页获取 Cookie
- HTML 清洗：移除脚本/样式/注释，提取标题，归一化空白
- 字符编码自动检测（从 Content-Type 提取 charset）
- 超时控制（默认 15 秒）

### file_edit
- write：创建/覆盖文件，支持 overwrite 和 createParents 选项
- append：追加内容到文件末尾
- replace：查找替换文本，支持 replaceAll
- replace_lines：替换指定行范围（1-based）
- delete：删除文件
- 路径验证：拒绝无效字符、驱动器相对路径、目录路径
- UTF-8 无 BOM 编码

### skill_write
- 沙箱限制：所有操作限制在 skills 目录内
- 路径遍历防护：拒绝 `../../` 等路径逃逸
- 操作限制：仅允许 write/append/replace_lines（无 delete/replace）
- 绝对路径拒绝：只接受相对路径
- 自动创建父目录

## 架构设计

```
extensions/tools/index.ts          ← Pi Agent 工具注册
    ↓
src/tools/
    CalculatorTool.ts              ← 计算器工具服务
    WebFetchTool.ts                ← 网页抓取工具服务
    FileEditTool.ts                ← 文件编辑工具服务
    SkillWriteTool.ts              ← 技能写入工具服务（沙箱）
    ↓
src/tools/
    ExpressionEvaluator.ts         ← 表达式求值器（纯逻辑）
    LineDocument.ts                ← 行文档模型（纯逻辑）
    PathResolver.ts                ← 路径解析器（纯逻辑）
    SsrfGuard.ts                   ← SSRF 防护（纯逻辑）
    HtmlCleaner.ts                 ← HTML 清洗（纯逻辑）
```

共享工具层为纯逻辑模块，无副作用，易于测试。工具服务层封装共享工具，提供结构化输入输出。扩展层负责 Pi Agent 工具注册和生命周期管理。
