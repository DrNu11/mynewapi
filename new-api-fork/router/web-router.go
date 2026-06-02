package router

import (
	"embed"
	"net/http"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
)

const frontendEntryCacheBust = "20260601fix2"

var frontendEntryScriptRE = regexp.MustCompile(`src="(/assets/index-[^"]+\.js)"`)

// ThemeAssets holds the embedded frontend assets for both themes.
type ThemeAssets struct {
	DefaultBuildFS   embed.FS
	DefaultIndexPage []byte
	ClassicBuildFS   embed.FS
	ClassicIndexPage []byte
}

func cacheBustedIndexPage(page []byte) []byte {
	return frontendEntryScriptRE.ReplaceAll(page, []byte(`src="$1?v=`+frontendEntryCacheBust+`"`))
}

func serveIndexPage(c *gin.Context, assets ThemeAssets) {
	c.Header("Cache-Control", "no-cache")
	if common.GetTheme() == "classic" {
		c.Data(http.StatusOK, "text/html; charset=utf-8", cacheBustedIndexPage(assets.ClassicIndexPage))
	} else {
		c.Data(http.StatusOK, "text/html; charset=utf-8", cacheBustedIndexPage(assets.DefaultIndexPage))
	}
}

func isFrontendRoute(path string) bool {
	if path == "/" {
		return true
	}
	if strings.HasPrefix(path, "/v1") || strings.HasPrefix(path, "/api") || strings.HasPrefix(path, "/assets") {
		return false
	}
	return !strings.Contains(path[strings.LastIndex(path, "/")+1:], ".")
}

func SetWebRouter(router *gin.Engine, assets ThemeAssets) {
	defaultFS := common.EmbedFolder(assets.DefaultBuildFS, "web/default/dist")
	classicFS := common.EmbedFolder(assets.ClassicBuildFS, "web/classic/dist")
	themeFS := common.NewThemeAwareFS(defaultFS, classicFS)

	router.Use(gzip.Gzip(gzip.DefaultCompression))
	router.Use(middleware.GlobalWebRateLimit())
	router.Use(middleware.Cache())
	router.Use(func(c *gin.Context) {
		if (c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead) && isFrontendRoute(c.Request.URL.Path) {
			c.Set(middleware.RouteTagKey, "web")
			serveIndexPage(c, assets)
			c.Abort()
			return
		}
		c.Next()
	})
	router.Use(static.Serve("/", themeFS))
	router.NoRoute(func(c *gin.Context) {
		c.Set(middleware.RouteTagKey, "web")
		if strings.HasPrefix(c.Request.RequestURI, "/v1") || strings.HasPrefix(c.Request.RequestURI, "/api") || strings.HasPrefix(c.Request.RequestURI, "/assets") {
			controller.RelayNotFound(c)
			return
		}
		serveIndexPage(c, assets)
	})
}
