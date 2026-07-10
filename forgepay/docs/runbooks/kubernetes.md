# Runbook: Kubernetes / Cluster-Level Incident Response

Cross-cutting operational guidance for the ~25-service ForgePay fleet,
deployed via the `forgepay-stack` umbrella Helm chart (each service is an
independent sub-chart).

### Symptom: A pod won't start / CrashLoopBackOff

**Resolution:**
1. `kubectl logs -n forgepay-prod <pod> --previous` (the `--previous`
   flag is essential — the current crash's logs may be truncated or
   empty if it died instantly on startup).
2. Common startup-time causes in this fleet specifically:
   - A required env var/secret missing (most services `throw` at config
     load time rather than defaulting silently — this is intentional
     fail-fast behavior, not usually a bug).
   - `runMigrations()` failing because Postgres isn't reachable yet
     (check pod start ordering / readiness gates — see `database.md`).
   - A Helm chart bug causing malformed YAML to actually apply (verify
     with `kubectl get <resource> -o yaml` that what's *running* matches
     what you expect from the chart's templates — this fleet had several
     charts with corrupted/mismatched Helm template syntax that would
     have either failed to render at all or rendered garbage; if a
     resource looks wrong, check the source template rendered correctly
     rather than assuming the running config is the chart's intent).

### Symptom: Node drain / cluster upgrade stalls on a specific pod

**Cause:** A PodDisruptionBudget with `minAvailable` set higher than
what's actually schedulable elsewhere blocks eviction indefinitely — this
is by design (protects availability) but can stall an unrelated
maintenance operation if under-capacity.

**Resolution:**
1. `kubectl get pdb -n forgepay-prod` — find which PDB is blocking.
2. Confirm there's genuinely no room to schedule a replacement pod
   elsewhere before considering a temporary `kubectl patch` to loosen the
   PDB — don't loosen it reflexively, that defeats its purpose.
3. Services intentionally have **no** PDB at `replicaCount: 1`
   (agent-credit-bureau, agent-negotiation, billing-engine, chain-sync,
   rwa-registry as of this writing) — a `minAvailable: 1` PDB on a
   single-replica deployment would block the only pod from ever being
   evicted, stalling drains rather than protecting availability. If one
   of these is blocking a drain, something regressed the intentional
   `podDisruptionBudget.enabled: false` default.

### Symptom: Service A can't reach Service B (connection refused / timeout)

**Cause:** Every service in this fleet has a NetworkPolicy allowing
same-namespace pod-to-pod traffic by default — if two services in the
*same* namespace can't reach each other, it's very unlikely to be the
NetworkPolicy (check that first, but don't stop there). Cross-namespace
traffic (e.g. from `monitoring` or `ingress-nginx`) is more likely to be
the actual NetworkPolicy boundary in play.

**Resolution:**
1. `kubectl get networkpolicy -n <namespace> <service> -o yaml` — confirm
   the podSelector actually matches the target pod's labels (a label
   typo here silently makes the policy match nothing, appearing to work
   in `helm template` but not enforcing anything real, or worse,
   enforcing against zero pods and effectively blocking everything if
   the *source* selector is wrong).
2. Check whether the target's Service has a correctly *named* port that
   the NetworkPolicy references by name (`port: http`) — several charts
   in this fleet had Deployments with unnamed container ports that a
   named-port NetworkPolicy/ServiceMonitor rule couldn't resolve against.
   `kubectl get pod <pod> -o jsonpath='{.spec.containers[0].ports}'` to
   check.
3. For genuinely cross-namespace traffic (Prometheus scraping, ingress
   controller): confirm the source namespace has the expected
   `kubernetes.io/metadata.name` label matching what the NetworkPolicy's
   `namespaceSelector` expects.

### Symptom: Prometheus shows a service as down / no metrics

**Cause:** Extremely common in this fleet's history — a ServiceMonitor
pointing at a "metrics" port that nothing in the application actually
binds (every service here serves `/metrics` on its single main HTTP
port, not a separate port), or a corrupted Helm template that rendered a
broken/no-op ServiceMonitor.

**Resolution:**
1. `kubectl get servicemonitor -n forgepay-prod <service> -o yaml` and
   confirm `spec.endpoints[].port` matches an actual **named** port on
   the target Service (`kubectl get svc <service> -o yaml`).
2. `kubectl port-forward svc/<service> 8080:<port>` and `curl
   localhost:8080/metrics` directly to confirm the app-level endpoint
   works before assuming it's a Prometheus-side config issue.

### Symptom: Ingress returning 404 or default-backend response for a known host

**Cause:** Ingress backend referencing a Service name that doesn't match
what Helm actually creates. Subchart Services in this fleet are named via
each chart's own release-name-prefixed `<chart>.fullname` helper (e.g.
`forgepay-unified-router`), not the bare chart name — an Ingress
hardcoding the bare name will 404 or fail to admit.

**Resolution:**
1. `kubectl get ingress -n forgepay-prod -o yaml` and compare each rule's
   backend service name against `kubectl get svc -n forgepay-prod` —
   they must match exactly, including the release-name prefix.
2. Check `kubectl describe ingress <name>` for admission errors if the
   Ingress controller rejected a backend reference to a nonexistent
   Service entirely.
