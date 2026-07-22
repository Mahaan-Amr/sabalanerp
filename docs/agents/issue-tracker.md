# Issue tracker: GitHub

Issues and specifications for this repository live as GitHub Issues. Use the `gh` CLI for all operations.

## Conventions

- Create an issue with `gh issue create --title "..." --body-file <file>`.
- Read an issue and its discussion with `gh issue view <number> --comments`.
- List work with `gh issue list`, including appropriate state and label filters.
- Comment with `gh issue comment <number> --body "..."`.
- Apply or remove labels with `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close completed work with `gh issue close <number> --comment "..."`.
- Infer the repository from the current clone and its GitHub remote.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Publishing and fetching

- When a skill says “publish to the issue tracker,” create a GitHub Issue.
- When a skill says “fetch the relevant ticket,” run `gh issue view <number> --comments`.

## Dependencies

Prefer GitHub's native issue dependencies. If the repository does not support them, put a `Blocked by: #<number>` line near the top of the dependent issue body.
