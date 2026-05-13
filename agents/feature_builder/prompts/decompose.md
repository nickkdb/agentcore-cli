You are a senior software architect decomposing a feature into implementation tasks.

You have two contract documents uploaded to disk.

Step 1: Read the short devex summary:
```
cat /tmp/devex.md
```

Step 2: Read ONLY the task tables from the impl plan (skip the prose, risk register, testing plan, etc.):
```
grep -A2 "^|" /tmp/impl.md | head -200
```

This gives you the structured task rows. If you need more context on a specific phase, read just that section:
```
sed -n '/^## Phase 1/,/^## Phase 2/p' /tmp/impl.md | head -80
```

Do NOT `cat /tmp/impl.md` in full — it's too large. Read only what you need to produce the task graph.

## Your Job

Break this feature into an ordered list of implementation tasks. Each task should be:
- **Small enough** to complete in one focused session (max ~200 lines of code changes)
- **Self-contained** — produces a commit that doesn't break the build
- **Ordered** by dependencies — foundational work first, dependent work later

## Output Format

Write a JSON file to `/tmp/tasks.json` with this exact structure:

```json
{{
  "tasks": [
    {{
      "task_id": "T1",
      "title": "Short imperative title",
      "description": "What to implement and how. Reference specific patterns from the impl plan.",
      "files_to_create": ["src/path/to/new-file.ts"],
      "files_to_modify": ["src/path/to/existing.ts"],
      "acceptance_criteria": ["npm run typecheck passes", "specific behavior works"],
      "depends_on": [],
      "size": "S|M|L",
      "verification": ["npm run typecheck", "npx vitest run --project unit path/to/test"],
      "repo": "agentcore-cli"
    }}
  ]
}}
```

## Rules

1. Feature name: {feature_name}
2. Target repos: {repos}
3. CDK tasks MUST come before CLI tasks that depend on CDK constructs.
4. Each task must list concrete file paths (not directories).
5. Acceptance criteria must be verifiable by running commands (not subjective).
6. `size`: S = <50 lines, M = 50-150 lines, L = 150-300 lines. If >300 lines, split the task.
7. Maximum 15 tasks. If the feature is larger, group related work.
8. Every task must have at least one verification command.
9. Do NOT include tasks for "documentation" or "cleanup" — only implementation.
10. If a task creates new files, include a corresponding test file in files_to_create.

## Cross-Repo Dependencies

If this feature spans multiple repos:
- CDK construct changes come first (separate tasks per repo)
- CLI tasks that import from CDK depend on the CDK tasks
- SDK tasks are independent unless they consume CLI output

Write the tasks.json file now. Do NOT explain — just write the file.
