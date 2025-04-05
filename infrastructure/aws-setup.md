# Setting up AWS Credentials for Pulumi

There are several ways to configure AWS credentials for Pulumi:

## Option 1: Using AWS CLI (Recommended)

1. Install the AWS CLI if you haven't already:
   ```bash
   brew install awscli
   ```

2. Configure your AWS credentials:
   ```bash
   aws configure
   ```
   
   You'll be prompted to enter:
   - AWS Access Key ID
   - AWS Secret Access Key
   - Default region (e.g., us-west-2)
   - Default output format (json)

## Option 2: Environment Variables

You can set AWS credentials as environment variables:

```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-west-2
```

## Option 3: Pulumi Configuration

You can also set AWS credentials directly in Pulumi:

```bash
pulumi config set aws:accessKey YOUR_ACCESS_KEY --secret
pulumi config set aws:secretKey YOUR_SECRET_KEY --secret
pulumi config set aws:region us-west-2
```

## Getting AWS Credentials

If you don't have AWS credentials yet:

1. Sign in to the AWS Management Console
2. Go to IAM (Identity and Access Management)
3. Create a new user or use an existing one
4. Attach policies (at minimum: AmazonDynamoDBFullAccess, AmazonAPIGatewayAdministrator, AWSLambda_FullAccess)
5. Create access key and secret key
