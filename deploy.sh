#!/bin/bash
# Remove the cdk.out directory
# rm -rf cdk.out

# Bootstrap if you haven't already (especially important in a new region)
cdk bootstrap --require-approval never

# Build your TypeScript code
npm run build

# Deploy with verbose logging
cdk deploy --require-approval never
