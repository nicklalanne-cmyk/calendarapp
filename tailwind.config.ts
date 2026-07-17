import type { Config } from "tailwindcss";

const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: rgb("--bg"),
        surface: rgb("--surface"),
        surface2: rgb("--surface-2"),
        surface3: rgb("--surface-3"),
        border: rgb("--border"),
        accent: rgb("--accent"),
        accentSoft: rgb("--accent-soft"),
        txt: rgb("--txt"),
        txt2: rgb("--txt-2"),
        txt3: rgb("--txt-3"),
        success: rgb("--success"),
        danger: rgb("--danger"),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
