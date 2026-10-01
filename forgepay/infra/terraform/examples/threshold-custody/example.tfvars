# Placeholders only — account ids, ARNs and names are illustrative. No secrets belong in this file.
environment = "staging"

gateway_role_arn       = "arn:aws:iam::111111111111:role/forgepay-staging-stablecoin-gateway"
gateway_role_name      = "forgepay-staging-stablecoin-gateway"
gateway_log_group_name = "/forgepay/staging/cluster"

alert_subscriptions = {
  oncall_email = { protocol = "email", endpoint = "custody-oncall@example.com" }
}

backup_region  = "us-east-1"
backup_profile = "backup-operator"

node1_region          = "eu-west-1"
node1_profile         = "node1-operator"
node1_role_arn        = "arn:aws:iam::222222222222:role/mpc-node1"
node1_pruner_role_arn = "arn:aws:iam::222222222222:role/mpc-node1" # same role: the node prunes
node1_backup_bucket   = "example-node1-mpc-share-backups"

node2_region          = "af-south-1"
node2_profile         = "node2-operator"
node2_role_arn        = "arn:aws:iam::333333333333:role/mpc-node2"
node2_pruner_role_arn = "arn:aws:iam::333333333333:role/mpc-node2"
node2_backup_bucket   = "example-node2-mpc-share-backups"
