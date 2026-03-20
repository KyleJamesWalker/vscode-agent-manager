# Release Pipeline Design — Claude Agent Manager

## Goal

Automate versioning, GitHub release creation, and VS Code Marketplace publishing so that merging a labeled PR is the only manual step required to ship a new version of the extension.

## Trigger Model

PR merge to `main` with one of three labels (`major`, `minor`, `patch`) triggers the pipeline. No label → no release. This gives the author explicit control: every merge is a deliberate bump or a silent no-op.

## Two-Workflow Chain

### Workflow 1: `release.yml`

Fires on: `pull_request` event with `types: [closed]`.

Job condition (filters to labeled merges only):
```
if: github.event.pull_request.merged == true &&
    (contains(github.event.pull_request.labels.*.name, 'major') ||
     contains(github.event.pull_request.labels.*.name, 'minor') ||
     contains(github.event.pull_request.labels.*.name, 'patch'))
```

Required permissions:
```yaml
permissions:
  contents: write
```

Steps:
1. Checkout `main` with `fetch-depth: 0` (needed for tagging)
2. Configure git author for the version-bump commit
3. Determine bump type from PR labels
4. Run `npm version <type> --no-git-tag-version` to update `package.json`
5. Commit the version bump to `main` (`chore: bump version to X.Y.Z [skip ci]`)
6. Push commit using `GITHUB_TOKEN` (requires repo to allow Actions to push to main — see HOW_TO_RELEASE.md for branch protection setup)
7. Create and push a git tag (`vX.Y.Z`)
8. Create a GitHub release from the tag using `gh release create --generate-notes` (GitHub auto-generates release notes from merged PR titles since last tag)

### Workflow 2: `publish.yml`

Fires on: `release: types: [published]`.

Required permissions:
```yaml
permissions:
  contents: write
```

Steps:
1. Checkout the release tag
2. `npm ci` (reproducible install from lockfile)
3. `npx @vscode/vsce package` → produces `vscode-cc-agent-manager-X.Y.Z.vsix`
4. Upload VSIX as GitHub release asset (done first so artifact is always available on failure)
5. `npx @vscode/vsce publish` using `VSCE_PAT` secret

## Files Created/Modified

| File | Action | Notes |
|---|---|---|
| `LICENSE` | Create | MIT, copyright Kyle James Walker |
| `.github/workflows/release.yml` | Create | Version bump + GitHub release |
| `.github/workflows/publish.yml` | Create | Marketplace publish |
| `.vscodeignore` | Update | Add `docs/`, `.github/`, `out/test/`, `tsconfig.json`, `jest.config.js`, `package-lock.json` |
| `.gitignore` | Update | Add `HOW_TO_RELEASE.md` |
| `package.json` | Update | Publisher `kyle-walker` → `KyleJamesWalker`; add `@vscode/vsce` to devDependencies |
| `HOW_TO_RELEASE.md` | Create (gitignored) | Manual one-time setup steps |

## Secrets Required

- `VSCE_PAT` — Azure DevOps PAT scoped to Marketplace (Manage), stored as a GitHub Actions repository secret. The PAT must be issued from the Azure DevOps organization linked to the `KyleJamesWalker` publisher account.

## Publisher Note

The publisher is being changed from `kyle-walker` to `KyleJamesWalker` to match the new marketplace account. Since no extension has been published under `kyle-walker` yet, this is a clean rename with no marketplace history to preserve.

## `.vscodeignore` Strategy

Current file excludes `src/`, `node_modules/`, `.vscode/`, map files, and TS sources. Additions needed:
- `docs/**` — design docs, not needed in extension
- `.github/**` — CI workflows
- `out/test/**` — compiled test output
- `tsconfig.json`, `jest.config.js`, `package-lock.json` — build/dev config

Keep: `out/**` (excluding `out/test/`), `media/`, `LICENSE`, `README.md` (README.md is already present and required by marketplace).

## Version Starting Point

Current version is `0.0.0`. First release via pipeline will bump to `0.0.1` (patch), `0.1.0` (minor), or `1.0.0` (major) depending on label applied.
