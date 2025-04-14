#!/bin/bash

# Text colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Change to the infrastructure directory
cd "$(dirname "$0")/.." || exit 1
INFRA_DIR=$(pwd)
echo -e "${BLUE}Starting deployment process from ${INFRA_DIR}...${NC}"

# Step 1: Initialize database
echo -e "${BLUE}Step 1: Initializing database...${NC}"
node scripts/init-db.js
if [ $? -ne 0 ]; then
  echo -e "${RED}Database initialization failed!${NC}"
  exit 1
fi
echo -e "${GREEN}Database initialized successfully.${NC}"

# Step 2: Build TypeScript code
echo -e "${BLUE}Step 2: Building TypeScript code...${NC}"
bun run build
if [ $? -ne 0 ]; then
  echo -e "${RED}TypeScript build failed!${NC}"
  exit 1
fi
echo -e "${GREEN}TypeScript code built successfully.${NC}"

# Step 3: Deploy infrastructure
echo -e "${BLUE}Step 3: Deploying infrastructure...${NC}"

# Check if the TypeScript compiled file exists in dist
COMPILED_FILE="dist/index.js"
if [ ! -f "$COMPILED_FILE" ]; then
  echo -e "${RED}${COMPILED_FILE} not found. Running build again...${NC}"
  bun run clean && bun run build
  
  if [ ! -f "$COMPILED_FILE" ]; then
    echo -e "${RED}Build failed: ${COMPILED_FILE} still not found. Checking source file...${NC}"
    
    if [ ! -f "src/index.ts" ]; then
      echo -e "${RED}Source file src/index.ts not found. Cannot proceed with deployment.${NC}"
      exit 1
    else
      echo -e "${BLUE}Source file exists. Checking for other errors in the build process...${NC}"
      # Try running TypeScript directly with more verbose output
      npx tsc --project tsconfig.json --listFiles
    fi
  fi
fi

# Run pulumi up directly since we've already built the TypeScript
npx pulumi up --yes
if [ $? -ne 0 ]; then
  echo -e "${RED}Infrastructure deployment failed!${NC}"
  exit 1
fi
echo -e "${GREEN}Infrastructure deployed successfully.${NC}"

# Step 4: Update environment variables
echo -e "${BLUE}Step 4: Updating environment variables...${NC}"
node scripts/update-env.js
if [ $? -ne 0 ]; then
  echo -e "${RED}Environment variable update failed!${NC}"
  exit 1
fi
echo -e "${GREEN}Environment variables updated successfully.${NC}"

# Step 5: Verify API endpoints
echo -e "${BLUE}Step 5: Verifying API endpoints...${NC}"
API_URL=$(pulumi stack output apiEndpoint)
echo -e "${BLUE}API URL: ${API_URL}${NC}"

# Check the status endpoint
echo -e "${BLUE}Testing API status endpoint...${NC}"
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_URL}/api/status" || echo "failed")
if [ "$STATUS_CODE" = "200" ]; then
  echo -e "${GREEN}API status endpoint is accessible (HTTP $STATUS_CODE)${NC}"
else
  echo -e "${RED}Warning: API status endpoint check returned: $STATUS_CODE${NC}"
  echo -e "${RED}This might be due to DNS propagation delay or API Gateway deployment delay${NC}"
  echo -e "${RED}Try accessing the endpoint manually after a few minutes${NC}"
fi

echo -e "${GREEN}Deployment completed successfully!${NC}"