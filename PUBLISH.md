# Publishing `@qint/node`

This package is **not yet published to npm**. The repository is installable from
git today:

```bash
npm i github:SwizzX-GmbH/qint-node
```

The steps below publish the canonical package `@qint/node` to the npm registry.
They require an npm account that is a member of the **`@qint`** organization/scope
and hold the publish token — kept by the package owner, not baked into this repo
or CI.

## Prerequisites

- Node.js 18+ and npm 10+.
- Membership in the `@qint` npm scope with publish rights.
- A clean checkout of the tag you intend to publish (e.g. `v0.2.0`).

## One-time setup

1. Create (or claim) the `@qint` organization on npm: <https://www.npmjs.com/org/create>.
2. Log in locally:
   ```bash
   npm login
   npm whoami   # confirm the expected account
   ```
   For CI, create an **automation** access token and store it as the
   `NPM_TOKEN` secret; the token is never committed.

## Publish

From the repo root, on the tagged commit:

```bash
# 1. Install dev dependencies.
npm ci

# 2. Verify the release is green.
npm run typecheck
npm test

# 3. Build the distributable (ESM + CJS + .d.ts).
#    `prepublishOnly` also runs this automatically on publish.
npm run build

# 4. Inspect exactly what will be shipped — no source, no tests, just dist/.
npm pack --dry-run

# 5. Publish the public scoped package.
#    `publishConfig.access` is already "public" in package.json.
npm publish
```

`npm publish` reads `version` from `package.json` (currently `0.2.0`). The
`files` allowlist ships only `dist/`, `README.md`, and `LICENSE`.

## Releasing a new version

1. Bump the version and create the git tag in one step:
   ```bash
   npm version patch   # or minor / major
   git push --follow-tags
   ```
2. Re-run the **Publish** steps above.
3. Optionally create a GitHub release for the new tag.

## Publishing via CI (optional)

To publish automatically when a `v*` tag is pushed, add a workflow that runs on
tag pushes with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    registry-url: https://registry.npmjs.org
- run: npm ci
- run: npm test
- run: npm publish
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Notes

- The package name `@qint/node` is a **scoped** package; the first publish must
  use `--access public` (already configured via `publishConfig.access`).
- Do not commit npm tokens. Use `npm login` locally or the `NPM_TOKEN` CI secret.
