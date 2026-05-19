import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeTabs } from "@/components/code-tabs";
import { AlertTriangle, Terminal, Sparkles, Zap, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Docs — Toplenged AI",
  description:
    "OpenAI-compatible API, Codex CLI relay, Anthropic Messages — drop-in replacement for OpenAI and Claude.",
};

const BASE_URL = "https://api.toplenged.com";

export default function DocsPage() {
  return (
    <div className="container py-10 lg:py-12 max-w-4xl space-y-12">
      {/* Hero */}
      <header className="space-y-3">
        <Badge variant="info">Quickstart · OpenAI-compatible</Badge>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          One endpoint, 40+ models, 100% OpenAI SDK compatible
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Replace <code className="font-mono text-sm">api.openai.com</code> with{" "}
          <code className="font-mono text-sm">{new URL(BASE_URL).host}</code> — keep your code, swap your key.
          Works with OpenAI Python/Node SDK, Anthropic SDK, Codex CLI, LangChain, LlamaIndex.
        </p>

        {/* TOC */}
        <nav className="flex flex-wrap gap-2 pt-3">
          {[
            ["#quickstart", "Quickstart"],
            ["#codex-cli", "Codex CLI"],
            ["#anthropic", "Anthropic SDK"],
            ["#streaming", "Streaming · Tools · Vision"],
            ["#endpoints", "Endpoints"],
            ["#errors", "Errors & limits"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="text-xs px-2.5 py-1 rounded-md border bg-background hover:bg-accent transition"
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>

      {/* Step 1: get key */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <span className="text-muted-foreground text-base">1.</span> Get an API key
        </h2>
        <p className="text-sm text-muted-foreground">
          Generate one from the{" "}
          <Link href="/api-keys" className="underline">
            API keys page
          </Link>
          . Keys start with <code className="font-mono text-xs">sk-</code>. Store as an env var, never commit
          to git.
        </p>
        <CodeTabs
          samples={[
            {
              label: "bash / zsh",
              code: `export TOPLENGED_KEY="sk-xxxxxxxxxxxxxxxx"`,
            },
            {
              label: "PowerShell (Windows)",
              code: `[Environment]::SetEnvironmentVariable("TOPLENGED_KEY", "sk-xxxxxxxxxxxxxxxx", "User")
# Restart your shell after this`,
            },
            {
              label: ".env (dotenv)",
              code: `TOPLENGED_KEY=sk-xxxxxxxxxxxxxxxx`,
            },
          ]}
        />
      </section>

      {/* Step 2: first call */}
      <section id="quickstart" className="space-y-3 scroll-mt-20">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <span className="text-muted-foreground text-base">2.</span> Make your first call
        </h2>
        <p className="text-sm text-muted-foreground">
          The standard OpenAI <code className="font-mono text-xs">/v1/chat/completions</code> contract — all
          SDKs work out of the box.
        </p>

        <CodeTabs
          samples={[
            {
              label: "cURL",
              code: `curl ${BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer $TOPLENGED_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Say hi in 5 words"}]
  }'`,
            },
            {
              label: "Python · openai",
              code: `# pip install openai
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["TOPLENGED_KEY"],
    base_url="${BASE_URL}/v1",
)

resp = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Say hi in 5 words"}],
)
print(resp.choices[0].message.content)`,
            },
            {
              label: "Node · openai",
              code: `// npm i openai
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.TOPLENGED_KEY,
  baseURL: "${BASE_URL}/v1",
});

const resp = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Say hi in 5 words" }],
});

console.log(resp.choices[0].message.content);`,
            },
            {
              label: "Python · streaming",
              code: `for chunk in client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Write a haiku about debugging"}],
    stream=True,
):
    print(chunk.choices[0].delta.content or "", end="", flush=True)`,
            },
          ]}
        />
      </section>

      {/* Codex CLI — 核心引流章节 */}
      <section id="codex-cli" className="space-y-4 scroll-mt-20">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-brand" />
          <h2 className="text-xl font-semibold">Use with OpenAI Codex CLI</h2>
          <Badge variant="info">Popular</Badge>
        </div>

        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 flex gap-3 text-sm">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">Seeing "deactivated_workspace" / 402 Payment Required in Codex?</p>
              <p className="text-muted-foreground">
                That error means your ChatGPT Plus/Team workspace has been disabled by OpenAI (most common
                for users on Chinese IPs or shared accounts). The fix below switches Codex from ChatGPT
                subscription mode to API-key mode — pointing at Toplenged so your existing CLI keeps working.
              </p>
            </div>
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          The Codex CLI uses the OpenAI <code className="font-mono text-xs">/v1/responses</code> endpoint
          (fully supported here). Configure once and every <code className="font-mono text-xs">codex</code>{" "}
          invocation will go through Toplenged.
        </p>

        <h3 className="text-base font-semibold pt-2">Option A · Environment variables (recommended)</h3>
        <CodeTabs
          samples={[
            {
              label: "macOS / Linux",
              code: `# 1. Sign out of ChatGPT mode (if previously logged in)
codex logout 2>/dev/null || rm -f ~/.codex/auth.json

# 2. Point Codex at Toplenged
export OPENAI_API_KEY="$TOPLENGED_KEY"
export OPENAI_BASE_URL="${BASE_URL}/v1"

# 3. Run as usual — now hitting Toplenged instead of chatgpt.com
codex`,
            },
            {
              label: "Windows · PowerShell",
              code: `# 1. Sign out of ChatGPT mode
codex logout 2>$null
Remove-Item "$env:USERPROFILE\\.codex\\auth.json" -ErrorAction SilentlyContinue

# 2. Set permanent env vars (User scope)
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "sk-xxxxxxxxxxxxxxxx", "User")
[Environment]::SetEnvironmentVariable("OPENAI_BASE_URL", "${BASE_URL}/v1", "User")

# 3. Restart PowerShell, then:
codex`,
            },
            {
              label: "Windows · cmd.exe",
              code: `:: Temporary (current session only)
set OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
set OPENAI_BASE_URL=${BASE_URL}/v1

:: Permanent
setx OPENAI_API_KEY "sk-xxxxxxxxxxxxxxxx"
setx OPENAI_BASE_URL "${BASE_URL}/v1"

:: Restart cmd, then:
codex`,
            },
          ]}
        />

        <h3 className="text-base font-semibold pt-3">Option B · Config file (persistent, multi-provider)</h3>
        <p className="text-sm text-muted-foreground">
          Edit <code className="font-mono text-xs">~/.codex/config.toml</code> (
          <code className="font-mono text-xs">%USERPROFILE%\\.codex\\config.toml</code> on Windows):
        </p>
        <CodeTabs
          samples={[
            {
              label: "~/.codex/config.toml",
              code: `model = "gpt-5-codex"
model_provider = "toplenged"

[model_providers.toplenged]
name = "Toplenged"
base_url = "${BASE_URL}/v1"
wire_api = "responses"`,
            },
            {
              label: "Test it",
              code: `codex --version
# Inside Codex:
"explain this codebase"
"refactor utils.go to use generics"
"why is this test failing?"`,
            },
          ]}
        />

        <Card className="bg-muted/30">
          <CardContent className="p-4 text-xs space-y-2">
            <p className="font-medium flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> What changes after the switch
            </p>
            <ul className="text-muted-foreground space-y-1 ml-5 list-disc">
              <li>
                URL: <code className="font-mono">wss://chatgpt.com/backend-api/codex/responses</code> →{" "}
                <code className="font-mono">{new URL(BASE_URL).host}/v1/responses</code>
              </li>
              <li>Billing: ChatGPT Plus/Team flat fee → per-token from your Toplenged balance</li>
              <li>No more "workspace deactivated" errors — your access depends only on your balance</li>
              <li>Same Codex commands, same models (gpt-5-codex, gpt-4o, etc.)</li>
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* Anthropic */}
      <section id="anthropic" className="space-y-3 scroll-mt-20">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand" /> Anthropic Messages API
        </h2>
        <p className="text-sm text-muted-foreground">
          Use Claude models via Anthropic's native{" "}
          <code className="font-mono text-xs">/v1/messages</code> endpoint, or via the OpenAI-compatible{" "}
          <code className="font-mono text-xs">/v1/chat/completions</code>.
        </p>
        <CodeTabs
          samples={[
            {
              label: "Python · anthropic SDK",
              code: `# pip install anthropic
import os
from anthropic import Anthropic

client = Anthropic(
    api_key=os.environ["TOPLENGED_KEY"],
    base_url="${BASE_URL}",
)

msg = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(msg.content[0].text)`,
            },
            {
              label: "cURL",
              code: `curl ${BASE_URL}/v1/messages \\
  -H "x-api-key: $TOPLENGED_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
            },
          ]}
        />
      </section>

      {/* Streaming / tools / vision */}
      <section id="streaming" className="space-y-3 scroll-mt-20">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5 text-brand" /> Streaming · Tools · Vision
        </h2>
        <p className="text-sm text-muted-foreground">
          All standard OpenAI chat-completion features are supported transparently:
        </p>
        <ul className="text-sm grid sm:grid-cols-2 gap-2 ml-1">
          {[
            ["stream: true", "Server-Sent Events streaming"],
            ["tools / tool_choice", "Function calling"],
            ["response_format", "JSON mode / structured outputs"],
            ["image_url / vision", "GPT-4o, Claude 3.5, Gemini vision"],
            ["logprobs", "Log probability outputs"],
            ["n / temperature / top_p", "All standard params"],
          ].map(([k, v]) => (
            <li key={k} className="flex items-start gap-2 text-sm">
              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted shrink-0">{k}</span>
              <span className="text-muted-foreground text-xs pt-0.5">{v}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Endpoints */}
      <section id="endpoints" className="space-y-3 scroll-mt-20">
        <h2 className="text-xl font-semibold">Endpoints reference</h2>
        <div className="rounded-lg border divide-y text-sm overflow-hidden">
          {[
            ["POST", "/v1/chat/completions", "OpenAI chat completions (most SDKs use this)"],
            ["POST", "/v1/responses", "OpenAI Responses API (Codex CLI, gpt-5-codex)"],
            ["POST", "/v1/messages", "Anthropic Messages API (claude-sonnet, claude-opus)"],
            ["POST", "/v1/embeddings", "Text embeddings (text-embedding-3-*)"],
            ["POST", "/v1/images/generations", "Image generation (gpt-image, dall-e, gemini)"],
            ["POST", "/v1/audio/speech", "Text-to-speech (tts-1, tts-1-hd)"],
            ["POST", "/v1/audio/transcriptions", "Speech-to-text (whisper-1)"],
            ["GET", "/v1/models", "List models available to your key"],
          ].map(([method, path, desc]) => (
            <div key={path} className="flex items-center gap-4 p-3 hover:bg-accent/40">
              <Badge variant="outline" className="font-mono w-14 justify-center text-[10px]">
                {method}
              </Badge>
              <code className="font-mono text-xs flex-1 truncate">{path}</code>
              <span className="text-muted-foreground text-xs hidden sm:inline">{desc}</span>
            </div>
          ))}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/models">See available models →</Link>
        </Button>
      </section>

      {/* Errors */}
      <section id="errors" className="space-y-3 scroll-mt-20">
        <h2 className="text-xl font-semibold">Errors & rate limits</h2>
        <div className="rounded-lg border divide-y text-sm">
          {[
            ["401", "Invalid or missing API key", "Check Authorization header and key in /api-keys"],
            ["402", "Insufficient balance", "Top up at /top-up — pay-as-you-go, no expiry"],
            ["404", "Model not found / route", "Check spelling against /v1/models response"],
            ["429", "Rate limit exceeded", "Slow down or contact us for a higher tier"],
            ["500/502", "Upstream provider error", "Auto-retry kicks in; reach out if persistent"],
          ].map(([code, title, hint]) => (
            <div key={code} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <Badge variant="outline" className="font-mono w-14 justify-center text-[10px] shrink-0">
                {code}
              </Badge>
              <span className="font-medium text-sm">{title}</span>
              <span className="text-muted-foreground text-xs sm:ml-auto">{hint}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="pt-4 border-t">
        <Card className="bg-brand/5 border-brand/30">
          <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="font-semibold">Ready to start?</p>
              <p className="text-sm text-muted-foreground">
                Sign up free and get your first API key in under a minute.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button asChild>
                <Link href="/signup">Create account</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/api-keys">Get a key</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
