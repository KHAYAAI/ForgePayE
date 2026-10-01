{{/* Naming */}}
{{- define "mpc-node.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mpc-node.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "mpc-node.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{ include "mpc-node.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: forge-threshold-custody
app.forgepay.io/component: mpc-node
forge.io/mpc-node-id: {{ .Values.node.id | quote }}
{{- end }}

{{- define "mpc-node.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mpc-node.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "mpc-node.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "mpc-node.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "mpc-node.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}

{{- define "mpc-node.tlsSecretName" -}}
{{- if .Values.tls.certManager.enabled }}{{ include "mpc-node.fullname" . }}-tls{{ else }}{{ .Values.tls.existingSecret }}{{ end }}
{{- end }}

{{- define "mpc-node.clusterConfigMap" -}}
{{- default (printf "%s-cluster" (include "mpc-node.fullname" .)) .Values.cluster.existingConfigMap }}
{{- end }}

{{- define "mpc-node.policyConfigMap" -}}
{{- default (printf "%s-policy" (include "mpc-node.fullname" .)) .Values.policy.existingConfigMap }}
{{- end }}

{{- define "mpc-node.dataClaim" -}}
{{- default (printf "%s-data" (include "mpc-node.fullname" .)) .Values.persistence.existingClaim }}
{{- end }}

{{- define "mpc-node.vaultAgent" -}}
{{- and (eq .Values.seal.provider "vault") (eq .Values.seal.vault.auth "agent") }}
{{- end }}

{{/*
Pod annotations shared by every pod of this release. With seal.vault.auth=agent the Vault Agent Injector writes a
token file before any container starts (pre-populate only: no sidecar is left running; the node needs the key
service at start-up, not while signing).
*/}}
{{- define "mpc-node.podAnnotations" -}}
{{- with .Values.podAnnotations }}
{{ toYaml . }}
{{- end }}
{{- if eq (include "mpc-node.vaultAgent" .) "true" }}
vault.hashicorp.com/agent-inject: "true"
vault.hashicorp.com/agent-init-first: "true"
vault.hashicorp.com/agent-pre-populate-only: "true"
vault.hashicorp.com/agent-inject-token: "true"
vault.hashicorp.com/role: {{ required "seal.vault.agent.role is required with seal.vault.auth=agent" .Values.seal.vault.agent.role | quote }}
{{- with .Values.seal.vault.agent.annotations }}
{{ toYaml . }}
{{- end }}
{{- end }}
{{- end }}

{{/* Seal-key environment: everything `init`, `preflight` and `serve` need to reach the key service. */}}
{{- define "mpc-node.sealEnv" -}}
- name: MPC_ENV
  value: {{ .Values.node.env | quote }}
- name: MPC_SEAL_PROVIDER
  value: {{ .Values.seal.provider | quote }}
{{- if eq .Values.seal.provider "vault" }}
- name: VAULT_ADDR
  value: {{ .Values.seal.vault.addr | quote }}
- name: MPC_VAULT_TRANSIT_MOUNT
  value: {{ .Values.seal.vault.transitMount | quote }}
- name: MPC_VAULT_KEY
  value: {{ default (printf "mpc-node-%s" .Values.node.id) .Values.seal.vault.key | quote }}
{{- with .Values.seal.vault.namespace }}
- name: VAULT_NAMESPACE
  value: {{ . | quote }}
{{- end }}
{{- if .Values.seal.vault.caCertSecret.name }}
- name: VAULT_CACERT
  value: /etc/mpc/vault-ca/{{ .Values.seal.vault.caCertSecret.key }}
{{- end }}
{{- if eq .Values.seal.vault.auth "approle" }}
- name: VAULT_ROLE_ID
  valueFrom:
    secretKeyRef:
      name: {{ required "seal.vault.approle.existingSecret is required with seal.vault.auth=approle" .Values.seal.vault.approle.existingSecret }}
      key: {{ .Values.seal.vault.approle.roleIdKey }}
- name: VAULT_SECRET_ID
  valueFrom:
    secretKeyRef:
      name: {{ .Values.seal.vault.approle.existingSecret }}
      key: {{ .Values.seal.vault.approle.secretIdKey }}
{{- if ne .Values.seal.vault.approle.mount "approle" }}
- name: VAULT_APPROLE_MOUNT
  value: {{ .Values.seal.vault.approle.mount | quote }}
{{- end }}
{{- else }}
- name: VAULT_TOKEN_FILE
  value: {{ .Values.seal.vault.agent.tokenFile | quote }}
{{- end }}
{{- else if eq .Values.seal.provider "awskms" }}
- name: MPC_KMS_KEY_ID
  value: {{ required "seal.awskms.keyId is required (use the key ARN, not an alias)" .Values.seal.awskms.keyId | quote }}
- name: AWS_REGION
  value: {{ required "seal.awskms.region is required" .Values.seal.awskms.region | quote }}
{{- end }}
{{- end }}

{{/* Full runtime environment for `serve` and `preflight`. */}}
{{- define "mpc-node.runEnv" -}}
{{ include "mpc-node.sealEnv" . }}
- name: MPC_TLS_CA_FILE
  value: /etc/mpc/tls/{{ .Values.tls.keys.ca }}
- name: MPC_TLS_CERT_FILE
  value: /etc/mpc/tls/{{ .Values.tls.keys.cert }}
- name: MPC_TLS_KEY_FILE
  value: /etc/mpc/tls/{{ .Values.tls.keys.key }}
{{- if or .Values.policy.json .Values.policy.existingConfigMap }}
- name: MPC_NODE_POLICY_FILE
  value: /etc/mpc/policy/{{ .Values.policy.key }}
{{- end }}
{{- with .Values.node.maxValueWei }}
- name: MPC_NODE_MAX_VALUE_WEI
  value: {{ . | quote }}
{{- end }}
{{- if .Values.backup.enabled }}
- name: MPC_BACKUP_RECIPIENTS
  value: {{ join "," .Values.backup.recipients | quote }}
{{- with .Values.backup.interval }}
- name: MPC_BACKUP_INTERVAL
  value: {{ . | quote }}
{{- end }}
{{- if .Values.backup.s3.bucket }}
- name: MPC_BACKUP_S3_BUCKET
  value: {{ .Values.backup.s3.bucket | quote }}
{{- with .Values.backup.s3.prefix }}
- name: MPC_BACKUP_S3_PREFIX
  value: {{ . | quote }}
{{- end }}
{{- with .Values.backup.s3.kmsKey }}
- name: MPC_BACKUP_S3_KMS_KEY
  value: {{ . | quote }}
{{- end }}
{{- if and (ne .Values.seal.provider "awskms") .Values.backup.s3.region }}
- name: AWS_REGION
  value: {{ .Values.backup.s3.region | quote }}
{{- end }}
{{- else if .Values.backup.dir.enabled }}
- name: MPC_BACKUP_DIR
  value: {{ .Values.backup.dir.path | quote }}
{{- end }}
{{- end }}
{{- with .Values.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/* Volume mounts for a pod that reads the node's files. */}}
{{- define "mpc-node.runVolumeMounts" -}}
- name: data
  mountPath: /data
- name: tmp
  mountPath: /tmp
- name: tls
  mountPath: /etc/mpc/tls
  readOnly: true
- name: cluster
  mountPath: /etc/mpc/cluster
  readOnly: true
{{- if or .Values.policy.json .Values.policy.existingConfigMap }}
- name: policy
  mountPath: /etc/mpc/policy
  readOnly: true
{{- end }}
{{- if .Values.seal.vault.caCertSecret.name }}
- name: vault-ca
  mountPath: /etc/mpc/vault-ca
  readOnly: true
{{- end }}
{{- if and .Values.backup.enabled .Values.backup.dir.enabled (not .Values.backup.s3.bucket) }}
- name: backup
  mountPath: {{ .Values.backup.dir.path }}
{{- end }}
{{- end }}

{{- define "mpc-node.runVolumes" -}}
- name: data
  persistentVolumeClaim:
    claimName: {{ include "mpc-node.dataClaim" . }}
- name: tmp
  emptyDir:
    sizeLimit: 64Mi
- name: tls
  secret:
    secretName: {{ include "mpc-node.tlsSecretName" . }}
    defaultMode: 288 # 0440
- name: cluster
  configMap:
    name: {{ include "mpc-node.clusterConfigMap" . }}
{{- if or .Values.policy.json .Values.policy.existingConfigMap }}
- name: policy
  configMap:
    name: {{ include "mpc-node.policyConfigMap" . }}
{{- end }}
{{- if .Values.seal.vault.caCertSecret.name }}
- name: vault-ca
  secret:
    secretName: {{ .Values.seal.vault.caCertSecret.name }}
{{- end }}
{{- if and .Values.backup.enabled .Values.backup.dir.enabled (not .Values.backup.s3.bucket) }}
- name: backup
  persistentVolumeClaim:
    claimName: {{ default (printf "%s-backup" (include "mpc-node.fullname" .)) .Values.backup.dir.existingClaim }}
{{- end }}
{{- end }}

{{- define "mpc-node.nodeArgs" -}}
- -id
- {{ .Values.node.id | quote }}
- -data
- {{ .Values.node.dataDir | quote }}
- -cluster
- /etc/mpc/cluster/{{ .Values.cluster.key }}
{{- if or .Values.policy.json .Values.policy.existingConfigMap }}
- -policy
- /etc/mpc/policy/{{ .Values.policy.key }}
{{- end }}
{{- end }}

{{/* Fail early, with a readable message, on combinations that would produce a node that cannot start or is unsafe. */}}
{{- define "mpc-node.validate" -}}
{{- if not .Values.node.id }}{{ fail "node.id is required (e.g. node1); it must equal the node's certificate CN and its entry in cluster.json" }}{{ end }}
{{- if and .Values.init.enabled .Values.serve.enabled }}{{ fail "init.enabled and serve.enabled cannot both be true: run the one-time init first (serve.enabled=false), collect the identity, then upgrade with init.enabled=false serve.enabled=true" }}{{ end }}
{{- if .Values.init.enabled }}
{{- if not .Values.node.domain }}{{ fail "node.domain is required for init: the trust-domain label written into this node's public identity" }}{{ end }}
{{- if not .Values.node.url }}{{ fail "node.url is required for init: the https URL the other nodes and the coordinator reach this node at" }}{{ end }}
{{- end }}
{{- if eq .Values.node.env "production" }}
{{- if not (has .Values.seal.provider (list "vault" "awskms")) }}{{ fail "node.env=production requires seal.provider vault or awskms (file/env keep the seal key next to the data)" }}{{ end }}
{{- end }}
{{- if eq .Values.seal.provider "vault" }}
{{- if not .Values.seal.vault.addr }}{{ fail "seal.vault.addr is required with seal.provider=vault" }}{{ end }}
{{- if not (has .Values.seal.vault.auth (list "approle" "agent")) }}{{ fail "seal.vault.auth must be approle or agent" }}{{ end }}
{{- end }}
{{- if or .Values.serve.enabled .Values.preflight.job.enabled }}
{{- if not (or .Values.tls.existingSecret .Values.tls.certManager.enabled) }}{{ fail "mutual TLS is required: set tls.existingSecret or tls.certManager.enabled" }}{{ end }}
{{- if not (or .Values.cluster.json .Values.cluster.existingConfigMap) }}{{ fail "cluster.json (or cluster.existingConfigMap) is required to serve or run preflight; build it from every node's identity.json with `mpc-node cluster`" }}{{ end }}
{{- if and (not .Values.policy.json) (not .Values.policy.existingConfigMap) (not .Values.policy.allowEmpty) }}{{ fail "no node policy configured: a node without one co-signs anything the coordinator asks. Set policy.json / policy.existingConfigMap, or policy.allowEmpty=true to accept that" }}{{ end }}
{{- end }}
{{- if and .Values.serve.enabled (eq .Values.node.env "production") }}
{{- if not .Values.backup.enabled }}{{ fail "node.env=production requires key-share backups: set backup.enabled=true with backup.recipients and an s3 bucket or dir" }}{{ end }}
{{- end }}
{{- if .Values.backup.enabled }}
{{- if not .Values.backup.recipients }}{{ fail "backup.recipients is required (public recovery keys, fprec1:...)" }}{{ end }}
{{- if and .Values.backup.s3.bucket .Values.backup.dir.enabled }}{{ fail "choose ONE backup sink: backup.s3.bucket or backup.dir.enabled" }}{{ end }}
{{- if and (not .Values.backup.s3.bucket) (not .Values.backup.dir.enabled) }}{{ fail "backup.enabled needs a sink: backup.s3.bucket or backup.dir.enabled" }}{{ end }}
{{- end }}
{{- end }}
