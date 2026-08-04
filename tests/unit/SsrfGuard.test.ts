import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePublicIpAddress, isRedirect } from "../../src/tools/SsrfGuard.js";

describe("validatePublicIpAddress", () => {
  it("拒绝回环地址 127.0.0.1", () => {
    assert.throws(
      () => validatePublicIpAddress("127.0.0.1"),
      /Loopback/,
    );
  });

  it("拒绝私有地址 10.0.0.1（10.0.0.0/8）", () => {
    assert.throws(
      () => validatePublicIpAddress("10.0.0.1"),
      /10\.0\.0\.0\/8/,
    );
  });

  it("拒绝私有地址 192.168.1.1（192.168.0.0/16）", () => {
    assert.throws(
      () => validatePublicIpAddress("192.168.1.1"),
      /192\.168\.0\.0\/16/,
    );
  });

  it("拒绝私有地址 172.16.0.1（172.16.0.0/12）", () => {
    assert.throws(
      () => validatePublicIpAddress("172.16.0.1"),
      /172\.16\.0\.0\/12/,
    );
  });

  it("拒绝链路本地地址 169.254.1.1", () => {
    assert.throws(
      () => validatePublicIpAddress("169.254.1.1"),
      /Link-local/,
    );
  });

  it("拒绝 0.0.0.0（0.0.0.0/8）", () => {
    assert.throws(
      () => validatePublicIpAddress("0.0.0.0"),
      /0\.0\.0\.0\/8/,
    );
  });

  it("拒绝组播地址 224.0.0.1", () => {
    assert.throws(
      () => validatePublicIpAddress("224.0.0.1"),
      /Multicast/,
    );
  });

  it("接受公网 IP 8.8.8.8", () => {
    validatePublicIpAddress("8.8.8.8");
    // 不抛出异常即通过
  });

  it("接受公网 IP 1.1.1.1", () => {
    validatePublicIpAddress("1.1.1.1");
    // 不抛出异常即通过
  });

  it("拒绝 IPv6 回环地址 ::1", () => {
    assert.throws(
      () => validatePublicIpAddress("::1"),
      /Loopback/,
    );
  });
});

describe("isRedirect", () => {
  it("301 返回 true", () => {
    assert.equal(isRedirect(301), true);
  });

  it("302 返回 true", () => {
    assert.equal(isRedirect(302), true);
  });

  it("200 返回 false", () => {
    assert.equal(isRedirect(200), false);
  });

  it("404 返回 false", () => {
    assert.equal(isRedirect(404), false);
  });

  it("399 返回 true", () => {
    assert.equal(isRedirect(399), true);
  });

  it("300 返回 true", () => {
    assert.equal(isRedirect(300), true);
  });
});
