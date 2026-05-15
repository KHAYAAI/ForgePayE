{{/*
Expand the name of the chart.
*/}}
{{- define "bank-whitelabel.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "bank-whitelabel.fullname" -}}
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
{{- define "bank-whitelabel.labels" -}}
helm.sh/chart: {{ include "bank-whitelabel.name" . }}-{{ .Chart.Version }}
{{ include "bank-whitelabel.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.forgepay.io/component: bank-whitelabel
{{- end }}

{{/*
Selector labels
*/}}
{{- define "bank-whitelabel.selectorLabels" -}}
app.kubernetes.io/name: {{ include "bank-whitelabel.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
