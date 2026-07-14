package common

import (
	"strings"
	"testing"
)

func TestBuildEmailVerificationMessage(t *testing.T) {
	subject, body := BuildEmailVerificationMessage("NassaAPI", "78ba6f", 10)

	if subject != "【NassaAPI】🔐 您的邮箱验证码" {
		t.Fatalf("unexpected subject: %q", subject)
	}

	for _, want := range []string{
		"<!doctype html>",
		`<meta name="viewport"`,
		"验证您的邮箱",
		"👋 您好",
		"78ba6f",
		"10 分钟",
		"安全提醒",
		"系统自动发送",
		"</html>",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("email body missing %q", want)
		}
	}

	for _, forbidden := range []string{"<script", "<img", "http://", "https://", "%!"} {
		if strings.Contains(strings.ToLower(body), forbidden) {
			t.Errorf("email body contains deliverability risk %q", forbidden)
		}
	}
}

func TestBuildEmailVerificationMessageEscapesDynamicContent(t *testing.T) {
	subject, body := BuildEmailVerificationMessage("Nassa<script>", "12<34", 10)

	if subject != "【Nassa<script>】🔐 您的邮箱验证码" {
		t.Fatalf("unexpected plain-text subject: %q", subject)
	}

	for _, want := range []string{"Nassa&lt;script&gt;", "12&lt;34"} {
		if !strings.Contains(body, want) {
			t.Errorf("email body missing escaped value %q", want)
		}
	}
	if strings.Contains(body, "<script>") {
		t.Fatal("email body contains unescaped dynamic HTML")
	}
}

func TestBuildEmailVerificationMessageKeepsPreviewTextHidden(t *testing.T) {
	_, body := BuildEmailVerificationMessage("NassaAPI", "ABC123", 10)

	for _, want := range []string{
		"display:none",
		"max-height:0",
		"验证码将在 10 分钟后失效",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("email preheader missing %q", want)
		}
	}
}
