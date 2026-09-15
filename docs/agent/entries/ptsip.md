# PTSIP entry

Current development binding:

```text
Tool:            0.3.8a1
Project Profile: pp.1.01
Profile:         ptsip.yaml
Specification:   0.3.7-draft
Revision:        3c47816770d194ae42f98faedc911d980db0e62a
```

PTSIP is development tooling, not a Registry runtime or SDK runtime dependency.

Install the maintained exact Tool version in the coding-agent environment when needed:

```text
python -m pip install "PTSIP==0.3.8a1"
```

Do not vendor PTSIP or add it to product runtime dependencies to work around environment access problems.

For architecture/path-placement work, use inspection before change when needed. After architecture/governance changes, validate the profile. Release gates may additionally require conformance/gate operations.

New tracked paths must be assigned by `ptsip.yaml` in the same logical change. Classification follows lifecycle ownership, not directory name, language, framework, or executability.
