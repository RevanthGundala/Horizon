# Horizon Infrastructure

This directory contains the infrastructure as code (IaC) for the Horizon application using Pulumi and AWS Lambda functions.

## Project Structure

```
infrastructure/
├── src/
│   ├── api/           # Lambda function handlers
│   │   └── status.ts  # Status endpoint handler
│   ├── types/         # TypeScript type definitions
│   └── index.ts       # Main Pulumi program
├── Pulumi.yaml        # Pulumi project configuration
├── package.json       # Node.js dependencies
└── tsconfig.json      # TypeScript configuration
```

## Getting Started

### Prerequisites

1. Install Pulumi CLI: https://www.pulumi.com/docs/install/
2. Configure AWS credentials: https://www.pulumi.com/docs/clouds/aws/get-started/begin/

### Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create a new Pulumi stack:
   ```
   pulumi stack init dev
   ```

3. Configure AWS region:
   ```
   pulumi config set aws:region us-west-2
   ```

### Commands

- Build the TypeScript code:
  ```
  npm run build
  ```

- Preview infrastructure changes:
  ```
  npm run preview
  ```

- Deploy infrastructure:
  ```
  npm run deploy
  ```

- Destroy infrastructure:
  ```
  npm run destroy
  ```

## API Endpoints

- `GET /status` - Returns a 200 OK response with a status message

## Adding New Endpoints

1. Create a new handler file in the `src/api/` directory
2. Export the handler functions
3. Import the handler in `src/index.ts`
4. Add the route to the API Gateway configuration
