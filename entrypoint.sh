#!/bin/sh
set -e

# Fetch Claude credentials from Secrets Manager
if [ -n "$CLAUDE_CREDENTIALS_SECRET" ]; then
  mkdir -p "$HOME/.claude"
  aws secretsmanager get-secret-value \
    --secret-id "$CLAUDE_CREDENTIALS_SECRET" \
    --region "${AWS_REGION:-eu-central-1}" \
    --query 'SecretString' \
    --output text > "$HOME/.claude/.credentials.json"
  echo "Claude credentials loaded from Secrets Manager"
fi

# Push DB schema
npx drizzle-kit push

# Start bot
exec npx tsx src/index.ts
