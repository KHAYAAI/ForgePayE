{{- define "console.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "console.selectorLabels" -}}
app.kubernetes.io/name: console
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "console.labels" -}}
{{ include "console.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "console.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository .Values.image.tag -}}
{{- end -}}
{{- end -}}

{{/* Refuses to render an unsafe configuration. Rendered (and so checked) by the Deployment. */}}
{{- define "console.validate" -}}
{{- if .Values.image.requireDigest -}}
{{- if not (regexMatch "^sha256:[0-9a-f]{64}$" (.Values.image.digest | default "")) -}}
{{- fail "image.digest must be a sha256 digest (sha256:<64 hex characters>): the console is deployed by digest, never by a tag that can move" -}}
{{- end -}}
{{- else if not (or .Values.image.digest .Values.image.tag) -}}
{{- fail "set image.digest, or image.tag when requireDigest is false" -}}
{{- end -}}
{{- if eq (.Values.image.tag | default "") "latest" -}}
{{- fail "image.tag must not be latest" -}}
{{- end -}}
{{- if not .Values.secrets.existingSecret -}}
{{- fail "secrets.existingSecret is required: name the Kubernetes Secret that holds the console's secrets (no secrets are kept in chart values)" -}}
{{- end -}}
{{- if and .Values.ingress.enabled (not .Values.ingress.host) -}}
{{- fail "ingress.host is required when ingress.enabled" -}}
{{- end -}}
{{- end -}}
