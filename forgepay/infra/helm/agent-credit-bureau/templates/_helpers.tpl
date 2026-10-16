{{/* The image reference: by digest when one is given, otherwise by tag. */}}
{{- define "agent-credit-bureau.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository .Values.image.tag -}}
{{- end -}}
{{- end }}

{{/* Refuses an unsafe image configuration. Rendered by the Deployment. */}}
{{- define "agent-credit-bureau.validate" -}}
{{- if .Values.image.requireDigest }}
{{- if not (regexMatch "^sha256:[0-9a-f]{64}$" (.Values.image.digest | default "")) }}
{{- fail "image.digest must be a sha256 digest (sha256:<64 hex characters>) when image.requireDigest is on: the bureau is deployed by digest, never by a tag that can move" }}
{{- end }}
{{- end }}
{{- end }}
