---
name: demo-tools
description: >
  Demo tools for Word AI Phase 0 architecture validation.
  Use when you want to test the extension, say hello, or echo a message.
  Also use to check Phase 0 verification status.
license: MIT
---

# Demo Tools

## Usage

- Use `hello` to verify the Word AI extension is working and services are initialized
- Use `echo` to test parameter passing and streaming response
- Use `phase0_status` to check which architecture validations have passed

## Steps

1. Call `hello` with an optional name parameter to verify extension is operational
2. Call `echo` with a message to test parameter schema and response format
3. Call `phase0_status` to review all verification checks that have been logged

## Verification Points

- Tool registration via `pi.registerTool()` works correctly
- `ctx.sessionManager.getSessionId()` provides session isolation
- Streaming updates via `onUpdate` callback function properly
- Shared service container is accessible from within tool execute functions
- `AbortSignal` is available for cancellation support
