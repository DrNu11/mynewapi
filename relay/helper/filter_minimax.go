package helper

import "strings"

// filterMinimaxTags removes MiniMax-specific XML tags from streaming responses
// to avoid exposing the upstream provider identity to customers.
func filterMinimaxTags(data string) string {
	data = strings.ReplaceAll(data, "<minimax:tool_call>", "")
	data = strings.ReplaceAll(data, "</minimax:tool_call>", "")
	data = strings.ReplaceAll(data, "<minimax:", "<")
	data = strings.ReplaceAll(data, "</minimax:", "</")
	return data
}
