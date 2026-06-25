{{/*
Expand the name of the chart.
*/}}
{{- define "yield-engine.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "yield-engine.fullname" -}}
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
{{- define "yield-engine.labels" -}}
helm.sh/chart: {{ include "yield-engine.name" . }}-{{ .Chart.Version }}
{{ include "yield-engine.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.forgepay.io/component: yield-engine
{{- end }}

{{/*
Selector labels
*/}}
{{- define "yield-engine.selectorLabels" -}}
app.kubernetes.io/name: {{ include "yield-engine.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
