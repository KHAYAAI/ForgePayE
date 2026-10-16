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
{{- if .digest -}}
{{- printf "%s/%s@%s" .root.Values.imageRegistry .image .digest -}}
{{- else -}}
{{- if .root.Values.requireDigests -}}
{{- fail "requireDigests is on, so every component needs a digest (apiGateway.digest, mpcSigner.digest, policyService.digest, temporalWorker.digest): custody is deployed by digest, never by a tag that can move" -}}
{{- end -}}
{{- printf "%s/%s:%s" .root.Values.imageRegistry .image .tag -}}
{{- end -}}
{{- if and .digest (not (regexMatch "^sha256:[0-9a-f]{64}$" .digest)) -}}
{{- fail (printf "a component digest must be sha256:<64 hex characters>, got %q" .digest) -}}
{{- end -}}
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
