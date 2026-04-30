{{/*
Expand the name of the chart.
*/}}
{{- define "accounts-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "accounts-service.fullname" -}}
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
{{- define "accounts-service.labels" -}}
helm.sh/chart: {{ include "accounts-service.name" . }}-{{ .Chart.Version }}
{{ include "accounts-service.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.forgepay.io/component: accounts-service
{{- end }}

{{/*
Selector labels
*/}}
{{- define "accounts-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "accounts-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
