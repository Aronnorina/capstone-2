/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./index.html",
    "./tracking.html",
    "./fleet.html",
    "./wallet.html",
    "./checkout.html",
    "./login.html",
    "./account.html",
    "./support.html"
  ],
  theme: {
    extend: {
      colors: {
        "outline-variant": "#603e39",
        "on-background": "#e5e2e1",
        "on-tertiary": "#4b007e",
        "inverse-surface": "#e5e2e1",
        "on-tertiary-fixed-variant": "#6b00b0",
        "surface-variant": "#353534",
        "surface-tint": "#ffb4a8",
        "secondary": "#d3fbff",
        "inverse-on-surface": "#313030",
        "on-secondary-fixed-variant": "#004f54",
        "on-primary": "#690100",
        "tertiary": "#dfb7ff",
        "primary-fixed-dim": "#ffb4a8",
        "on-error-container": "#ffdad6",
        "on-tertiary-container": "#41006f",
        "surface-container": "#201f1f",
        "primary": "#ffb4a8",
        "primary-container": "#ff5540",
        "on-primary-container": "#5c0000",
        "on-primary-fixed": "#410000",
        "error-container": "#93000a",
        "on-surface": "#e5e2e1",
        "error": "#ffb4ab",
        "tertiary-container": "#ba6bff",
        "surface-bright": "#3a3939",
        "secondary-fixed-dim": "#00dbe9",
        "on-secondary-container": "#00686f",
        "primary-fixed": "#ffdad4",
        "on-tertiary-fixed": "#2d004f",
        "tertiary-fixed": "#f1daff",
        "on-secondary": "#00363a",
        "secondary-container": "#00eefc",
        "surface-container-low": "#1c1b1b",
        "on-error": "#690005",
        "surface-container-lowest": "#0e0e0e",
        "surface-container-high": "#2a2a2a",
        "surface-dim": "#131313",
        "on-surface-variant": "#ebbbb4",
        "tertiary-fixed-dim": "#dfb7ff",
        "surface": "#131313",
        "secondary-fixed": "#7df4ff",
        "surface-container-highest": "#353534",
        "on-secondary-fixed": "#002022",
        "inverse-primary": "#c00100",
        "background": "#131313",
        "outline": "#b18780",
        "on-primary-fixed-variant": "#930100"
      },
      borderRadius: { DEFAULT: "0.25rem", lg: "0.5rem", xl: "0.75rem", full: "9999px" },
      spacing: {
        "margin-mobile": "16px",
        "gutter": "24px",
        "unit": "4px",
        "container-max": "1440px",
        "margin-desktop": "64px"
      },
      fontFamily: {
        "label-mono": ["JetBrains Mono"],
        "headline-lg-mobile": ["Space Grotesk"],
        "body-md": ["Geist"],
        "display-lg": ["Space Grotesk"],
        "headline-lg": ["Space Grotesk"]
      },
      fontSize: {
        "label-mono": ["12px", { lineHeight: "16px", fontWeight: "500" }],
        "headline-lg-mobile": ["24px", { lineHeight: "32px", fontWeight: "700" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "display-lg": ["48px", { lineHeight: "56px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-lg": ["32px", { lineHeight: "40px", letterSpacing: "0.05em", fontWeight: "700" }]
      }
    }
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/container-queries")
  ]
}