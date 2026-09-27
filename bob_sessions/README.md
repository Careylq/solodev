# bob_sessions — IBM Bob task session summary evidence

This folder is a **required hackathon deliverable**.

The IBM Bob 2.0 Hackathon rules state that the project repository must contain
*"each team member's screenshots of IBM Bob task session summaries for your project"* as evidence
that IBM Bob was used as a core component of the solution.

## How these screenshots were captured

1. In the Bob IDE chat interface, select **Tasks** to display the task list.
2. Select the task that relates to this project. Confirm the correct project workspace is open
   (use **All** if the work spanned multiple workspaces).
3. Select the **task header**. A task session consumption summary is displayed.
4. Capture a screenshot of that summary in **PNG** format.
5. Save it here using the naming convention below.
6. Repeat for every task that contributed to this project.

## Naming convention

```
<team>_task<number>_<short-description>_summary.png
```

Example:

```
solodev_task03_agent_mode_hardening_summary.png
```

## Task index

| Task | File | Workstream |
| --- | --- | --- |
| 01 | `solodev_task01_project_context_init_summary.png` | Repository orientation and hardening plan (Plan mode) |
| 02 | `solodev_task02_code_review_summary.png` | Code review of the context and agent layers |
| 03 | `solodev_task03_agent_mode_hardening_summary.png` | Agent-mode hardening of ranking heuristics and guardrails |
| 04 | `solodev_task04_unit_tests_summary.png` | Unit tests for the pure helpers, generated and executed |
| 05 | `solodev_task05_streaming_api_summary.png` | Streaming API error-path hardening |
| 06 | `solodev_task06_security_audit_summary.png` | Credential and untrusted-input security audit |
| 07 | `solodev_task07_architecture_diagrams_summary.png` | Architecture diagrams generated from the actual source |
| 08 | `solodev_task08_prompt_redteam_summary.png` | Adversarial prompt testing with parallel subagents |
| 09 | `solodev_task09_readme_audit_summary.png` | README claim audit against the source |
| 10 | `solodev_task10_deploy_runbook_summary.png` | Deployment runbook for Vercel |

Each row corresponds to one IBM Bob IDE task. The screenshot proves the task was performed in IBM
Bob IDE and shows its task session consumption summary, including the Bobcoins consumed.

**Account note:** the hackathon-provisioned account invitation never reached our registered mailbox,
so the work was carried out on an IBM Bob free-trial account (30 days, 40+ Bobcoins, as documented at
bob.ibm.com/pricing). The tool, workflow, features used and evidence produced are identical — only the
account the Bobcoins came from differs.

No credentials, API keys or session payloads are stored in this folder — screenshots of the
consumption summary only.
