package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// 覆盖 dataDir 的取值：当 /data 存在时返回 /data，否则返回当前工作目录。
// 测试中我们不想真的写 /data，因此通过临时目录覆盖当前工作目录不可行（Getwd 只读），
// 这里改为直接调用 persistVideoLocally 并临时把 /data 隐藏不现实——
// 所以用本地 httptest 服务 + 传入一个"假 /data 已存在"的前提，验证下载落盘逻辑本身。

func TestPersistVideoLocally(t *testing.T) {
	InitHttpClient()

	// 用一个本地 HTTP 服务模拟上游视频 URL
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write([]byte("fake-video-binary-data"))
	}))
	defer srv.Close()

	// persistVideoLocally 写到 dataDir()/videos/<taskID>.mp4。
	// 为避免污染真实 /data，临时用环境无法改变 Getwd，因此我们只验证：
	// 1. 返回 true（下载成功）
	// 2. 在 dataDir()/videos 下确实生成了文件且内容正确
	ok := persistVideoLocally(context.Background(), "test-task-abc", srv.URL)
	if !ok {
		t.Fatal("persistVideoLocally returned false for a valid upstream")
	}

	dir := filepath.Join(dataDir(), "videos")
	dst := filepath.Join(dir, "test-task-abc.mp4")
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("expected file %s to exist: %v", dst, err)
	}
	if string(got) != "fake-video-binary-data" {
		t.Fatalf("unexpected content: %q", got)
	}
	_ = os.Remove(dst)
}

func TestPersistVideoLocallyNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gone", http.StatusGone)
	}))
	defer srv.Close()

	if ok := persistVideoLocally(context.Background(), "test-task-404", srv.URL); ok {
		t.Fatal("expected false when upstream returns non-200")
	}
}

func TestPersistVideoLocallyBadURL(t *testing.T) {
	if ok := persistVideoLocally(context.Background(), "test-task-bad", "http://127.0.0.1:1/nonexistent"); ok {
		t.Fatal("expected false for unreachable URL")
	}
}
