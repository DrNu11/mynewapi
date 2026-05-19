package openai

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
)

// sensitiveFields are JSON keys that may leak upstream-provider details.
// They are removed wherever they appear, regardless of nesting depth.
var sensitiveFields = map[string]struct{}{
	"system_fingerprint": {}, // OpenAI / clones
	"reasoning_content":  {}, // DeepSeek / Mimo / various reasoning channels
	"reasoning":          {}, // OpenRouter / some adapters
	"provider_model_id":  {}, // some routing adapters expose this
	"upstream_model":     {}, // defensive: any field that literally names this
	"upstream_model_name": {},
}

// HideUpstreamInJSON sanitizes a response payload so it leaks no information
// about the actual upstream provider. It applies three independent passes
// recursively at any nesting depth:
//
//  1. Field deletion:   removes `system_fingerprint`, `reasoning_content`,
//     `reasoning`, `provider_model_id`, `upstream_model(_name)`.
//  2. Model rewrite:    replaces every `model` string field with the model
//     name the client originally requested (`info.OriginModelName`).
//  3. String scrubbing: in every string value, replaces literal occurrences
//     of the upstream model name with the origin model name — this catches
//     leaks inside `error.message`, `detail`, `description`, log lines, etc.
//
// Fail-open: if the JSON cannot be parsed or required context is missing,
// the original bytes are returned untouched (so relay never breaks).
func HideUpstreamInJSON(c *gin.Context, data []byte, info *relaycommon.RelayInfo) []byte {
	if len(data) == 0 {
		return data
	}

	originModel, upstreamModels := resolveModelNames(c, info)

	// Quick exit: nothing to do at all.
	if originModel == "" && len(upstreamModels) == 0 {
		return data
	}

	var raw interface{}
	if err := common.Unmarshal(data, &raw); err != nil {
		// Not a JSON object (e.g. SSE control line, plain text error). We
		// can still scrub literal upstream names from the raw bytes.
		if len(upstreamModels) > 0 {
			return []byte(scrubString(string(data), originModel, upstreamModels))
		}
		return data
	}

	sanitize(&raw, originModel, upstreamModels)

	out, err := common.Marshal(raw)
	if err != nil {
		return data
	}
	return out
}

// HideUpstreamInString is a string-typed convenience wrapper used by stream
// handlers that pass SSE chunks as strings.
func HideUpstreamInString(c *gin.Context, data string, info *relaycommon.RelayInfo) string {
	if data == "" {
		return data
	}
	return string(HideUpstreamInJSON(c, []byte(data), info))
}

// resolveModelNames returns the client-facing name and the list of upstream
// names that must be scrubbed from any string value.
func resolveModelNames(c *gin.Context, info *relaycommon.RelayInfo) (string, []string) {
	var originModel, upstream string
	if info != nil {
		originModel = info.OriginModelName
		upstream = info.UpstreamModelName
	}
	if originModel == "" {
		originModel = common.GetContextKeyString(c, constant.ContextKeyOriginalModel)
	}

	var upstreamModels []string
	if upstream != "" && upstream != originModel {
		upstreamModels = append(upstreamModels, upstream)
	}
	return originModel, upstreamModels
}

// sanitize walks a JSON value (parsed via common.Unmarshal) recursively and
// applies all three sanitization passes in-place.
func sanitize(node *interface{}, originModel string, upstreamModels []string) {
	if node == nil || *node == nil {
		return
	}
	switch v := (*node).(type) {
	case map[string]interface{}:
		sanitizeMap(v, originModel, upstreamModels)
	case []interface{}:
		for i := range v {
			sanitize(&v[i], originModel, upstreamModels)
		}
	case string:
		scrubbed := scrubString(v, originModel, upstreamModels)
		if scrubbed != v {
			*node = scrubbed
		}
	}
}

// sanitizeMap removes sensitive keys, rewrites `model`, and recurses into
// every other value.
func sanitizeMap(m map[string]interface{}, originModel string, upstreamModels []string) {
	// 1. drop sensitive fields at this level (any nesting)
	for k := range sensitiveFields {
		delete(m, k)
	}

	// 2. rewrite `model` if present and we know the origin name
	if originModel != "" {
		if cur, ok := m["model"]; ok {
			if _, isStr := cur.(string); isStr {
				m["model"] = originModel
			}
			// if `model` is an object/array, fall through and recurse
		}
	}

	// 3. recurse into remaining values
	for k, v := range m {
		if k == "model" {
			if _, isStr := v.(string); isStr {
				continue // already handled by step 2
			}
		}
		sanitize(&v, originModel, upstreamModels)
		m[k] = v
	}
}

// scrubString replaces literal occurrences of any upstream model name in s
// with the origin model name. This catches leaks in human-readable strings.
func scrubString(s, originModel string, upstreamModels []string) string {
	if s == "" || len(upstreamModels) == 0 {
		return s
	}
	out := s
	for _, um := range upstreamModels {
		if um == "" || um == originModel {
			continue
		}
		out = strings.ReplaceAll(out, um, originModel)
	}
	return out
}
