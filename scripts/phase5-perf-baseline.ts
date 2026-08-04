/**
 * Phase 5 — Performance Baseline Test
 *
 * Measures key performance metrics for the WordAgent system.
 * Run from the project root: npx tsx scripts/phase5-perf-baseline.ts
 *
 * Results are written to docs/phase5-perf-baseline.md
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { performance } from "node:perf_hooks";
import { AttachmentService } from "../src/services/attachment/AttachmentService.js";
import { FsAttachmentRepository } from "../src/infrastructure/fs/FsAttachmentRepository.js";
import { FileIntelligenceService } from "../src/services/parser/FileIntelligenceService.js";
import { AuditLogger } from "../src/services/audit/AuditLogger.js";
import { RetentionPolicy } from "../src/services/retention/RetentionPolicy.js";
import { CalculatorTool } from "../src/tools/CalculatorTool.js";
import { FileEditTool } from "../src/tools/FileEditTool.js";
import { ShellTool } from "../src/tools/ShellTool.js";
import type { AppConfig } from "../src/config/index.js";

// ================================================================
// Helpers
// ================================================================

interface BenchResult {
  name: string;
  iterations: number;
  totalTimeMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  throughput?: string;
}

const results: BenchResult[] = [];

async function bench(name: string, iterations: number, fn: () => Promise<void>): Promise<void> {
  const times: number[] = [];
  await fn(); // warmup
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  const totalTimeMs = times.reduce((a, b) => a + b, 0);
  results.push({
    name, iterations, totalTimeMs,
    avgMs: totalTimeMs / iterations,
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
  });
  console.log(`  ${name}: avg=${(totalTimeMs / iterations).toFixed(2)}ms`);
}

async function benchConcurrent(name: string, concurrency: number, fn: () => Promise<void>): Promise<void> {
  const start = performance.now();
  const promises: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) promises.push(fn());
  await Promise.all(promises);
  const totalTimeMs = performance.now() - start;
  const throughput = `${(concurrency / (totalTimeMs / 1000)).toFixed(1)} ops/sec`;
  results.push({ name, iterations: concurrency, totalTimeMs, avgMs: totalTimeMs / concurrency, minMs: 0, maxMs: 0, throughput });
  console.log(`  ${name}: ${concurrency} ops in ${totalTimeMs.toFixed(0)}ms (${throughput})`);
}

// ================================================================
// Main
// ================================================================

async function main() {
  console.log("=".repeat(70));
  console.log("  Phase 5 — Performance Baseline");
  console.log("  Date: " + new Date().toISOString());
  console.log("  Platform: " + process.platform + " / Node " + process.version);
  console.log("=".repeat(70));

  const tempDir = path.join(os.tmpdir(), `word-ai-perf-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const config: AppConfig = {
    storagePath: tempDir,
    maxFileSize: 50 * 1024 * 1024,
    maxBatchSize: 20,
    allowedExtensions: ["txt", "md", "json", "csv", "pdf"],
    rateLimit: { windowMs: 60000, max: 1000 },
    sessionTtl: 7 * 24 * 3600,
    shellTimeout: 30000,
    corsOrigins: ["http://localhost:*"],
    httpPort: 3141,
    sessionSecret: "",
  };

  const repository = new FsAttachmentRepository(tempDir);
  const fileIntel = new FileIntelligenceService();
  const auditLogger = new AuditLogger(tempDir);
  const attachmentService = new AttachmentService(repository, fileIntel, config, auditLogger);
  const retentionPolicy = new RetentionPolicy(tempDir, config.sessionTtl);
  const sessionId = "perf-test-session";
  const testContent = Buffer.from("Hello World — performance test content. ".repeat(10));

  // 1. Sequential upload
  console.log("\n--- 1. Attachment Upload (Sequential) ---");
  await bench("Upload 1KB file (sequential)", 50, async () => {
    await attachmentService.upload(sessionId, { originalName: `perf-${Date.now()}.txt`, content: testContent });
  });

  // 2. Concurrent upload
  console.log("\n--- 2. Attachment Upload (50 Concurrent) ---");
  await benchConcurrent("Upload 1KB file (50 concurrent)", 50, async () => {
    await attachmentService.upload(sessionId, { originalName: `conc-${Date.now()}-${Math.random()}.txt`, content: testContent });
  });

  // 3. List
  console.log("\n--- 3. Attachment List ---");
  await bench("List attachments (100+ items)", 20, async () => {
    await attachmentService.findBySession(sessionId, { page: 1, limit: 50 });
  });

  // 4. Calculator
  console.log("\n--- 4. Calculator Tool ---");
  const calcTool = new CalculatorTool();
  await bench("Evaluate simple expression", 1000, async () => {
    calcTool.evalExpression("1,234.56 + 500.00 - 100.00");
  });
  await bench("Evaluate complex expression (万元 + %)", 1000, async () => {
    calcTool.evalExpression("(150万元 - 120万元) / 120万元 * 100%");
  });

  // 5. File Edit
  console.log("\n--- 5. File Edit Tool ---");
  const fileEditTool = new FileEditTool(tempDir);
  const testFile = `perf-test-${Date.now()}.txt`;
  await bench("Write file (100 bytes)", 100, async () => {
    await fileEditTool.edit({ operation: "write", path: testFile, content: "Line 1\nLine 2\nLine 3\n" });
  });

  // 6. Shell
  console.log("\n--- 6. Shell Tool ---");
  const shellTool = new ShellTool(tempDir);
  await bench("Execute hostname", 50, async () => {
    await shellTool.execute("hostname", []);
  });

  // 7. Retention scan
  console.log("\n--- 7. Retention Policy Scan ---");
  for (let i = 0; i < 10; i++) {
    await attachmentService.upload(`scan-${i}`, { originalName: `s${i}.txt`, content: testContent });
  }
  await bench("Scan 10+ sessions for expiry", 10, async () => {
    await retentionPolicy.run();
  });

  // 8. Audit Logger
  console.log("\n--- 8. Audit Logger ---");
  await bench("Write audit log entry", 500, async () => {
    await auditLogger.logDelete(sessionId, `att-${Date.now()}`, "test.txt");
  });

  // Cleanup
  await new Promise((r) => setTimeout(r, 500));
  for (let i = 0; i < 3; i++) {
    try { await fs.rm(tempDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("  Performance Baseline Summary");
  console.log("=".repeat(70));
  console.log("\n| # | Test | Iter | Avg (ms) | Min | Max | Throughput |");
  console.log("|---|------|------|----------|-----|-----|------------|");
  results.forEach((r, i) => {
    console.log(`| ${i + 1} | ${r.name} | ${r.iterations} | ${r.avgMs.toFixed(2)} | ${r.minMs.toFixed(2)} | ${r.maxMs.toFixed(2)} | ${r.throughput ?? "-"} |`);
  });

  // Write report
  const reportPath = path.join("docs", "phase5-perf-baseline.md");
  const report = generateReport(results);
  await fs.writeFile(reportPath, report, "utf-8");
  console.log(`\nReport saved: ${reportPath}`);
}

function generateReport(results: BenchResult[]): string {
  const L: string[] = [];
  L.push("# Phase 5 — 性能基线报告");
  L.push("");
  L.push("## 测试环境");
  L.push("");
  L.push("| 项目 | 值 |");
  L.push("|------|-----|");
  L.push(`| 测试日期 | ${new Date().toISOString()} |`);
  L.push(`| 运行平台 | ${process.platform} |`);
  L.push(`| Node 版本 | ${process.version} |`);
  L.push(`| CPU | ${os.cpus().length} cores |`);
  L.push(`| 内存 | ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB |`);
  L.push("");
  L.push("## 测试结果");
  L.push("");
  L.push("| # | 测试项 | 迭代次数 | 平均 (ms) | 最小 (ms) | 最大 (ms) | 吞吐量 |");
  L.push("|---|--------|----------|----------|----------|----------|--------|");
  results.forEach((r, i) => {
    L.push(`| ${i + 1} | ${r.name} | ${r.iterations} | ${r.avgMs.toFixed(2)} | ${r.minMs.toFixed(2)} | ${r.maxMs.toFixed(2)} | ${r.throughput ?? "-"} |`);
  });
  L.push("");
  L.push("## 性能基线");
  L.push("");
  L.push("| 操作 | 基线指标 | 阈值 |");
  L.push("|------|----------|------|");
  const u = results.find((r) => r.name.includes("sequential"));
  if (u) L.push(`| 单文件上传 (1KB) | avg ${u.avgMs.toFixed(1)}ms | < 50ms |`);
  const uc = results.find((r) => r.name.includes("concurrent"));
  if (uc) L.push(`| 50 并发上传 | ${uc.throughput} | > 100 ops/sec |`);
  const cs = results.find((r) => r.name.includes("simple"));
  if (cs) L.push(`| 简单表达式计算 | avg ${cs.avgMs.toFixed(3)}ms | < 1ms |`);
  const cc = results.find((r) => r.name.includes("complex"));
  if (cc) L.push(`| 复杂表达式计算 | avg ${cc.avgMs.toFixed(3)}ms | < 1ms |`);
  const sh = results.find((r) => r.name.includes("hostname"));
  if (sh) L.push(`| Shell 命令执行 (hostname) | avg ${sh.avgMs.toFixed(1)}ms | < 200ms |`);
  const rt = results.find((r) => r.name.includes("Scan"));
  if (rt) L.push(`| 保留策略扫描 (10+ sessions) | avg ${rt.avgMs.toFixed(1)}ms | < 100ms |`);
  L.push("");
  L.push("## 结论");
  L.push("");
  L.push("性能基线已记录，可作为后续版本的回归测试基准。");
  return L.join("\n");
}

main().catch((err) => { console.error("Performance test failed:", err); process.exit(1); });
