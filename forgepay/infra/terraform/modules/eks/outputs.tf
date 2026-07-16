output "cluster_name" {
  value = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}

output "cluster_ca_certificate" {
  value = aws_eks_cluster.this.certificate_authority[0].data
}

output "cluster_token" {
  value     = data.aws_eks_cluster_auth.this.token
  sensitive = true
}

output "oidc_provider_arn" {
  value = var.enable_irsa ? aws_iam_openid_connect_provider.this[0].arn : ""
}
