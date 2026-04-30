{{/*
Expand the name of the chart.
*/}}
{{- define "mor-layer.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "mor-layer.fullname" -}}
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
{{- define "mor-layer.labels" -}}
helm.sh/chart: {{ include "mor-layer.name" . }}-{{ .Chart.Version }}
{{ include "mor-layer.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.forgepay.io/component: mor-layer
{{- end }}

{{/*
Selector labels
*/}}
{{- define "mor-layer.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mor-layer.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
