# Phase 5 — 性能基线报告

## 测试环境

| 项目 | 值 |
|------|-----|
| 测试日期 | 2026-08-04T08:58:36.816Z |
| 运行平台 | win32 |
| Node 版本 | v22.16.0 |
| CPU | 22 cores |
| 内存 | 31.5 GB |

## 测试结果

| # | 测试项 | 迭代次数 | 平均 (ms) | 最小 (ms) | 最大 (ms) | 吞吐量 |
|---|--------|----------|----------|----------|----------|--------|
| 1 | Upload 1KB file (sequential) | 50 | 131.81 | 110.25 | 154.87 | - |
| 2 | Upload 1KB file (50 concurrent) | 50 | 68.43 | 0.00 | 0.00 | 14.6 ops/sec |
| 3 | List attachments (100+ items) | 20 | 0.01 | 0.00 | 0.10 | - |
| 4 | Evaluate simple expression | 1000 | 0.01 | 0.00 | 0.34 | - |
| 5 | Evaluate complex expression (万元 + %) | 1000 | 0.01 | 0.01 | 0.46 | - |
| 6 | Write file (100 bytes) | 100 | 13.03 | 11.15 | 20.83 | - |
| 7 | Execute hostname | 50 | 98.86 | 75.91 | 169.17 | - |
| 8 | Scan 10+ sessions for expiry | 10 | 5.33 | 4.66 | 5.90 | - |
| 9 | Write audit log entry | 500 | 9.79 | 8.12 | 18.34 | - |

## 性能基线

| 操作 | 基线指标 | 阈值 |
|------|----------|------|
| 单文件上传 (1KB) | avg 131.8ms | < 50ms |
| 50 并发上传 | 14.6 ops/sec | > 100 ops/sec |
| 简单表达式计算 | avg 0.010ms | < 1ms |
| 复杂表达式计算 | avg 0.015ms | < 1ms |
| Shell 命令执行 (hostname) | avg 98.9ms | < 200ms |
| 保留策略扫描 (10+ sessions) | avg 5.3ms | < 100ms |

## 结论

性能基线已记录，可作为后续版本的回归测试基准。