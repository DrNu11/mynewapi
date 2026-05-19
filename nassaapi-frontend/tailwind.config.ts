import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dde9ff",
          200: "#bcd1ff",
          300: "#8eafff",
          400: "#5b85ff",
          500: "#3b5fff",
          600: "#2540f5",
          700: "#1d31de",
          800: "#1c2cb1",
          900: "#1d2b8b",
          950: "#141a51",
        },
        ink: {
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#dadfe7",
          300: "#b9c2cf",
          400: "#929fb0",
          500: "#748194",
          600: "#5d6878",
          700: "#4b5462",
          800: "#404853",
          900: "#383f48",
          950: "#0b0d12",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(to right, rgba(148,163,184,.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,.07) 1px, transparent 1px)",
        "hero-glow":
          "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(91,133,255,.30), transparent 60%)",
      },
      animation: {
        "fade-in-up": "fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) both",
        "fade-in": "fadeIn 0.6s ease-out both",
        shimmer: "shimmer 2.5s linear infinite",
      },
      keyframes: {
        fadeInUp: {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        shimmer: {
          from: { backgroundPosition: "0 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
