{{/*
Expand the name of the chart.
*/}}
{{- define "billing-engine.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "billing-engine.fullname" -}}
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
{{- define "billing-engine.labels" -}}
helm.sh/chart: {{ include "billing-engine.name" . }}-{{ .Chart.Version }}
{{ include "billing-engine.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.forgepay.io/component: billing-engine
{{- end }}

{{/*
Selector labels
*/}}
{{- define "billing-engine.selectorLabels" -}}
app.kubernetes.io/name: {{ include "billing-engine.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
