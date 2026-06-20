# SverkaBot — Security Specification v1.1

This document supersedes Security Specification v1.0 and defines the canonical security model for the production system.

Aligned with: PRD 6.1, Tech Plan 6.1, DB Draft v4.1, API Notes 3.1, User Flow v3.2

Purpose: define how the system protects user data, secrets, operational integrity, and administrative access.

## 1. Security objectives

The system must guarantee:
1. authorized users only access their own data;
2. only administrators access administrative functions;
3. webhook and provider callbacks are authenticated;
4. secrets are never exposed in source code or logs;
5. sensitive files and data are stored and retained according to policy;
6. raw bank data does not leak into logs, errors, or analytics;
7. deletion is complete and auditable;
8. queue and worker actions are traceable;
9. future marketplace expansion does not weaken access control;
10. Russian user-facing text does not reveal internals or raw payloads;
11. report access is ownership-validated or signed.

## 2. Threat model

Main threats:
- unauthorized access to user financial data;
- forged Telegram webhook requests;
- forged payment webhooks;
- leaked API tokens or provider secrets;
- accidental logging of raw bank statements;
- cross-user data exposure due to broken authorization;
- replayed or duplicated payment events;
- malicious uploads or malformed files intended to crash parsers;
- abuse of retry/cancel actions;
- admin privilege misuse;
- queue poisoning or repeated job execution.

## 3. Identity and authentication

### Telegram identity
Users are identified by Telegram user ID.

### Bot webhook authentication
Telegram webhook requests must validate the configured secret header.

### Internal service authentication
Service-to-service requests must use an internal secret that is never user-visible.

### Admin authentication
Administrative access requires:
- admin bearer token or equivalent protected credential;
- Telegram user ID in the admin allow-list.

### Payment webhook authentication
YooKassa callbacks must be verified using provider signature and idempotency rules.

## 4. Authorization model

Ownership checks are mandatory for:
- imports
- reconciliation runs
- reports
- billing history
- statistics
- deletion flows
- retry and cancel actions

Admin-only actions:
- view profiles
- activate/deprecate profiles
- view parsing errors
- retry export
- view admin metrics
- operational alert review

## 5. Secrets management

Secrets must be injected through environment variables or a managed secret store.

Secret classes:
- Telegram bot token
- Telegram webhook secret
- internal service token
- database credentials
- Redis credentials
- Supabase service role key
- YooKassa secret key
- Google service account credentials
- admin token

No secret may appear in:
- source code
- tests
- logs
- screenshots
- generated reports

Secrets must support rotation.

## 6. Data classification

Public data:
- command names
- generic product descriptions

Operational data:
- import status
- reconciliation status
- progress
- job ids
- profile ids
- non-sensitive metrics

Sensitive user data:
- Telegram IDs
- usernames where applicable
- uploaded bank statements
- uploaded marketplace reports
- canonical transactions
- reconciliation evidence
- payment history
- deletion metadata

Highly sensitive data:
- raw bank fragments
- payment provider payloads
- secrets
- tokens
- service credentials
- webhook signatures

## 7. File security

Uploaded files must be validated before persistence.

Validation:
- file size limit;
- file type check;
- extension check;
- hash computation;
- duplicate detection;
- parseability screening when feasible.

Storage rules:
- use deterministic object paths;
- scope paths by user and file hash or run ID;
- do not expose storage credentials to clients;
- delete expired objects according to retention policy.

Parsers must never execute formulas, macros, or external references from files.

## 8. Logging and redaction

Never log raw:
- secrets;
- full bank rows;
- full payment payloads;
- unnecessary PII;
- raw HTML report bodies beyond what is expected in the report artifact itself.

Keep fragments truncated and masked.

Correlate requests and jobs using correlation IDs.

## 9. Telegram bot security

Inline callback data must not contain secrets.
Every callback must re-check ownership and state.
Sensitive commands must validate ownership or admin status:
- `/retry_import`
- `/cancel`
- `/get_report`
- `/delete_my_data`
- admin commands

User-visible errors must be short and non-sensitive.

## 10. Billing security

YooKassa webhooks must be verified for authenticity and idempotency.
Repeated callbacks must not duplicate transactions or subscriptions.
Billing records must persist provider id, amount, status, and linked subscription.

## 11. Queue and worker security

Jobs must be idempotent and cancellation-aware.
Workers must:
- verify job state before mutation;
- avoid duplicate inserts;
- rely on unique keys and deterministic row hashes;
- exit safely if cancellation is requested.

Malformed or repeatedly failing jobs must be bounded by retry policy and then surfaced to admins.

## 12. Database security

User data must be protected by ownership rules.
Service role access is reserved for trusted backend services only.
Deletion must be explicit and safe.
Audit events must persist after anonymization.

## 13. Data deletion and privacy

On delete:
- storage artifacts are deleted;
- canonical transactions are removed;
- reconciliation artifacts are removed;
- imports are soft-deleted;
- user is anonymized;
- consent and audit records remain as required by policy;
- `has_used_trial` remains true.

The product must provide privacy information and consent links before processing begins.

## 14. Admin security

All admin actions must be recorded in audit events.
Admin access should be limited to the minimum required operators.
Worker failures and threshold breaches should be sent to admins as concise alerts.

## 15. Transport and deployment security

- HTTPS only.
- Do not trust private network placement as a substitute for authentication.
- Use separate credentials and resources for local, staging, and production.
- Backups must be encrypted or stored in a secure managed environment.

## 16. Backup and recovery security

Restore procedures must include:
- credential verification;
- environment selection;
- secret rotation check if compromise is suspected;
- integrity validation.

## 17. Incident response

Incident types:
- secret leak;
- webhook abuse;
- payment callback abuse;
- unauthorized access bug;
- data corruption;
- queue failure;
- storage failure;
- parser crash loop.

Response principles:
- contain quickly;
- rotate secrets;
- disable affected endpoints if necessary;
- preserve audit evidence;
- notify operators;
- restore safely.

## 18. Minimum implementation checklist

Confirm:
- Telegram secret validation;
- internal service token validation;
- admin token validation;
- YooKassa signature validation;
- ownership checks on all user routes;
- no raw bank data in logs;
- redaction of sensitive fragments;
- secure storage paths;
- file retention cleanup;
- audit trail for critical actions;
- cancellation checks in workers;
- idempotent payment handling;
- environment separation;
- secret rotation procedure;
- signed or ownership-validated report access.

## 19. Security review cadence

Review security whenever:
- billing provider changes;
- storage provider changes;
- queue implementation changes;
- new marketplace support is added;
- new admin capability is added;
- new user-scoped endpoint is added;
- deletion or retention policy changes;
- report format changes.

End of Security Specification v1.1.
