{{/*
Expand the name of the chart.
*/}}
{{- define "compliance-monitor.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "compliance-monitor.fullname" -}}
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
{{- define "compliance-monitor.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{ include "compliance-monitor.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "compliance-monitor.selectorLabels" -}}
app.kubernetes.io/name: {{ include "compliance-monitor.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* The image reference: by digest when one is given, otherwise by tag. */}}
{{- define "compliance-monitor.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository .Values.image.tag -}}
{{- end -}}
{{- end }}

{{/* Refuses an unsafe configuration. Rendered by the Deployment and the migration Job. */}}
{{- define "compliance-monitor.validate" -}}
{{- if .Values.image.requireDigest }}
{{- if not (regexMatch "^sha256:[0-9a-f]{64}$" (.Values.image.digest | default "")) }}
{{- fail "image.digest must be a sha256 digest (sha256:<64 hex characters>) when image.requireDigest is on: the compliance monitor is deployed by digest, never by a tag that can move" }}
{{- end }}
{{- end }}
{{- if not .Values.existingSecret }}
{{- fail "existingSecret must name the Kubernetes Secret holding DATABASE_URL, REDIS_URL, JWT_SECRET, INTERNAL_SERVICE_SECRET and SERVICE_API_KEY_HASHES" }}
{{- end }}
{{- end }}
