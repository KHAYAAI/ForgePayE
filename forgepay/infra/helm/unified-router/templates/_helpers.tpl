{{/*
Expand the name of the chart.
*/}}
{{- define "unified-router.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "unified-router.fullname" -}}
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
{{- define "unified-router.labels" -}}
helm.sh/chart: {{ include "unified-router.name" . }}-{{ .Chart.Version }}
{{ include "unified-router.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.forgepay.io/component: unified-router
{{- end }}

{{/*
Selector labels
*/}}
{{- define "unified-router.selectorLabels" -}}
app.kubernetes.io/name: {{ include "unified-router.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
