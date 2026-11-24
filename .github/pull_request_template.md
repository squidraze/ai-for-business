## What and why

<!-- What changes and why. Link the task if there is one. -->

## How to check

<!-- Steps to verify: commands, screens, chat prompts. -->

## Checklist

- [ ] Title follows Conventional Commits (`feat(scope): ...`), see `docs/git/commits.md`
- [ ] Integration code stays in its own module (`integrations/<name>/`), see `CLAUDE.md`
- [ ] Every AI action that sends or changes something goes through user confirmation
- [ ] New screens work in light and dark themes; UI texts go through translations
- [ ] No secrets, `.env`, databases or sessions in the diff
