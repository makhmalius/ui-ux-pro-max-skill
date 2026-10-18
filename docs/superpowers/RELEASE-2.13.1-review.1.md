# Build 2.13.1-review.1

Review build of the whole-project remediation (superpowers workflow). It is **not** published to npm and not merged to `main`.

- Base: `834ffd7` (what `main` had when the review started)
- Build commit: `2a8451a` on branch `claude/monthly-partnerships-dashboard-31bpa0`
- Requirements: `docs/superpowers/specs/2026-10-18-project-review-findings.md`
- Plan: `docs/superpowers/plans/2026-10-18-project-review-remediation.md`

A local git tag `v2.13.1-review.1` was created at the build commit, but pushing tags to the remote was refused (HTTP 403) from the cloud session. To publish the tag, create it on GitHub at commit `2a8451a`, or run `git tag v2.13.1-review.1 2a8451a && git push origin v2.13.1-review.1` from a machine with permission.

Try the packaged CLI without installing anything globally:

```bash
npx --yes --package=./ui-ux-pro-max-cli-2.13.1-review.1.tgz uipro init --ai claude
```
