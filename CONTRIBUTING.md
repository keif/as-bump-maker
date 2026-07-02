# Contributing

## Local development

Edit `index.html`, `app.js`, or `style.css` and rebuild the container:

```sh
docker compose up -d --build
# → http://localhost:8080
```

For a tighter loop, bind-mount the sources instead of rebuilding — see the [Development section in the README](README.md#development).

## Opening a PR

1. Create a topic branch off `main`.
2. Make your changes.
3. Verify the container builds and serves locally (`docker compose up -d --build && curl -I http://localhost:8080`).
4. Push the branch and open a PR against `main`.
5. Wait for the **Docker** build check to go green.
6. Run the Codex review gate locally (see below).
7. Merge via **Squash and merge** when both checks are satisfied.

Direct pushes to `main` are blocked by branch protection.

## The Codex review gate (local-only, mandatory)

Before merging any PR — including your own — run an independent Codex review on the branch's diff:

```sh
gh pr checkout <PR#>   # or just be on the PR's branch
/codex review
```

### Why it isn't in CI

Codex review runs **locally** on purpose. Making it a GitHub Action would:

- **Cost tokens per PR**, including on drafts, force-pushes, and rebases.
- **Leak source code** through Actions logs and third-party API request bodies.
- **Obscure the human-in-the-loop judgement** the gate exists to encode — an automated pass/fail turns a nuanced review into a box-tick.

The gate is a policy, not a pipeline. If you find yourself wanting to automate it, revisit those three reasons first.

### How to act on findings

| Finding severity | Rule                                                        |
| ---------------- | ----------------------------------------------------------- |
| `[P1]`           | **Do not merge.** Fix, push, re-run the gate.               |
| `[P2]`           | Advisory. Address if easy; document in the PR if you skip.  |
| No findings      | Merge freely (once CI is green).                            |

### Exceptions

The gate may be skipped for:

- Dependency bumps (Dependabot, `nginx` base image version bumps).
- Docs-only changes (`*.md`, comments).
- Hotfixes with explicit time pressure.

If you skip, tick the exception in the PR checklist and state the reason in the description.

## Commit style

Present-tense, imperative, short subject line. Body optional; wrap at 72 columns when present. No AI attribution or Co-Authored-By trailers — see the repo owner's `~/.claude/CLAUDE.md` if you're using an AI-assisted workflow.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
