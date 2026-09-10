---
name: Product/package Registry report
about: Machine-routable Product or package validation/registration/discovery failure owned by sctool-registry
title: "[Product report] "
labels: ""
assignees: ""
---

Use this template for Product/package failures that must be routed to `Simple-Connection/sctool-registry` without being classified as Registry Client SDK defects.

Replace every placeholder before submitting. Do not include tokens, credentials, secrets, private environment values, stdout/stderr, or raw unsanitized logs.

<!-- sctool-registry-product-report:v1
{
  "schema": "sctool-registry-product-report/v1",
  "report_id": "replace-with-stable-report-id",
  "kind": "VALIDATION_FAILURE",
  "severity": "NORMAL",
  "fingerprint": "replace-with-product-owned-fingerprint",
  "source": {
    "repository": "Simple-Connection/SC_Linked_App",
    "branch": "dev/2.2.4",
    "head": "0000000000000000000000000000000000000000",
    "session": "P4",
    "work_item": "P4-W3"
  },
  "package": {
    "id": "replace-with-package-id",
    "version": "replace-with-package-version",
    "profile_schema_version": "replace-with-profile-schema-version"
  },
  "failure": {
    "operation": "MARKETPLACE_VALIDATION",
    "code": "REPLACE_WITH_STABLE_REGISTRY_ERROR_CODE",
    "path": "replace.with.failed.field.path",
    "observed": "sanitized observed problem",
    "expected": "expected requirement",
    "repair_hint": "sanitized repair hint",
    "evidence_ref": "stable sanitized evidence reference"
  },
  "sdk": {
    "package": "@simple-connection/sctool-sdk",
    "version": "1.0.3",
    "contract": "marketplace-profile/v1"
  }
}
-->
