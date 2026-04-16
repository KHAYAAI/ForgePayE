{{/*
Expand the name of the chart.
*/}}
{{- define "forgepay-monitoring.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "forgepay-monitoring.labels" -}}
helm.sh/chart: {{ include "forgepay-monitoring.name" . }}-{{ .Chart.Version }}
app.kubernetes.io/name: {{ include "forgepay-monitoring.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
platform: forgepay
{{- end }}
