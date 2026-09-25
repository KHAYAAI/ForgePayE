#!/bin/bash
# ============================================================
# FORGE — Deploy to AWS S3 + CloudFront
# Usage: ./aws-deploy.sh [bucket-name] [region] [distribution-id]
#
# Prerequisites:
#   aws configure  (set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY)
#   aws s3api create-bucket --bucket forge-website-prod --region us-east-1
#   Enable "Static website hosting" on the bucket in the AWS console
#   Set bucket policy for public read (see below)
# ============================================================

BUCKET=${1:-forge-website-prod}
REGION=${2:-us-east-1}
DISTRIBUTION_ID=${3:-}

echo "🚀 Deploying FORGE to s3://$BUCKET (region: $REGION)"

# ── HTML files (short cache — content changes frequently)
aws s3 sync . s3://$BUCKET \
  --region "$REGION" \
  --exclude "*" \
  --include "index.html" \
  --include "features/*.html" \
  --include "products/*.html" \
  --cache-control "public, max-age=300, s-maxage=3600" \
  --content-type "text/html; charset=utf-8" \
  --delete

echo "✅ HTML uploaded"

# ── JS files (forge.js + support.js)
aws s3 sync . s3://$BUCKET \
  --region "$REGION" \
  --exclude "*" \
  --include "forge.js" \
  --include "support.js" \
  --cache-control "public, max-age=86400, s-maxage=604800" \
  --content-type "application/javascript; charset=utf-8"

echo "✅ JS uploaded"

# ── CSS files
aws s3 sync . s3://$BUCKET \
  --region "$REGION" \
  --exclude "*" \
  --include "styles.css" \
  --cache-control "public, max-age=86400, s-maxage=604800" \
  --content-type "text/css; charset=utf-8"

echo "✅ CSS uploaded"

# ── Set index.html as the default root document
aws s3 website s3://$BUCKET \
  --index-document index.html \
  --error-document index.html

echo "✅ Bucket configured as static website"

# ── Invalidate CloudFront cache
if [ -n "$DISTRIBUTION_ID" ]; then
  echo "🔄 Invalidating CloudFront ($DISTRIBUTION_ID)..."
  aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*"
  echo "✅ CloudFront invalidated"
fi

echo ""
echo "🎉 Deploy complete!"
echo "📍 S3 URL  : http://$BUCKET.s3-website-$REGION.amazonaws.com"
echo "📍 CF URL  : (set your CloudFront domain in the console)"
echo ""
echo "── Bucket policy for public read ──────────────────────"
echo '{
  "Version":"2012-10-17",
  "Statement":[{
    "Sid":"PublicReadGetObject",
    "Effect":"Allow",
    "Principal":"*",
    "Action":"s3:GetObject",
    "Resource":"arn:aws:s3:::'"$BUCKET"'/*"
  }]
}'
