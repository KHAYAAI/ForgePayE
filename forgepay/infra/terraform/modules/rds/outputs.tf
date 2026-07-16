output "db_endpoint" {
  value = aws_db_instance.this.endpoint
}

output "db_instance_id" {
  value = aws_db_instance.this.id
}

output "db_address" {
  value = aws_db_instance.this.address
}
