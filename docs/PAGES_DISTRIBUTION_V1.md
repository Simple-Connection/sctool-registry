# SCTool Registry GitHub Pages Distribution Contract v1

`distribution_contract_version: 1.0.0`

This document defines the public metadata distribution boundary used by Simple Connection.
GitHub remains the canonical repository and artifact host, while GitHub Pages serves signed registry metadata.

## 1. Fixed client bootstrap

Simple Connection may pin exactly two registry bootstrap values:

```text
registry head URL
registry root Ed25519 public key
```

The client must not pin an SCTool package version, package release URL, publisher key, or GitHub API token.
The canonical Pages head URL is expected to be:

```text
https://simple-connection.github.io/sctool-registry/registry-head.json
```

A later hosting migration may change the bootstrap endpoint in a Simple Connection release without changing package identity or registry contracts.

## 2. Public Pages output

One atomic Pages deployment contains:

```text
trust.json
registry-head.json
snapshots/{revision}.json
```

Only `registry-head.json` is intended for low-frequency polling.
A client downloads the referenced immutable snapshot only when the verified head revision differs from its last verified revision.

`.sctool` payloads are not served from Pages. Package descriptors point to immutable anonymous HTTPS assets, initially GitHub Releases.

## 3. Canonical signing representation

Trust and head signatures use **SCTool canonical JSON v1**.

For the object being signed:

1. only JSON null, booleans, strings, safe integers, arrays, and objects are permitted;
2. schema-defined object member names are ASCII and are sorted in ascending UTF-16 code-unit order, equivalent to the default JavaScript `Array.prototype.sort()` order for those member names;
3. array order is preserved;
4. no insignificant whitespace is emitted;
5. UTF-8 encodes the resulting JSON text;
6. no trailing newline is part of the signed bytes.

Both signed envelopes use this payload:

```text
canonical({
  "schemaVersion": envelope.schemaVersion,
  "signed": envelope.signed
})
```

The signature algorithm is Ed25519 and the signature encoding is base64 raw 64-byte signature material.

## 4. Root trust and distribution keys

The Registry Root private key is an **offline authority**. It must never be committed to Git, uploaded to GitHub Actions, embedded in Simple Connection, or used for routine snapshot publication.

Simple Connection pins the corresponding root public key.

The root key signs `trust.json`. `trust.json` authorizes one or more distribution public keys with lifecycle states:

```text
active   = may sign a new registry head
retired  = retained for historical verification; may not sign a new head
revoked  = must not be accepted
```

The routine distribution private key may be stored as a GitHub Actions secret because compromise of that key can be recovered by an offline-root-signed trust rotation.

### Distribution key rotation

Normal rotation is:

```text
1. offline root signs trust sequence N+1 with old key + new active key
2. publish the new trust descriptor
3. configure Actions with the new distribution private key
4. publish a head signed by the new key
5. after the migration window, offline root signs a later trust sequence retiring the old key
```

A revoked key is never valid for a new head.

## 5. Registry revision and anti-rollback state

A Pages revision is the exact source Git commit identity used to assemble the snapshot.
Contract v1 accepts lowercase hexadecimal Git object identifiers of 40 to 64 characters.

`sequence` is a positive monotonic source-history count generated from the canonical `main` history:

```text
git rev-list --count <source-revision>
```

Simple Connection stores the last verified state:

```text
(trustSequence, sequence, revision)
```

Client anti-rollback rules are evaluated only after the root signature on `trust.json` and the authorized distribution signature on `registry-head.json` verify:

```text
incoming trustSequence < stored trustSequence
    -> reject stale trust metadata

incoming trustSequence > stored trustSequence
    -> eligible after root-signature verification

incoming trustSequence == stored trustSequence
and incoming sequence < stored sequence
    -> reject stale registry metadata

incoming trustSequence == stored trustSequence
and incoming sequence == stored sequence
and incoming revision != stored revision
    -> reject as conflicting history

incoming trustSequence == stored trustSequence
and incoming sequence > stored sequence
    -> eligible after signature verification
```

When a higher `trustSequence` is accepted, the head must reference that exact trust sequence and must be signed by an active key in that trust descriptor.

A first-install client cannot cryptographically prove global freshness without an external transparency/time authority; it therefore accepts a currently valid root-trusted trust/head pair obtained over HTTPS. After that first accepted state, the stored trust and registry sequences provide rollback resistance.

## 6. Immutable snapshot

The immutable snapshot path is:

```text
snapshots/{revision}.json
```

The signed head contains the exact snapshot path, SHA-256, and byte size.
A snapshot at an existing revision must never be replaced with different bytes.

The snapshot aggregates the complete package and publisher descriptors referenced by canonical `registry.json`.
This prevents Simple Connection from polling every package individually.

## 7. Version indirection

Package descriptors contain:

```text
defaultChannel
channels
versions
```

Example:

```json
{
  "defaultChannel": "stable",
  "channels": {
    "stable": "0.3.4"
  },
  "versions": {
    "0.3.4": { "artifacts": {} }
  }
}
```

Simple Connection resolves the channel through signed registry data. Individual SCTool versions are not hardcoded into the application.
Every channel target must identify a version present in the same package descriptor.

## 8. Batch publication

Routine publisher submissions are not mapped one-to-one to Pages deployments.
Registry Intake should collect independently accepted changes and publish them as one atomic registry transaction.

The default batching policy is a Registry Intake concern, but the following invariants are mandatory:

```text
one canonical source commit
-> one immutable snapshot revision
-> at most one current head transition
```

Multiple SCTool changes may therefore produce one Registry revision.
Security-critical revocation or emergency removal may bypass a normal batching delay.

## 9. Client fetch policy

The distribution contract does not require continuous polling.
Recommended Simple Connection behavior is:

```text
verified local check < 24 hours old
    -> no automatic network request

otherwise
    -> GET registry-head.json
       verify root-authorized distribution signature
       fetch snapshot only when revision changed
```

A user-requested Refresh may bypass the local TTL.
GitHub REST API is not part of the client discovery protocol.

## 10. Pages publication gate

The custom GitHub Actions workflow must:

```text
PTSIP validate/conform
-> validate Registry JSON and JSON Schema contracts
-> verify root signature on trust.json
-> verify distribution private key matches exactly one active authorized key
-> resolve registry/package/publisher identities
-> enforce channel -> version references
-> assemble immutable snapshot
-> sign registry-head.json
-> validate generated Pages JSON contracts
-> independently verify generated Pages cryptographic output
-> deploy Pages artifact
```

Before `trust/trust.json` exists, Pages publication remains intentionally inactive while repository governance and Registry JSON contract checks still run.
