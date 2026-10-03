{{/* Common naming + label helpers. */}}

{{- define "ofb.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ofb.labels" -}}
app.kubernetes.io/part-of: openfireblocks
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* Image reference for a component: registry/image:tag */}}
{{- define "ofb.image" -}}
{{- printf "%s/%s:%s" .root.Values.imageRegistry .image .tag -}}
{{- end -}}

{{/* Mutual TLS to the signer: whether it is on, and the Secrets that carry the two certificates. */}}
{{- define "ofb.signerTls.enabled" -}}
{{- if not .Values.signerApiTls.insecure -}}true{{- end -}}
{{- end -}}
{{- define "ofb.signerTls.serverSecret" -}}
{{- if .Values.signerApiTls.certManager.enabled -}}{{ include "ofb.fullname" . }}-signer-api-tls{{- else -}}{{ required "signerApiTls.serverSecret (or certManager.enabled) is required unless signerApiTls.insecure" .Values.signerApiTls.serverSecret }}{{- end -}}
{{- end -}}
{{- define "ofb.signerTls.clientSecret" -}}
{{- if .Values.signerApiTls.certManager.enabled -}}{{ include "ofb.fullname" . }}-gateway-client-tls{{- else -}}{{ required "signerApiTls.clientSecret (or certManager.enabled) is required unless signerApiTls.insecure" .Values.signerApiTls.clientSecret }}{{- end -}}
{{- end -}}
