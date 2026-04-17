{{/*
Expand the name of the chart.
*/}}
{{- define "crypto-gateway.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "crypto-gateway.fullname" -}}
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
{{- define "crypto-gateway.labels" -}}
helm.sh/chart: {{ include "crypto-gateway.name" . }}-{{ .Chart.Version }}
{{ include "crypto-gateway.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.forgepay.io/component: crypto-gateway
{{- end }}

{{/*
Selector labels
*/}}
{{- define "crypto-gateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "crypto-gateway.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
