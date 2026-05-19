import { MODELS } from "@/lib/constants";

export function ModelsGrid() {
  return (
    <section id="models" className="relative py-24 sm:py-32">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold tracking-wider uppercase text-brand-300">
            Models
          </p>
          <h2 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight text-white [text-wrap:balance]">
            主流模型，开箱即用
          </h2>
          <p className="mt-4 text-lg text-ink-300 [text-wrap:balance]">
            一个 API Key 调用 OpenAI、Anthropic、Google、DeepSeek、阿里、月之暗面等所有顶级模型。
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODELS.map((m) => (
            <div
              key={m.family}
              className="group relative overflow-hidden rounded-2xl border border-white/10 p-6 transition-all hover:border-white/20"
            >
              <div
                className={`absolute inset-0 -z-10 bg-gradient-to-br ${m.color}`}
              />
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-semibold ${m.accent}`}>
                  {m.family}
                </h3>
                <span className="text-xs text-ink-400">
                  {m.items.length} models
                </span>
              </div>
              <ul className="mt-4 space-y-1.5">
                {m.items.map((model) => (
                  <li
                    key={model}
                    className="font-mono text-sm text-ink-200 group-hover:text-white transition-colors"
                  >
                    {model}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-ink-400">
          完整模型列表请查看{" "}
          <a
            href="/docs"
            className="text-brand-300 hover:text-brand-200 underline-offset-4 hover:underline"
          >
            模型目录
          </a>
        </p>
      </div>
    </section>
  );
}
