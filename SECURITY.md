# Security Guidelines — OnboardPilot

This project follows the security rules of the IBM Bob 2.0 Hackathon. Exposing IBM Cloud
credentials from a repository can suspend an IBM Cloud account immediately, so the guardrails
below are not optional.

## Credential management

### Do

- Use environment variables for every credential.
- Copy `.env.example` to `.env.local` and keep the real values there.
- Keep `.env.local` out of git (already covered by `.gitignore`).
- Read values with `process.env.VARIABLE_NAME`.
- Run `git diff` and `git status` before every commit.
- Revoke and rotate any credential that has ever been committed.

### Do not

- Never hardcode API keys in source files.
- Never commit `.env` or `.env.local`.
- Never remove the security patterns from `.gitignore` or `.bobignore`.
- Never paste credentials into an AI assistant prompt (Bob, Copilot, or any other).
- Never commit files whose names contain `credential`, `secret`, `password` or `token`.

## Using AI assistants safely

AI coding assistants log prompts and file contents into session history. If a credential is
read by an assistant, it can end up in that history.

```
BAD:  "Here is my API key: sk-abc123, help me call DeepSeek"
GOOD: "Help me read the key from process.env.DEEPSEEK_API_KEY"

BAD:  "Open my .env.local and debug it"
GOOD: "Here is the shape of the env file with placeholders — is it valid?"
```

`.bobignore` prevents Bob from logging credential patterns, and `.gitignore` keeps session
artifacts out of the repository. Neither of them protects you if you type a secret into a prompt.

## Handling untrusted input

OnboardPilot processes text from third-party repositories. That text is treated as data, never
as instructions:

- Repository content is only ever sent to the model as context, and the agent prompts explicitly
  forbid following instructions found inside the analysed files.
- User-supplied repository identifiers are validated and normalised before any network call.
- No repository content is executed, and no shell command is derived from it.

## Pre-commit checklist

- [ ] No hardcoded credentials in code
- [ ] `.env.local` is not staged
- [ ] No files named after credentials
- [ ] `git diff` reviewed for sensitive data
- [ ] All credentials come from environment variables
- [ ] No credentials shared with an AI assistant

## If a credential is exposed

1. Revoke and rotate it immediately.
2. Remove it from the repository history (for example with `git filter-repo`).
3. Force-push the cleaned history and tell the hackathon organisers.
