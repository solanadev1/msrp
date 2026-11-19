/** Public surface of the UI layer. Pure rendering: data in, HTML/SVG strings out. */
export {
  renderHome,
  renderSticker,
  renderPrinting,
  renderMethodology,
  renderPricing,
  renderAbout,
  renderNotFound,
  renderError,
  PRINT_STEPS,
} from "./pages";
export { renderBadgeSvg } from "./badge";
export { renderOgSvg, renderOgDefaultSvg } from "./og";
export { renderStickerBody, shareText, coinTitle } from "./sticker";
export { esc, escAttr, cleanText, cleanLabel, safeUrl, isAddress, isSignature } from "./escape";
export { paths, external, abs } from "./paths";
