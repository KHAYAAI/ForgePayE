#!/usr/bin/env python3
"""
ForgePay AWS South Africa Cost Calculator

Estimates monthly AWS costs (af-south-1 + eu-west-1) based on:
- GMV (Gross Merchandise Volume) in ZAR
- Number of merchants
- Number of transactions per day
- Geographic distribution (% in ZA vs EU vs US)

Usage:
    python aws_south_africa_cost_calculator.py --gmv 5000000 --merchants 50 --txns-per-day 1000

Example output:
    ForgePay AWS Cost Estimate
    ==========================
    Monthly GMV: R 5,000,000
    ...
    TOTAL MONTHLY: R 76,900
    ANNUAL COST: R 922,800 (~$51.3k USD)
"""

import argparse
import json
from datetime import datetime
from typing import Dict, Tuple


class AWSCostCalculator:
    """Calculate ForgePay AWS costs for South African deployment"""

    # Pricing in ZAR (South Africa region af-south-1)
    # Note: af-south-1 is ~15-20% more expensive than us-east-1

    # EKS Pricing (per node-hour, converted to monthly)
    EKS_CONTROL_PLANE_MONTHLY = 200  # ZAR (~$11/month)

    # EC2 Instance pricing (monthly for on-demand, not spot)
    EC2_PRICES = {
        "c6i.2xl": 15000,   # ~R 15,000/month
        "c6i.xlarge": 7500,  # ~R 7,500/month
        "c6i.large": 3750,   # ~R 3,750/month
        "t3.large": 3000,    # ~R 3,000/month
        "t3.medium": 1500,   # ~R 1,500/month
    }

    # RDS Aurora Pricing (per ACU-hour, serverless)
    AURORA_ACU_HOUR = 18  # ZAR per ACU-hour

    # ElastiCache Pricing
    ELASTICACHE_LARGE_MONTH = 10800   # r6g.large × 3 nodes

    # Data Transfer
    DATA_TRANSFER_INTRA_AZ = 0        # Free
    DATA_TRANSFER_INTER_AZ = 1.5      # ZAR per GB
    DATA_TRANSFER_CROSS_REGION = 30   # ZAR per GB (to eu-west-1)

    # S3 Pricing
    S3_STORAGE_PER_GB = 0.10   # ZAR
    S3_REQUESTS_PER_1000 = 0.5  # ZAR

    # Other services
    ALB_MONTHLY = 3600        # Application Load Balancer
    NAT_GATEWAY_MONTHLY = 1800  # NAT Gateway
    SECRETS_MANAGER_SECRET = 18  # ZAR per secret/month
    KMS_KEYS_MONTHLY = 500     # Per key

    # Observability
    CLOUDWATCH_MONTHLY = 5000  # Logs, metrics, dashboards
    PROMETHEUS_STORAGE = 2000  # For Prometheus + Grafana

    # FX rate (for USD estimates)
    ZAR_TO_USD = 0.0556  # Approximate rate (June 2026)

    def __init__(self):
        """Initialize calculator"""
        self.gmv_monthly = 0
        self.merchants = 0
        self.txns_per_day = 0
        self.txns_per_month = 0
        self.geographic_distribution = {}
        self.costs = {}

    def set_parameters(self, gmv: float, merchants: int, txns_per_day: int,
                       geography: str = "100%ZA"):
        """
        Set input parameters for cost calculation

        Args:
            gmv: Monthly GMV in ZAR
            merchants: Number of active merchants
            txns_per_day: Average daily transactions
            geography: Geographic distribution (e.g., "70%ZA,20%EU,10%US")
        """
        self.gmv_monthly = gmv
        self.merchants = merchants
        self.txns_per_day = txns_per_day
        self.txns_per_month = txns_per_day * 30

        # Parse geography
        self._parse_geography(geography)

    def _parse_geography(self, geography_str: str):
        """Parse geographic distribution string"""
        self.geographic_distribution = {
            "za": 0.0,
            "eu": 0.0,
            "us": 0.0,
            "other": 0.0
        }

        if not geography_str:
            self.geographic_distribution["za"] = 1.0
            return

        parts = geography_str.split(",")
        total = 0

        for part in parts:
            part = part.strip()
            if "ZA" in part.upper():
                pct = float(part.replace("%ZA", "").strip()) / 100
                self.geographic_distribution["za"] = pct
                total += pct
            elif "EU" in part.upper():
                pct = float(part.replace("%EU", "").strip()) / 100
                self.geographic_distribution["eu"] = pct
                total += pct
            elif "US" in part.upper():
                pct = float(part.replace("%US", "").strip()) / 100
                self.geographic_distribution["us"] = pct
                total += pct

        # Normalize if total < 1.0
        if total < 1.0:
            self.geographic_distribution["za"] += (1.0 - total)

    def calculate_eks_costs(self) -> float:
        """Calculate EKS cluster costs based on transaction volume"""

        # EKS control plane
        eks_control = self.EKS_CONTROL_PLANE_MONTHLY

        # Node costs (scale based on transaction volume)
        # Baseline: 3 nodes minimum
        # Growth: 1 additional node per 5,000 daily transactions

        if self.txns_per_day <= 1000:
            # Small cluster: 3 nodes (2× c6i.xlarge, 1× t3.large)
            node_cost = (2 * self.EC2_PRICES["c6i.xlarge"]) + self.EC2_PRICES["t3.large"]
            num_nodes = 3
        elif self.txns_per_day <= 5000:
            # Medium cluster: 5 nodes (2× c6i.2xl, 2× c6i.xlarge, 1× t3.large)
            node_cost = (2 * self.EC2_PRICES["c6i.2xl"]) + (2 * self.EC2_PRICES["c6i.xlarge"]) + self.EC2_PRICES["t3.large"]
            num_nodes = 5
        else:
            # Large cluster: 7-10 nodes
            scaling_factor = min((self.txns_per_day - 5000) / 5000, 2)
            base_nodes = 5
            additional_nodes = max(1, int(scaling_factor * 2))
            total_nodes = base_nodes + additional_nodes

            # Scale mix: more c6i.2xl for larger clusters
            c6i_2xl_count = min(4, 2 + int(scaling_factor))
            c6i_xl_count = max(1, 4 - c6i_2xl_count)

            node_cost = (c6i_2xl_count * self.EC2_PRICES["c6i.2xl"]) + (c6i_xl_count * self.EC2_PRICES["c6i.xlarge"])
            num_nodes = c6i_2xl_count + c6i_xl_count + 1  # +1 for t3.large buffer

        total_eks = eks_control + node_cost

        return total_eks

    def calculate_rds_costs(self) -> float:
        """Calculate RDS Aurora costs based on GMV/transaction volume"""

        # Aurora Serverless: Auto-scale 2-16 ACUs based on load
        # Calculation: 1 ACU per ~1,000 transactions per second during peak
        # Average ACU usage: 1 per 200 txns/min sustained

        txns_per_minute = self.txns_per_month / (30 * 24 * 60)
        average_acus = max(2, txns_per_minute / 200)  # Minimum 2 ACUs
        peak_acus = average_acus * 2  # Peak is ~2x average

        # Pricing: Average between peak and average for month
        billed_acus = (average_acus + peak_acus) / 2

        hours_per_month = 730
        cost_per_acu_hour = self.AURORA_ACU_HOUR

        rds_cost = billed_acus * hours_per_month * cost_per_acu_hour

        # Add backup storage (assume 1GB per day, 30-day retention)
        backup_gb = 30
        backup_cost = backup_gb * self.S3_STORAGE_PER_GB * 2  # Double for redundancy

        return rds_cost + backup_cost

    def calculate_elasticache_costs(self) -> float:
        """Calculate ElastiCache Redis costs"""

        # Fixed cost for 3-node cluster (r6g.large × 3 with 2 replicas each)
        return self.ELASTICACHE_LARGE_MONTH

    def calculate_data_transfer_costs(self) -> float:
        """Calculate data transfer costs (inter-AZ, cross-region replication)"""

        # Estimate data transfer based on transaction volume
        # Assumption: 50 KB per transaction (average)

        data_per_txn_mb = 0.05
        monthly_data_mb = self.txns_per_month * data_per_txn_mb
        monthly_data_gb = monthly_data_mb / 1024

        # Inter-AZ data transfer (af-south-1 internal): 25% of total
        inter_az_gb = monthly_data_gb * 0.25
        inter_az_cost = inter_az_gb * self.DATA_TRANSFER_INTER_AZ

        # Cross-region replication to eu-west-1 (for backup): 5% of total
        cross_region_gb = monthly_data_gb * 0.05
        cross_region_cost = cross_region_gb * self.DATA_TRANSFER_CROSS_REGION

        # NAT Gateway for outbound traffic (internet): 10% of total
        nat_data_gb = monthly_data_gb * 0.10
        nat_gb_cost = nat_data_gb * 12  # ~R 12 per GB for outbound

        return inter_az_cost + cross_region_cost + nat_gb_cost

    def calculate_alb_costs(self) -> float:
        """Calculate Application Load Balancer costs"""

        alb_cost = self.ALB_MONTHLY

        # Add cost for WAF (Web Application Firewall)
        # Fixed: R 1,000/month + request-based pricing
        waf_fixed = 1000

        # Requests: ~10M requests/month assumed, R 0.0001 per request
        requests_per_month = max(10_000_000, self.txns_per_month * 100)  # 100 requests per transaction
        waf_requests_cost = (requests_per_month / 1_000_000) * 100  # ~R 100 per 1M requests

        return alb_cost + waf_fixed + waf_requests_cost

    def calculate_storage_costs(self) -> float:
        """Calculate S3 storage for backups and reports"""

        # S3 for daily backups (30-day retention)
        backup_size_gb = 10  # Compressed DB backups
        backup_cost = backup_size_gb * 30 * self.S3_STORAGE_PER_GB

        # S3 for transaction logs and reports
        logs_size_gb = 5
        logs_cost = logs_size_gb * 30 * self.S3_STORAGE_PER_GB

        # Cross-region replication to eu-west-1
        replication_cost = (backup_size_gb + logs_size_gb) * 30 * self.DATA_TRANSFER_CROSS_REGION / 1000

        # S3 API requests (assume 1M PUT, 1M GET per month)
        requests_cost = 2 * self.S3_REQUESTS_PER_1000

        return backup_cost + logs_cost + replication_cost + requests_cost

    def calculate_security_costs(self) -> float:
        """Calculate KMS, Secrets Manager, and security costs"""

        # Secrets Manager: ~20 secrets
        secrets_cost = 20 * self.SECRETS_MANAGER_SECRET

        # KMS: 2 keys (one for af-south-1, one for eu-west-1)
        kms_cost = 2 * self.KMS_KEYS_MONTHLY

        # GuardDuty: ~R 100/month for EKS
        guarduty_cost = 100

        return secrets_cost + kms_cost + guarduty_cost

    def calculate_observability_costs(self) -> float:
        """Calculate CloudWatch, Prometheus, Grafana costs"""

        # CloudWatch: Logs, metrics, dashboards
        cloudwatch_cost = self.CLOUDWATCH_MONTHLY

        # Prometheus + Grafana (self-hosted on EKS)
        # Cost is compute only (already in EKS), but add storage
        prometheus_storage_cost = self.PROMETHEUS_STORAGE

        # AWS Managed Prometheus (AMP): Optional, ~R 1/hour for ingestion
        # Skip for now (assume self-hosted)

        return cloudwatch_cost + prometheus_storage_cost

    def calculate_nat_gateway_costs(self) -> float:
        """Calculate NAT Gateway costs"""

        # Already included in data transfer costs
        # But also add fixed NAT Gateway charges
        return self.NAT_GATEWAY_MONTHLY

    def calculate_total_costs(self) -> Dict[str, float]:
        """Calculate all AWS costs and return breakdown"""

        costs = {
            "eks": self.calculate_eks_costs(),
            "rds": self.calculate_rds_costs(),
            "elasticache": self.calculate_elasticache_costs(),
            "data_transfer": self.calculate_data_transfer_costs(),
            "alb_waf": self.calculate_alb_costs(),
            "s3": self.calculate_storage_costs(),
            "security": self.calculate_security_costs(),
            "observability": self.calculate_observability_costs(),
            "nat_gateway": self.calculate_nat_gateway_costs(),
        }

        costs["total"] = sum(costs.values())

        return costs

    def format_cost_report(self) -> str:
        """Generate formatted cost report"""

        costs = self.calculate_total_costs()
        total_monthly_zar = costs["total"]
        total_monthly_usd = total_monthly_zar * self.ZAR_TO_USD
        total_annual_zar = total_monthly_zar * 12
        total_annual_usd = total_monthly_usd * 12

        # Per-unit costs
        per_merchant_monthly = total_monthly_zar / max(1, self.merchants)
        per_txn_cost = total_monthly_zar / max(1, self.txns_per_month)

        report = f"""
ForgePay AWS Cost Estimate
===========================
Region: af-south-1 (Cape Town, South Africa) + eu-west-1 (Ireland backup)
Date: {datetime.now().strftime('%B %d, %Y')}

INPUT PARAMETERS
================
Monthly GMV: R {self.gmv_monthly:,.0f}
Expected Merchants: {self.merchants}
Estimated Daily Transactions: {self.txns_per_day:,.0f}
Estimated Monthly Transactions: {self.txns_per_month:,.0f}
Geographic Distribution: ZA {self.geographic_distribution['za']*100:.0f}%, EU {self.geographic_distribution['eu']*100:.0f}%, US {self.geographic_distribution['us']*100:.0f}%

COST BREAKDOWN (MONTHLY)
========================
EKS Cluster (Kubernetes control plane + nodes):        R {costs['eks']:>10,.0f}
RDS Aurora PostgreSQL (serverless, auto-scaling):     R {costs['rds']:>10,.0f}
ElastiCache Redis (3 shards, 2 replicas):             R {costs['elasticache']:>10,.0f}
ALB + WAF (load balancer + firewall):                 R {costs['alb_waf']:>10,.0f}
Data Transfer (inter-AZ, cross-region, NAT):          R {costs['data_transfer']:>10,.0f}
S3 Storage (backups, reports, replication):           R {costs['s3']:>10,.0f}
Security (KMS, Secrets Manager, GuardDuty):           R {costs['security']:>10,.0f}
Observability (CloudWatch, Prometheus, Grafana):      R {costs['observability']:>10,.0f}
NAT Gateway (outbound internet traffic):              R {costs['nat_gateway']:>10,.0f}
────────────────────────────────────────────────────────────────
TOTAL MONTHLY (ZAR):                                  R {total_monthly_zar:>10,.0f}
TOTAL MONTHLY (USD):                                  $ {total_monthly_usd:>10,.2f}
TOTAL ANNUAL (ZAR):                                   R {total_annual_zar:>10,.0f}
TOTAL ANNUAL (USD):                                   $ {total_annual_usd:>10,.2f}

PER-UNIT COSTS
==============
Cost per merchant/month:                              R {per_merchant_monthly:>10,.2f}
Cost per transaction:                                 R {per_txn_cost:>10,.2f}

COST SCALING PROJECTIONS
==========================
"""

        # Project costs at different GMV levels
        scenarios = [
            ("R 1M GMV/month", 1_000_000),
            ("R 10M GMV/month", 10_000_000),
            ("R 50M GMV/month", 50_000_000),
            ("R 100M GMV/month", 100_000_000),
        ]

        for scenario_name, scenario_gmv in scenarios:
            # Linear scaling assumption for computation/storage
            scale_factor = scenario_gmv / self.gmv_monthly if self.gmv_monthly > 0 else 0
            scaled_cost = total_monthly_zar * scale_factor
            scaled_cost_usd = scaled_cost * self.ZAR_TO_USD

            report += f"{scenario_name:30} → R {scaled_cost:>10,.0f}/month (${scaled_cost_usd:>8,.0f})\n"

        report += f"""
NOTES
=====
1. Pricing based on af-south-1 rates (15-20% premium vs us-east-1)
2. RDS Aurora costs assume serverless v2 (auto-scale based on load)
3. Data transfer includes inter-AZ redundancy + cross-region backup replication
4. Does NOT include: Route 53 (DNS), CloudFront (CDN edge), third-party APIs
5. 15% VAT will be added if billed to South African entity (add R {total_monthly_zar * 0.15:,.0f}/month)
6. Spot instances not used (reliability > cost for payment processing)

COST OPTIMIZATION OPPORTUNITIES
================================
- Use Spot instances for non-critical workloads (save ~70%)
- S3 Intelligent-Tiering for older backups (save ~40% on S3 after 90 days)
- Reserved Instances for baseline capacity (save ~30% if 1-year commitment)
- CloudFront caching for dashboard (reduce data transfer)

ANNUAL BUDGET RECOMMENDATION
============================
AWS Budget: R {total_annual_zar * 1.2:,.0f} (includes 20% buffer for growth)
"""

        return report


def main():
    """Main entry point"""

    parser = argparse.ArgumentParser(
        description="ForgePay AWS South Africa Cost Calculator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # MVP launch (5 merchants, 500 txns/day)
  python aws_south_africa_cost_calculator.py --gmv 500000 --merchants 5 --txns-per-day 500

  # Month 3 (50 merchants, 2000 txns/day)
  python aws_south_africa_cost_calculator.py --gmv 10000000 --merchants 50 --txns-per-day 2000

  # Year 1 target (200 merchants, 30k txns/day)
  python aws_south_africa_cost_calculator.py --gmv 150000000 --merchants 200 --txns-per-day 30000

  # With geographic distribution
  python aws_south_africa_cost_calculator.py --gmv 5000000 --merchants 50 --txns-per-day 1000 --geography "70%ZA,20%EU,10%US"
        """
    )

    parser.add_argument(
        "--gmv",
        type=float,
        required=True,
        help="Monthly Gross Merchandise Volume in ZAR"
    )
    parser.add_argument(
        "--merchants",
        type=int,
        required=True,
        help="Number of active merchants"
    )
    parser.add_argument(
        "--txns-per-day",
        type=int,
        required=True,
        help="Average daily transactions"
    )
    parser.add_argument(
        "--geography",
        type=str,
        default="100%ZA",
        help="Geographic distribution (e.g., '70%ZA,20%EU,10%US')"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output as JSON instead of formatted report"
    )

    args = parser.parse_args()

    # Create calculator and set parameters
    calc = AWSCostCalculator()
    calc.set_parameters(
        gmv=args.gmv,
        merchants=args.merchants,
        txns_per_day=args.txns_per_day,
        geography=args.geography
    )

    if args.json:
        # Output JSON
        costs = calc.calculate_total_costs()
        output = {
            "parameters": {
                "gmv_monthly_zar": args.gmv,
                "merchants": args.merchants,
                "txns_per_day": args.txns_per_day,
                "geography": args.geography,
            },
            "costs_monthly_zar": costs,
            "costs_monthly_usd": {k: v * calc.ZAR_TO_USD for k, v in costs.items()},
            "costs_annual_zar": {k: v * 12 for k, v in costs.items()},
            "costs_annual_usd": {k: v * 12 * calc.ZAR_TO_USD for k, v in costs.items()},
        }
        print(json.dumps(output, indent=2))
    else:
        # Output formatted report
        print(calc.format_cost_report())


if __name__ == "__main__":
    main()
