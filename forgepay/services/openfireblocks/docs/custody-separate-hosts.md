# Putting the signing nodes on separate hosts, and proving it

**Status: the tooling is built and tested; no real separate-host deployment has been made.** Standing the nodes up needs
infrastructure (three independent places to run them) that does not exist yet. This is the procedure, and the check that
tells you whether you did it properly.

## What "separate" has to mean

A 2-of-3 key is only as safe as the cost of compromising two of its three nodes *at the same time*. That cost is high only if
the nodes share nothing an attacker could take over once. For each pair of nodes, all of these must differ:

| Shared thing | Why it matters |
|---|---|
| Machine / VM / Kubernetes node | One host compromise reads both shares |
| Cloud account, project or on-prem site (`MPC_NODE_INFRA_ID`) | One stolen admin credential or one insider reaches both |
| Seal key (KMS key, Vault key) | Whoever can use that key opens both nodes' shares |
| Operator / team | One person with access to both is one person who can sign |
| Network path to the signer API | (not checked) |

The cluster file's `domain` label groups nodes that share fate. The rule enforced everywhere (`CheckProduction`, preflight,
keygen, reshare): **no domain may hold t+1 nodes**.

## Procedure

1. **Decide three trust domains** with different owners (for example: your AWS account; a second cloud's project run by a
   different person; an on-prem or partner-run site). Write down who can administer each.
2. **One Helm release per node** in its own cluster/account: `infra/helm/mpc-node` with `values-node1/2/3.yaml` as examples.
   Set, per node: `node.id`, `node.domain` (unique, true), **`node.infraId`** (the account/project/cluster; production refuses
   to render without it), the node's *own* seal key (`seal.provider` awskms or vault; production refuses file/env), its own
   backup bucket recipient, and its own `policy.json`. `MPC_NODE_HOST_ID` is injected from the Kubernetes node name.
3. **Init each node, collect each `identity.json`**, build `cluster.json` (`mpc-node cluster`), and distribute it to every node and
   the coordinator. Mutual TLS: a private CA that all three share, certificates named by node id.
4. **Run the topology check** from the coordinator:
   `mpc-node topology -cluster cluster.json -coordinator-key coordinator.key -production`
   (or `GET /mpc/topology` on the signer). It asks each node where it says it runs and fails if two nodes report the same
   host, the same seal-key reference, or the same infrastructure in different domains; if a node's claimed domain disagrees with
   the cluster file; if a domain holds a quorum; if a node keeps its seal key in a file or the environment; or if a node
   declares no infrastructure. **Keep the output in the change record.** Re-run after any move, upgrade or re-provision.
5. Only then create keys.

## What the check can and cannot tell you

It catches the mistakes people make: two nodes scheduled onto one machine, two nodes pointed at one KMS key, a copied values
file with the same `infraId`. **It cannot catch a lie**: nodes report on themselves, so an operator who wants to hide that two
nodes share a host can. It also cannot see who administers what. Separation of *people* is a procedure, not a check: keep a
register of who can reach each node and review it when anyone joins or leaves.

Verified in tests: three real nodes in one process are reported as sharing a host and the check fails; a sound placement passes;
each failure class above is detected. Not verified: any real multi-host deployment, cross-account KMS, or the Helm releases
against real clusters (they lint and render; `infraId` and `MPC_NODE_HOST_ID` are present in the rendered output).
