import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CalculatorTool } from "../../src/tools/CalculatorTool.js";

/**
 * Asserts that two numbers are approximately equal (for floating-point safety).
 */
function assertApprox(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `Expected ${actual} to approximately equal ${expected} (within ${epsilon})`,
  );
}

describe("CalculatorTool", () => {
  const tool = new CalculatorTool();

  // ==========================================================================
  // 成功求值
  // ==========================================================================
  describe("成功求值", () => {
    it("返回完整结果对象 (ok, result, resultText, normalizedExpression, durationMs)", () => {
      const res = tool.evalExpression("1+2");
      assert.equal(res.ok, true);
      if (!res.ok) return; // type narrowing
      assert.equal(res.result, 3);
      assert.equal(res.resultText, "3");
      assert.equal(res.normalizedExpression, "1 + 2");
      assert.equal(typeof res.durationMs, "number");
    });

    it("复杂表达式 1,234.56 - 200.00 * 3 = 634.56", () => {
      const res = tool.evalExpression("1,234.56 - 200.00 * 3");
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assertApprox(res.result, 634.56);
    });

    it("会计负数 (100.00) + 200 = 100", () => {
      const res = tool.evalExpression("(100.00) + 200");
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.result, 100);
    });

    it("带万单位 100万 * 2 = 2000000", () => {
      const res = tool.evalExpression("100万 * 2");
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.result, 2000000);
      assert.equal(res.resultText, "2000000");
    });

    it("带百分号 1000 * 5% = 50", () => {
      const res = tool.evalExpression("1000 * 5%");
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assertApprox(res.result, 50);
    });
  });

  // ==========================================================================
  // 失败求值
  // ==========================================================================
  describe("失败求值", () => {
    it("除以零返回 ok=false 且 error 包含 'zero'", () => {
      const res = tool.evalExpression("1/0");
      assert.equal(res.ok, false);
      if (res.ok) return; // type narrowing
      assert.match(res.error.toLowerCase(), /zero/);
    });

    it("空表达式返回 ok=false", () => {
      const res = tool.evalExpression("");
      assert.equal(res.ok, false);
    });

    it("不支持的字符返回 ok=false", () => {
      const res = tool.evalExpression("1=2");
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.match(res.error, /unsupported character/i);
    });
  });

  // ==========================================================================
  // 字段验证
  // ==========================================================================
  describe("字段验证", () => {
    it("durationMs 为非负数", () => {
      const res = tool.evalExpression("1+2");
      if (!res.ok) return;
      assert.ok(res.durationMs >= 0);
    });

    it("expression 字段等于输入", () => {
      const input = "1,234.56 + 100";
      const res = tool.evalExpression(input);
      assert.equal(res.expression, input);
    });

    it("resultText 为格式化字符串", () => {
      const res = tool.evalExpression("10/4");
      if (!res.ok) return;
      assert.equal(typeof res.resultText, "string");
      assert.equal(res.resultText, "2.5");
    });

    it("normalizedExpression 字段正确", () => {
      const res = tool.evalExpression("50%");
      if (!res.ok) return;
      assert.equal(res.normalizedExpression, "0.5");
    });
  });
});
