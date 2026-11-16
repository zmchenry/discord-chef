// The Chef mark: a chef's hat on terracotta. One source for every icon size.
// Colours are the light-theme --color-primary and --color-bg from
// src/styles/tokens.css (icons are raster assets, so they cannot read tokens).
export const PRIMARY = "#9a3412";
export const CREAM = "#fbf5ec";

// `rounded` gives the favicon / "any" icon its rounded square. Without it the
// background bleeds to the edge for maskable and Apple icons, which the OS
// crops itself. The hat sits inside the maskable safe zone (a centred circle
// of radius 40% of the canvas) either way.
export function iconSvg({ rounded }) {
  const bg = rounded
    ? `<rect width="512" height="512" rx="112" fill="${PRIMARY}"/>`
    : `<rect width="512" height="512" fill="${PRIMARY}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${bg}
  <g fill="${CREAM}">
    <circle cx="190" cy="222" r="74"/>
    <circle cx="322" cy="222" r="74"/>
    <circle cx="256" cy="178" r="90"/>
    <rect x="180" y="214" width="152" height="118" rx="10"/>
    <rect x="172" y="344" width="168" height="44" rx="14"/>
  </g>
  <g fill="${PRIMARY}" opacity="0.9">
    <rect x="220" y="262" width="12" height="70" rx="6"/>
    <rect x="280" y="262" width="12" height="70" rx="6"/>
  </g>
</svg>
`;
}
