# Payments

Payments enable agents to process microtransactions using the [x402 protocol](https://www.x402.org/). When an agent's
HTTP tool call receives a `402 Payment Required` response, the payments system automatically signs and submits payment,
then retries the original request. This lets agents access paid APIs and services without manual intervention.

For a full overview of the payment architecture, see
[AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html) in the AWS developer
guide.

## Quick Start

```bash
# 1. Create a project with payments capability
agentcore create --name MyProject --defaults
cd MyProject

# 2. Add a payment manager
agentcore add payment-manager --name MyManager --pattern interceptor

# 3. Add a payment connector with CoinbaseCDP credentials
agentcore add payment-connector \
  --manager MyManager \
  --name MyCDPConnector \
  --provider CoinbaseCDP \
  --api-key-id your-api-key-id \
  --api-key-secret your-api-key-secret \
  --wallet-secret your-wallet-secret

# 4. Deploy (creates payment infrastructure on AWS)
agentcore deploy -y

# 5. Invoke with auto-session (creates a test payment session)
agentcore invoke --auto-session --prompt "Use a paid tool"
```

> **Note**: `--auto-session` requires a successful deploy first because it reads from deployed state to locate the
> payment manager ARN and create a session.

## How It Works

When an agent makes an HTTP request to a paid endpoint, the server returns a `402 Payment Required` response containing
payment requirements (amount, recipient, network). The AgentCore payments plugin intercepts this response, calls
`ProcessPayment` to sign a USDC transaction, and retries the original request with payment proof headers attached.

For the full runtime flow, see
[How AgentCore payments works](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-how-it-works.html).

### Payment Patterns

| Pattern     | Behavior                                                     |
| ----------- | ------------------------------------------------------------ |
| interceptor | Automatically handles 402 responses (transparent to agent)   |
| tool-based  | Exposes payment as an agent tool (agent decides when to pay) |

## Adding a Payment Manager

A payment manager is the top-level resource that orchestrates payment operations. It defines authorization, spending
patterns, and budget defaults.

### CLI Command

```bash
# Minimal (defaults: AWS_IAM auth, interceptor pattern, auto-payment enabled)
agentcore add payment-manager --name MyManager

# With all advanced options
agentcore add payment-manager \
  --name MyManager \
  --authorizer-type AWS_IAM \
  --pattern interceptor \
  --auto-payment true \
  --default-spend-limit 25.00 \
  --tool-allowlist "web_search,fetch_url" \
  --network-preferences "eip155:84532,eip155:8453" \
  --description "Production payment manager"
```

| Flag                               | Description                                                         |
| ---------------------------------- | ------------------------------------------------------------------- |
| `--name <name>`                    | Manager name (required in non-interactive mode)                     |
| `--authorizer-type <type>`         | `AWS_IAM` (default) or `CUSTOM_JWT`                                 |
| `--discovery-url <url>`            | OIDC discovery URL (required for CUSTOM_JWT)                        |
| `--allowed-clients <clients>`      | Comma-separated client IDs (CUSTOM_JWT only)                        |
| `--allowed-audience <audience>`    | Comma-separated allowed audiences (CUSTOM_JWT only)                 |
| `--allowed-scopes <scopes>`        | Comma-separated allowed scopes (CUSTOM_JWT only)                    |
| `--pattern <pattern>`              | `interceptor` (default) or `tool-based`                             |
| `--auto-payment [value]`           | Enable automatic payment: `true` (default) or `false`               |
| `--default-spend-limit <amount>`   | Default session spend limit in USD (default: `10.00`)               |
| `--tool-allowlist <tools>`         | Comma-separated tool names eligible for payment                     |
| `--network-preferences <networks>` | Comma-separated network IDs (e.g., `eip155:84532` for Base Sepolia) |
| `--description <desc>`             | Human-readable description                                          |
| `--json`                           | Output result as JSON                                               |

Name constraints: must start with a letter, contain only alphanumeric characters and underscores, max 48 characters.

When you add a payment manager, the CLI automatically patches your agent code to include the payments plugin. The
generated code is at `capabilities/payments/payments.py` in each agent's directory.

### Authorization Types

**AWS_IAM** (default): Uses AWS IAM SigV4 signing for payment authorization. No additional configuration needed.

```bash
agentcore add payment-manager --name MyManager --authorizer-type AWS_IAM
```

**CUSTOM_JWT**: Uses a custom JWT authorizer via OIDC discovery. Useful when end users authenticate via an external
identity provider (e.g., Cognito).

```bash
agentcore add payment-manager \
  --name MyManager \
  --authorizer-type CUSTOM_JWT \
  --discovery-url https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXX/.well-known/openid-configuration \
  --allowed-clients "client-id-1,client-id-2" \
  --allowed-audience "https://api.example.com" \
  --allowed-scopes "payments:read,payments:write"
```

For details on IAM role separation (ManagementRole vs ProcessPaymentRole), see
[IAM roles for AgentCore payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-iam-roles.html).

## Adding a Payment Connector

A payment connector links a credential provider (wallet credentials) to a payment manager. Each manager needs at least
one connector before it can process payments.

### CoinbaseCDP Provider

```bash
agentcore add payment-connector \
  --manager MyManager \
  --name MyCDPConnector \
  --provider CoinbaseCDP \
  --api-key-id your-api-key-id \
  --api-key-secret your-api-key-secret \
  --wallet-secret your-wallet-secret
```

| Flag                        | Description                              |
| --------------------------- | ---------------------------------------- |
| `--manager <name>`          | Parent payment manager (required)        |
| `--name <name>`             | Connector name (required)                |
| `--provider <provider>`     | `CoinbaseCDP` (default) or `StripePrivy` |
| `--api-key-id <id>`         | Coinbase CDP API Key ID                  |
| `--api-key-secret <secret>` | Coinbase CDP API Key Secret              |
| `--wallet-secret <secret>`  | Coinbase CDP Wallet Secret (ECDSA P-256) |
| `--json`                    | Output result as JSON                    |

### StripePrivy Provider

```bash
agentcore add payment-connector \
  --manager MyManager \
  --name MyStripeConnector \
  --provider StripePrivy \
  --app-id your-privy-app-id \
  --app-secret your-privy-app-secret \
  --authorization-private-key your-ecdsa-private-key \
  --authorization-id your-authorization-key-id
```

| Flag                                | Description                         |
| ----------------------------------- | ----------------------------------- |
| `--manager <name>`                  | Parent payment manager (required)   |
| `--name <name>`                     | Connector name (required)           |
| `--provider <provider>`             | Must be `StripePrivy`               |
| `--app-id <id>`                     | Privy App ID                        |
| `--app-secret <secret>`             | Privy App Secret                    |
| `--authorization-private-key <key>` | ECDSA P-256 private key for signing |
| `--authorization-id <id>`           | Authorization key identifier        |
| `--json`                            | Output result as JSON               |

### Credential Storage

Connector credentials are stored in `agentcore/.env.local` and never committed to source control. The env var naming
convention is:

**CoinbaseCDP** (3 variables):

```
AGENTCORE_CREDENTIAL_{CREDENTIAL_NAME}_API_KEY_ID=...
AGENTCORE_CREDENTIAL_{CREDENTIAL_NAME}_API_KEY_SECRET=...
AGENTCORE_CREDENTIAL_{CREDENTIAL_NAME}_WALLET_SECRET=...
```

**StripePrivy** (4 variables):

```
AGENTCORE_CREDENTIAL_{CREDENTIAL_NAME}_APP_ID=...
AGENTCORE_CREDENTIAL_{CREDENTIAL_NAME}_APP_SECRET=...
AGENTCORE_CREDENTIAL_{CREDENTIAL_NAME}_AUTHORIZATION_PRIVATE_KEY=...
AGENTCORE_CREDENTIAL_{CREDENTIAL_NAME}_AUTHORIZATION_ID=...
```

`{CREDENTIAL_NAME}` is the connector's credential name uppercased with hyphens replaced by underscores. For example, a
credential named `my-cdp-creds` becomes `AGENTCORE_CREDENTIAL_MY_CDP_CREDS_API_KEY_ID`.

### Credential Rotation

To rotate credentials:

1. Update the values in `agentcore/.env.local`
2. Run `agentcore deploy -y`

Deploy automatically updates the PaymentCredentialProvider on AWS with the new secret values.

## Deploying with Payments

When you run `agentcore deploy`, the CLI creates payment infrastructure via direct API calls (not CloudFormation). The
deploy sequence for each payment manager:

1. Reads credentials from `.env.local`
2. Creates or updates a **PaymentCredentialProvider** with the connector secrets
3. Creates **IAM roles** (ProcessPaymentRole and ResourceRetrievalRole) if they don't exist
4. Creates the **PaymentManager** (skipped if it already exists)
5. Creates or updates the **PaymentConnector** linking credentials to the manager

### Prerequisites

- `agentcore/.env.local` must exist with all required credential variables
- Each manager must have at least one connector configured
- AWS credentials with sufficient permissions (see
  [IAM roles](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-iam-roles.html))

> **Note**: First-time deployment takes extra time for IAM role creation and propagation. Subsequent deploys are faster.

## Invoking with Payment Context

After deploying, use `agentcore invoke` to test agents with payment capabilities.

### Payment Flags

| Flag                           | Description                                               |
| ------------------------------ | --------------------------------------------------------- |
| `--payment-instrument-id <id>` | Payment instrument ID (a funded wallet) for x402 payments |
| `--payment-session-id <id>`    | Payment session ID for budget tracking                    |
| `--auto-session`               | Auto-create or reuse a payment session for testing        |

### Auto-Session Mode

`--auto-session` creates a temporary payment session with the default spend limit, or reuses an existing one from the
current testing context. This is the simplest way to test payment flows without manually creating instruments and
sessions via the AWS API.

```bash
agentcore invoke --auto-session --prompt "Search for paid research papers"
```

### Explicit Payment Context

For production testing with specific instruments and sessions:

```bash
agentcore invoke \
  --payment-instrument-id payment-instrument-abc123 \
  --payment-session-id payment-session-xyz789 \
  --prompt "Process a payment for the weather API"
```

For details on creating instruments and sessions, see
[Create a payment instrument](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-instrument.html).

## Status and Removal

### Checking Status

```bash
agentcore status --type payment
```

Shows each payment manager's deployment state, connector count, and live health from the AWS API. The status command
queries the deployed payment manager to verify it's reachable.

### Removing a Connector

```bash
agentcore remove payment-connector --name MyCDPConnector --manager MyManager -y
```

The `--manager` flag is required when a connector name exists under multiple managers.

### Removing a Manager

```bash
agentcore remove payment-manager --name MyManager -y
```

Removing a payment manager cascades: it deletes all associated connectors and credential providers from the local
configuration.

## Validation

`agentcore validate` checks payment configuration for common issues:

- Credential cross-references: verifies each connector's `credentialName` maps to a valid credential entry
- `.env.local` existence: confirms the secrets file exists when payment connectors are configured
- Missing environment variables: checks that all required `AGENTCORE_CREDENTIAL_*` variables are present

```bash
agentcore validate
```

## Troubleshooting

| Error                                 | Cause                                    | Fix                                                            |
| ------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| `.env.local not found`                | No secrets file in project               | Create `agentcore/.env.local` with credential vars             |
| `Missing credentials for connector`   | Env vars not set for a connector         | Add the required `AGENTCORE_CREDENTIAL_*` vars to `.env.local` |
| `ServiceQuotaExceededException`       | Account limit on payment managers        | Request a quota increase via AWS Support                       |
| `No connectors for payment manager`   | Manager has zero connectors              | Add at least one connector before deploying                    |
| `PaymentCredentialProvider not found` | Orphaned reference after manual deletion | Re-run `agentcore deploy` to recreate                          |
| `Request timeout`                     | Network or service availability          | Retry deploy; check internet connectivity                      |
| `Invalid authorizer type`             | Typo in `--authorizer-type` flag         | Use `AWS_IAM` or `CUSTOM_JWT` (case-sensitive)                 |

For additional troubleshooting, see
[Troubleshooting AgentCore payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-troubleshooting.html).

## Further Reading

**AWS Documentation:**

- [AgentCore Payments overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html)
- [Core concepts](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-concepts.html)
- [How it works](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-how-it-works.html)
- [Getting started](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-getting-started.html)
- [Prerequisites](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-prerequisites.html)
- [IAM roles](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-iam-roles.html)
- [Create manager and connector](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-manager.html)
- [Create instrument](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-instrument.html)
- [Process a payment](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-process-payment.html)
- [Coinbase Bazaar via Gateway](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-connect-bazaar.html)
- [Observability](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-observability.html)
- [Troubleshooting](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-troubleshooting.html)

**Blog:**

- [Agents that transact: Introducing Amazon Bedrock AgentCore Payments](https://aws.amazon.com/blogs/machine-learning/agents-that-transact-introducing-amazon-bedrock-agentcore-payments-built-with-coinbase-and-stripe/)

**Samples:**

- [x402 Payments with CloudFront](https://github.com/aws-samples/sample-agentcore-cloudfront-x402-payments)
