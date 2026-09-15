# Registry Client SDK issue-routing entry

Registry-owned consumer failures found in `Simple-Connection/SC_Linked_App` are reported to `Simple-Connection/sctool-registry` Issues.

Consumer-side report entrypoint:

```text
npm run registry:sdk:report -- --kind <KIND> --summary "<SUMMARY>" [--severity <SEVERITY>] [--command "<COMMAND>"] [--log "<PATH>"]
```

The reporter must not automatically upload log contents.

GitHub Issues are the source of truth. `.github/registry-sdk-issue-queue.json` is only the active-version projection.

A `dev/<semver>` branch is route-active only when its docs index names that branch, the version is non-terminal, and the branch contains work not merged to `main`.

Exactly one route-active branch may receive the tracked queue. Zero active branches leaves the issue for the next approved version. Multiple active branches fail closed.

Queue presence is not implementation approval. Coding agents still follow version/session/responsibility/PTSIP approval rules.
