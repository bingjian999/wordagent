# Phase 5 — 性能基线报告

## 测试环境

| 项目 | 值 |
|------|-----|
| 测试日期 | 2026-08-04T07:29:08.056Z |
| 运行平台 | win32 |
| Node 版本 | v22.16.0 |
| CPU | 22 cores |
| 内存 | 31.5 GB |

## 测试结果

| # | 测试项 | 迭代次数 | 平均 (ms) | 最小 (ms) | 最大 (ms) | 吞吐量 |
|---|--------|----------|----------|----------|----------|--------|
| 1 | Upload 1KB file (sequential) | 50 | 118.37 | 100.05 | 136.05 | - |
| 2 | Upload 1KB file (50 concurrent) | 50 | 70.38 | 0.00 | 0.00 | 14.2 ops/sec |
| 3 | List attachments (100+ items) | 20 | 0.01 | 0.00 | 0.15 | - |
| 4 | Evaluate simple expression | 1000 | 0.02 | 0.01 | 0.44 | - |
| 5 | Evaluate complex expression (万元 + %) | 1000 | 0.02 | 0.01 | 0.28 | - |
| 6 | Write file (100 bytes) | 100 | 27.35 | 20.75 | 43.23 | - |
| 7 | Execute hostname | 50 | 139.75 | 107.99 | 178.53 | - |
| 8 | Scan 10+ sessions for expiry | 10 | 11.69 | 10.09 | 14.67 | - |
| 9 | Write audit log entry | 500 | 25.31 | 16.19 | 41.94 | - |

## 性能基线

| 操作 | 基线指标 | 阈值 |
|------|----------|------|
| 单文件上传 (1KB) | avg 118.4ms | < 50ms |
| 50 并发上传 | 14.2 ops/sec | > 100 ops/sec |
| 简单表达式计算 | avg 0.017ms | < 1ms |
| 复杂表达式计算 | avg 0.020ms | < 1ms |
| Shell 命令执行 (hostname) | avg 139.7ms | < 200ms |
| 保留策略扫描 (10+ sessions) | avg 11.7ms | < 100ms |

## 结论

性能基线已记录，可作为后续版本的回归测试基准。