# Vault policy for node1's AppRole. It can wrap and unwrap ONE key and nothing else,
# so a compromised node can't touch any other node's seal key.
path "transit/encrypt/mpc-node-node1" { capabilities = ["update"] }
path "transit/decrypt/mpc-node-node1" { capabilities = ["update"] }
path "transit/rewrap/mpc-node-node1"  { capabilities = ["update"] }
