# SCTool Registry Access Contract v1

`registry_access_contract_version: 1.0.0`

This document defines the GitHub identity and authenticated artifact-access boundary that SCTool Registry clients and the SCTool SDK consume.

## 0. Activation status

This contract is **active** under:

```text
docs/REGISTRY_CONTRACT_V2.md
policy/registry-policy.json schemaVersion 2.0.0
```

`docs/REGISTRY_CONTRACT_V1.md` and `schemas/policy-v1.schema.json` are retained as historical v1 references for the earlier anonymous-download model.

The v2 activation is an intentional breaking policy change; the meaning of Registry Contract v1 is not changed in place.

## 1. Scope

This contract answers only:

```text
Which GitHub identity is the client using?
Is that identity authenticated?
Is that identity authorized to read the canonical private SCTool artifact repository?
```

It does not define:

```text
package version resolution
Registry trust/head/snapshot signature verification
publisher signature verification
artifact digest verification
installation or activation behavior
Simple Connection UI behavior
```

Those remain separate responsibilities.

## 2. Identity provider

The identity provider is:

```text
github.com
```

The client credential authority is the GitHub CLI credential store. The Registry SDK must not mint, embed, persist, or require a separate Simple Connection client private key for this contract.

The client must not extract a GitHub token merely to establish Registry identity. In particular, the Registry access path must not invoke:

```text
gh auth token
```

and must not print, log, persist, return, or expose credential material in machine-readable results.

## 3. Canonical authentication algorithm

The canonical authentication sequence is:

```text
1. verify that `gh` is executable
2. run `gh auth status --hostname github.com`
3. require a successful process exit status
4. run `gh api user --jq ".login"`
5. require a non-empty login
```

`gh auth status` establishes whether the GitHub CLI session is authenticated.

`gh api user --jq ".login"` is the canonical current-account identity authority. Display text emitted by `gh auth status` must not be treated as the canonical login because cached/displayed account labels may lag a GitHub username rename.

The Registry access implementation must not parse a token value from `gh auth status` output.

## 4. Credential environment isolation

The Registry access path uses the GitHub CLI credential store selected by the interactive GitHub login flow.

Before invoking GitHub CLI commands for Registry identity or artifact access, the subprocess environment must remove inherited token overrides named case-insensitively as:

```text
GH_TOKEN
GITHUB_TOKEN
```

This prevents an unrelated inherited automation token from silently changing the GitHub identity used by Registry access.

The implementation may preserve non-secret GitHub CLI environment settings that do not replace authentication identity.

## 5. Canonical artifact repository

The canonical authenticated artifact backend for this access contract is:

```text
provider:             github.com
backend:              github-release-asset
repository:           Simple-Connection/sctool-artifacts
repositoryVisibility: private
```

The repository stores release artifacts, not Registry source metadata and not publisher source code.

`.sctool` payloads remain outside `sctool-registry` Git history.

## 6. Authorization algorithm

Authentication and authorization are separate decisions.

After canonical identity resolution succeeds, the client probes authenticated read access to:

```text
repos/Simple-Connection/sctool-artifacts
```

Conceptually, the GitHub CLI request is:

```text
gh api repos/Simple-Connection/sctool-artifacts --silent
```

A successful request means the active GitHub identity is authorized for the Registry artifact backend.

HTTP `403` and `404` responses are both normalized to `access-denied` for this contract. A private GitHub repository may be intentionally hidden from an unauthorized caller, so `404` must not be interpreted as proof that the repository does not exist.

Transport failures, DNS failures, and timeouts are not authorization denials; they are normalized separately as `network-unavailable`.

## 7. Access state model

The stable access states are:

```text
authorized
gh-unavailable
unauthenticated
identity-unresolved
access-denied
network-unavailable
configuration-error
```

Their meanings are:

```text
authorized
  GitHub CLI is available, the active account is authenticated, canonical identity
  resolution succeeded, and the canonical private artifact repository is readable.

gh-unavailable
  GitHub CLI is absent or cannot be executed.

unauthenticated
  GitHub CLI is available but `github.com` has no usable authenticated session.

identity-unresolved
  Authentication appeared valid but the canonical login could not be resolved through
  `gh api user --jq ".login"`.

access-denied
  Canonical identity was resolved but the private artifact repository is not readable.
  Authenticated `403` and `404` repository probes map here.

network-unavailable
  GitHub identity or authorization could not be checked because the network/transport
  failed or timed out.

configuration-error
  The Registry access configuration is invalid, unsupported, or internally inconsistent.
```

Only `authorized` grants authenticated artifact access.

## 8. Machine-readable boundary

A future SDK/CLI implementation may expose this contract as a structured result. The minimum semantic shape is:

```text
state
identity.provider
identity.login
authorized
```

Credential values, private keys, GitHub tokens, OAuth tokens, and GitHub CLI credential-store paths are forbidden result fields.

The identity object is present only when canonical identity resolution succeeds.

## 9. Artifact access invariant

SCTool release payload access requires:

```text
GitHub authentication
+ canonical identity resolution
+ read authorization to Simple-Connection/sctool-artifacts
```

Knowing a release URL or asset identity alone does not grant access to a private artifact.

An authorized GitHub user may still access an artifact outside Simple Connection using their own valid GitHub credentials. This contract is account authorization, not per-device entitlement or application attestation.

Per-device credentials, commercial licensing, entitlement gateways, and application-only download restrictions are explicitly outside v1.

## 10. Failure and logging rules

Registry access failures must fail closed for artifact retrieval.

The implementation must not include token-like credential material in error text or logs. User-facing errors may identify the access state and canonical GitHub login when known.

Recommended semantics are:

```text
gh-unavailable        -> GitHub CLI setup required
unauthenticated       -> GitHub login required
identity-unresolved   -> GitHub identity verification failed
access-denied         -> authenticated account lacks Registry artifact access
network-unavailable   -> retryable connectivity failure
configuration-error   -> Registry/SDK configuration defect
```

## 11. Validation requirements for consumers

A conforming Registry access consumer must have tests proving at least:

```text
successful authenticated identity + repository read -> authorized
missing/unexecutable gh -> gh-unavailable
failed `gh auth status` -> unauthenticated
failed/empty `gh api user` after authentication -> identity-unresolved
repository probe 403 -> access-denied
repository probe 404 -> access-denied
transport timeout/failure -> network-unavailable
inherited GH_TOKEN removed from Registry GitHub CLI subprocess
inherited GITHUB_TOKEN removed from Registry GitHub CLI subprocess
`gh auth token` is never invoked
credential material is never present in structured results
```

## 12. Authority boundary

```text
GitHub
= identity provider + credential store + private repository authorization

SCTool Registry contract
= canonical artifact repository identity + access semantics

SCTool SDK / Registry CLI
= consumer-side GitHub identity resolution + authorization probe

Simple Connection
= chooses when to invoke SDK/CLI behavior and owns its UI/install/runtime policy
```

This access contract must not require Simple Connection desktop internals to become a dependency of the SCTool SDK.
