{{/*
Expand the name of the chart.
*/}}
{{- define "stablecoin-gateway.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "stablecoin-gateway.fullname" -}}
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

{{/*
Common labels
*/}}
{{- define "stablecoin-gateway.labels" -}}
helm.sh/chart: {{ include "stablecoin-gateway.name" . }}-{{ .Chart.Version }}
{{ include "stablecoin-gateway.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.forgepay.io/component: stablecoin-gateway
{{- end }}

{{/*
Selector labels
*/}}
{{- define "stablecoin-gateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "stablecoin-gateway.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name.
*/}}
{{- define "stablecoin-gateway.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "stablecoin-gateway.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Container port: PORT from a map-style env, else the app default 8020.
*/}}
{{- define "stablecoin-gateway.port" -}}
{{- if and (kindIs "map" .Values.env) .Values.env.PORT }}{{ .Values.env.PORT | int }}{{ else }}8020{{ end }}
{{- end }}

{{/*
The number of replicas the chart will run at its smallest: the HPA's minimum when autoscaling, else replicaCount.
*/}}
{{- define "stablecoin-gateway.minReplicas" -}}
{{- if .Values.autoscaling.enabled }}{{ .Values.autoscaling.minReplicas }}{{ else }}{{ .Values.replicaCount }}{{ end }}
{{- end }}

{{/*
Whether more than one replica can ever run.
*/}}
{{- define "stablecoin-gateway.multiReplica" -}}
{{- if or .Values.autoscaling.enabled (gt (int .Values.replicaCount) 1) }}true{{ else }}false{{ end }}
{{- end }}

{{/*
Refuse configurations that would put money-moving workers in more than one place, or enable a worker without its key.
*/}}
{{- define "stablecoin-gateway.validate" -}}
{{- if and (eq (include "stablecoin-gateway.multiReplica" .) "true") (not .Values.leaderLock.enabled) }}
{{- fail "replicaCount > 1 (or autoscaling) requires leaderLock.enabled=true: the settlement, payout, sweeper and treasury workers must run in exactly ONE replica. With leaderLock.enabled=false set replicaCount=1 and autoscaling.enabled=false." }}
{{- end }}
{{- if and .Values.payout.signerEnabled (not .Values.payout.keySecret.name) }}
{{- fail "payout.signerEnabled=true needs payout.keySecret.name (the key is read from a mounted file, PAYOUT_SIGNER_KEY_FILE)" }}
{{- end }}
{{- if .Values.sweep.enabled }}
{{- if not .Values.sweep.treasuryAddress }}{{ fail "sweep.enabled=true needs sweep.treasuryAddress (the operating wallet)" }}{{ end }}
{{- if not .Values.sweep.gasKeySecret.name }}{{ fail "sweep.enabled=true needs sweep.gasKeySecret.name (a separate gas wallet key file)" }}{{ end }}
{{- end }}
{{- if .Values.treasury.enabled }}
{{- if not .Values.payout.signerEnabled }}{{ fail "treasury.enabled=true needs payout.signerEnabled=true: the treasury tops up the payout wallet" }}{{ end }}
{{- if not .Values.treasury.operatingKeySecret.name }}{{ fail "treasury.enabled=true needs treasury.operatingKeySecret.name" }}{{ end }}
{{- end }}
{{- if eq .Values.keyWrap.provider "vault" }}
{{- if not .Values.keyWrap.vault.addr }}{{ fail "keyWrap.provider=vault needs keyWrap.vault.addr" }}{{ end }}
{{- if not .Values.keyWrap.vault.approleSecret.name }}{{ fail "keyWrap.provider=vault needs keyWrap.vault.approleSecret.name (VAULT_ROLE_ID / VAULT_SECRET_ID); or supply VAULT_TOKEN_FILE through config and extra volumes" }}{{ end }}
{{- else if eq .Values.keyWrap.provider "awskms" }}
{{- if not .Values.keyWrap.awskms.keyId }}{{ fail "keyWrap.provider=awskms needs keyWrap.awskms.keyId (the key ARN)" }}{{ end }}
{{- if not .Values.keyWrap.awskms.region }}{{ fail "keyWrap.provider=awskms needs keyWrap.awskms.region" }}{{ end }}
{{- else if and .Values.keyWrap.provider (ne .Values.keyWrap.provider "env") }}
{{- fail "keyWrap.provider must be vault, awskms, env or empty" }}
{{- end }}
{{- end }}

{{/*
Plain environment from `env` (map, or the legacy list of {name,value}).
*/}}
{{- define "stablecoin-gateway.plainEnv" -}}
{{- if kindIs "map" .Values.env }}
{{- range $k, $v := .Values.env }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- else if .Values.env }}
{{- toYaml .Values.env | nindent 0 }}
{{- end }}
{{- end }}
