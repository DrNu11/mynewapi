package deepseek

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

func sanitizeDeepSeekOpenAIRequest(request *dto.GeneralOpenAIRequest) {
	if request == nil {
		return
	}
	for i := range request.Messages {
		request.Messages[i].SetStringContent(deepSeekContentToText(request.Messages[i].Content))
	}
}

func deepSeekContentToText(content any) string {
	switch v := content.(type) {
	case nil:
		return ""
	case string:
		return v
	case []dto.MediaContent:
		return deepSeekMediaPartsToText(v)
	case []any:
		msg := dto.Message{Content: v}
		parts := msg.ParseContent()
		if len(parts) > 0 {
			return deepSeekMediaPartsToText(parts)
		}
		return compactJSONOrSprint(v)
	default:
		return compactJSONOrSprint(v)
	}
}

func deepSeekMediaPartsToText(parts []dto.MediaContent) string {
	var b strings.Builder
	omitted := 0
	for _, part := range parts {
		switch part.Type {
		case dto.ContentTypeText, "input_text", "output_text":
			if part.Text != "" {
				if b.Len() > 0 {
					b.WriteString("\n")
				}
				b.WriteString(part.Text)
			}
		case dto.ContentTypeImageURL, "input_image":
			omitted++
			writeOmittedMediaMarker(&b, "image")
		case dto.ContentTypeFile, "input_file":
			omitted++
			writeOmittedMediaMarker(&b, "file")
		case dto.ContentTypeInputAudio:
			omitted++
			writeOmittedMediaMarker(&b, "audio")
		case dto.ContentTypeVideoUrl:
			omitted++
			writeOmittedMediaMarker(&b, "video")
		default:
			if part.Text != "" {
				if b.Len() > 0 {
					b.WriteString("\n")
				}
				b.WriteString(part.Text)
			}
		}
	}
	if strings.TrimSpace(b.String()) == "" && omitted > 0 {
		return "[Non-text content omitted: DeepSeek text models do not support multimodal input.]"
	}
	return b.String()
}

func writeOmittedMediaMarker(b *strings.Builder, kind string) {
	if b.Len() > 0 {
		b.WriteString("\n")
	}
	b.WriteString("[")
	b.WriteString(kind)
	b.WriteString(" omitted: DeepSeek text models do not support multimodal input.]")
}

func compactJSONOrSprint(v any) string {
	body, err := common.Marshal(v)
	if err != nil || len(body) == 0 {
		return fmt.Sprint(v)
	}
	return string(body)
}
