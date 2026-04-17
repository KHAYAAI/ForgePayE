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
