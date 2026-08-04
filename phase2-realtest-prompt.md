You are testing the Word AI Phase 2 tools extension. You MUST call each tool listed below using the tool_call mechanism. Do NOT just describe what you would do — actually call each tool.

Step 1: Call calc_eval_expression with expression "1,234.56 - 200.00 * 3"
Step 2: Call calc_eval_expression with expression "(100万 + 50万) * 2%"
Step 3: Call file_edit with operation "write", path "phase2-test-output.txt", content "Line 1: Hello from Phase 2 real test!\nLine 2: Calculator works.\nLine 3: File edit works.\nLine 4: End of file.\n"
Step 4: Call file_edit with operation "replace", path "phase2-test-output.txt", oldString "Line 3: File edit works.", newString "Line 3: File edit CONFIRMED in real session."
Step 5: Call file_edit with operation "replace_lines", path "phase2-test-output.txt", startLine 4, endLine 4, content "Line 4: Updated via replace_lines.\nLine 5: Appended by real test.\n"
Step 6: Call skill_write with operation "write", path "realtest-skill/SKILL.md", content "# Real Test Skill\n\nThis skill was created during Phase 2 real-world testing.\n"
Step 7: Call skill_write with operation "append", path "realtest-skill/SKILL.md", content "\n## Verification\n\nAll tools tested successfully.\n"
Step 8: Call web_fetch with url "https://httpbin.org/get" and maxChars 2000

After calling all tools, provide a summary table showing each tool call and whether it succeeded or failed.
