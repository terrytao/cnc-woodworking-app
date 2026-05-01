# CNC Cut List Generator

Describe a furniture piece in plain text or upload a photo — Claude identifies the furniture type, overall dimensions, and component parts with rough dimensions.

## Architecture

```
frontend/   React + Vite (S3 + CloudFront)
backend/    AWS Lambda (Node 20) + Anthropic API
infra/      AWS CDK v2
```

## Local Development

**Prerequisites:** Node 20+, an Anthropic API key.

```bash
# Install dependencies
npm run install:all

# Terminal 1 — backend (port 3001)
ANTHROPIC_API_KEY=sk-ant-... npm run dev:backend

# Terminal 2 — frontend (port 5173, proxies /api to :3001)
npm run dev:frontend
```

Open http://localhost:5173.

## Deploying to AWS

**Prerequisites:** AWS CLI configured, CDK bootstrapped (`npx cdk bootstrap`).

```bash
# Build frontend + deploy CDK stack
ANTHROPIC_API_KEY=sk-ant-... npm run deploy
```

## CI/CD

Push to `main` triggers GitHub Actions. Add these repository secrets:

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM key with CloudFormation/S3/Lambda/CloudFront permissions |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

## Response Schema

Claude returns:

```json
{
  "furnitureType": "Bookshelf",
  "description": "A tall five-shelf bookcase.",
  "overallDimensions": { "width": 36, "height": 72, "depth": 12, "unit": "inches" },
  "parts": [
    { "name": "Side Panel", "length": 72, "width": 12, "thickness": 0.75, "notes": "x2" },
    { "name": "Shelf", "length": 34.5, "width": 11.25, "thickness": 0.75, "notes": "x5, adjustable" }
  ]
}
```

The joinery and cut-optimization engine will be added separately.
