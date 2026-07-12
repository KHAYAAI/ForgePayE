{{/*
Compute a subchart's release-name-prefixed Service name from this
(parent/umbrella) chart's own templates.

Every subchart's own "<chart>.fullname" helper replicates Helm's standard
fullname convention, but that convention keys off *that chart's own*
`.Chart.Name` — calling `include "<chart>.fullname" $` from a *different*
chart's template passes this chart's root context, whose `.Chart.Name` is
"forgepay-stack", not the target subchart's name. Since `.Release.Name`
here IS "forgepay-stack" (the documented umbrella release name), that
bug makes `contains $name .Release.Name` evaluate true for every call
and collapses every subchart's resolved name down to just "forgepay-stack"
with no suffix at all — silently pointing every Ingress backend at the
same (nonexistent) Service.

This helper takes the target chart name as an explicit string argument
instead, so it's correct regardless of which chart's template calls it.
*/}}
{{- define "forgepay-stack.subchartFullname" -}}
{{- $ctx := index . 0 -}}
{{- $name := index . 1 -}}
{{- if contains $name $ctx.Release.Name -}}
{{- $ctx.Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" $ctx.Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
