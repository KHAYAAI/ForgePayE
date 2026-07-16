# VPC module — network foundation for ForgePay.
# Public subnets (ALB/NAT), private subnets (EKS nodes, RDS, ElastiCache),
# plus the DB and cache subnet groups and per-tier security groups.

locals {
  az_count = length(var.availability_zones)
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(var.tags, { Name = "forgepay-${var.environment}" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "forgepay-${var.environment}-igw" })
}

# Public subnets — one per AZ
resource "aws_subnet" "public" {
  count                   = local.az_count
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true
  tags = merge(var.tags, {
    Name                     = "forgepay-${var.environment}-public-${count.index}"
    "kubernetes.io/role/elb" = "1"
  })
}

# Private subnets — one per AZ
resource "aws_subnet" "private" {
  count             = local.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  availability_zone = var.availability_zones[count.index]
  tags = merge(var.tags, {
    Name                              = "forgepay-${var.environment}-private-${count.index}"
    "kubernetes.io/role/internal-elb" = "1"
  })
}

resource "aws_eip" "nat" {
  count  = local.az_count
  domain = "vpc"
  tags   = merge(var.tags, { Name = "forgepay-${var.environment}-nat-${count.index}" })
}

resource "aws_nat_gateway" "this" {
  count         = local.az_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = merge(var.tags, { Name = "forgepay-${var.environment}-nat-${count.index}" })
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = merge(var.tags, { Name = "forgepay-${var.environment}-public-rt" })
}

resource "aws_route_table_association" "public" {
  count          = local.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = local.az_count
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[count.index].id
  }
  tags = merge(var.tags, { Name = "forgepay-${var.environment}-private-rt-${count.index}" })
}

resource "aws_route_table_association" "private" {
  count          = local.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# ── Security groups ─────────────────────────────────────────────────────────
resource "aws_security_group" "rds" {
  name_prefix = "forgepay-${var.environment}-rds-"
  vpc_id      = aws_vpc.this.id
  description = "RDS PostgreSQL — reachable only from within the VPC"
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  lifecycle { create_before_destroy = true }
  tags = merge(var.tags, { Name = "forgepay-${var.environment}-rds-sg" })
}

resource "aws_security_group" "redis" {
  name_prefix = "forgepay-${var.environment}-redis-"
  vpc_id      = aws_vpc.this.id
  description = "ElastiCache Redis — reachable only from within the VPC"
  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  lifecycle { create_before_destroy = true }
  tags = merge(var.tags, { Name = "forgepay-${var.environment}-redis-sg" })
}

resource "aws_db_subnet_group" "this" {
  name       = "forgepay-${var.environment}-db"
  subnet_ids = aws_subnet.private[*].id
  tags       = merge(var.tags, { Name = "forgepay-${var.environment}-db-subnets" })
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "forgepay-${var.environment}-cache"
  subnet_ids = aws_subnet.private[*].id
  tags       = merge(var.tags, { Name = "forgepay-${var.environment}-cache-subnets" })
}
