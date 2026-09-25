# FORGE — Static HTML Website

Deploy-ready static website for AWS (S3 + CloudFront).

## File Structure

```
/
├── index.html              (Homepage — hero, five products, moat, pricing, dev quickstart)
├── about.html              (Company Q&A: what FORGE is, why agents need credit, careers, press)
├── thesis.html             (Why we're building this)
├── contact.html            (mailto: partnerships/careers/press — no backend form)
├── privacy-policy.html
├── terms.html
├── products/
│   ├── credit-bureau.html  (FORGE Credit Bureau — banks, fintech, lending protocols)
│   ├── payments.html       (FORGE Payments — merchants, developers)
│   ├── treasury.html       (FORGE Treasury — CFOs, enterprise)
│   ├── custody.html        (FORGE Custody — institutional threshold signing)
│   └── wallet.html         (FORGE Wallet — keyless wallets & agent identity)
├── features/               (nine deep-dive pages, linked from every nav & footer)
│   ├── ontology.html             (Revenue Ontology — the canonical event bus)
│   ├── agents.html                (Agentic Commerce — the six-service agent stack)
│   ├── mor.html                    (Global Tax & MoR)
│   ├── privacy.html                (Privacy & ZK — honestly marked in development)
│   ├── traditional-finance.html
│   ├── crypto-stablecoins.html
│   ├── agentic-economy.html
│   ├── rwas.html                   (Real-World Assets)
│   └── billing.html                (Subscriptions)
├── aws-deploy.sh
├── cloudfront-distribution-config.json
└── README.md               (This file)
```

## Deployment to AWS

### Option 1: AWS S3 + CloudFront (Recommended)

1. **Create S3 bucket:**
   ```bash
   aws s3 mb s3://forge-website-prod --region us-east-1
   ```

2. **Enable static website hosting:**
   ```bash
   aws s3api put-bucket-website \
     --bucket forge-website-prod \
     --website-configuration \
     '{
       "IndexDocument": {"Suffix": "index.html"},
       "ErrorDocument": {"Key": "index.html"}
     }'
   ```

3. **Upload all files:**
   ```bash
   aws s3 sync . s3://forge-website-prod \
     --exclude ".git*" \
     --exclude "README.md" \
     --exclude "aws-deploy.sh" \
     --cache-control "public, max-age=3600"
   ```
   Or just run `./aws-deploy.sh`, which wraps this and the CloudFront
   invalidation step.

4. **Create CloudFront distribution:**
   - Origin: S3 bucket `forge-website-prod.s3.amazonaws.com`
   - Viewer protocol: HTTPS only
   - Cache behavior: Allow GET, HEAD, OPTIONS
   - TTL: Default 86400s (1 day)
   - Compress: Yes (Gzip)
   - CNAME: `forge.io` (or your domain)

5. **Set up Route 53:**
   - Add CNAME alias from your domain to CloudFront distribution

### Option 2: AWS Amplify (Simplest)

1. Push this repo to GitHub
2. Go to AWS Amplify Console
3. Connect repository
4. Auto-deploy on git push
5. Domain via Amplify or Route 53

### Option 3: Netlify (Fastest)

1. Connect repo to Netlify
2. Build command: (leave empty — static files only)
3. Publish directory: `.` (project root)
4. Auto-deploys on push

## Key Files

- **index.html** — Main homepage (60KB, all inline CSS/JS)
- **products/*.html** — Three product pages (8–11KB each, standalone)
- **features/*.html** — Deep-dive pages (24–30KB each, standalone)
- **FORGE (standalone).html** — Single offline bundle (774KB, all Google Fonts inlined)

## Performance Notes

- No external dependencies except Google Fonts (inlined in standalone version)
- All CSS inline (no separate stylesheets)
- All JavaScript inline (no build step required)
- Images: None (design is CSS + typography)
- Total site size: ~500KB (uncompressed), ~90KB (gzipped)

## Navigation

**Homepage → Product pages:**
- index.html → products/payments.html
- index.html → products/treasury.html
- index.html → products/credit-bureau.html

**Product pages → Features:**
- products/payments.html → features/payments.html
- products/treasury.html → features/treasury.html, features/agents.html
- products/credit-bureau.html → features/agents.html

**All pages:** Consistent nav, working dropdown (hover-stable), footer with links

## Updates

To update content:
1. Edit `.html` file directly
2. Commit and push
3. Auto-redeploy (via Amplify/Netlify) OR manually upload to S3

No build step, no compilation. Pure HTML.

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Modern CSS (Grid, Flex, CSS Variables). No IE11 support.

## License

© 2026 Forge Pay (Pty) Ltd. All rights reserved.
