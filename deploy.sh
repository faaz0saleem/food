#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-your-gcp-project-id}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-lahore-table-booking}"
IMAGE="gcr.io/${PROJECT_ID}/lahore-booking:$(git rev-parse --short HEAD)"

docker build -t "$IMAGE" .
docker push "$IMAGE"

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated
