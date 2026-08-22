# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `3.0.x` | Yes |
| `2.x` and earlier | No |

Security fixes are maintained for the latest `3.0.x` version published on the default branch. Operators upgrading from `2.x` should follow the [3.0 migration guide](docs/operations/migration-3.0.md).

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, credentials, session material, personal data, packet captures, or operational evidence in a public issue.

Report vulnerabilities privately to `deco31416@gmail.com` with:

- the affected version or commit;
- the impacted component and deployment mode;
- reproducible steps using synthetic or redacted data;
- the expected impact;
- any suggested mitigation.

You should receive an acknowledgement within seven calendar days. Publication should wait until the issue has been assessed and a coordinated disclosure date has been agreed.

## Scope and safe research

Testing must use accounts, devices, networks, and data for which you have explicit authorization. Do not access third-party systems, retain private evidence, disrupt services, or attempt social engineering as part of a report.

Operational limitations and responsible-use requirements are documented in [docs/security/responsible-use.md](docs/security/responsible-use.md).
