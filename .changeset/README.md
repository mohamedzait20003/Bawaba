# Changesets

Every pull request that changes a published package adds a changeset: run `pnpm changeset`, choose the packages and the bump, and describe the change for users.

During `0.x`, every package is in one **fixed group** (`bawaba` and `@bawaba/*`), so they always share a version. At `1.0`, the gateway packages move to independent versions.

Releases: merging to `main` makes `release.yml` open a "Version packages" pull request; merging that pull request publishes to npm with provenance.
