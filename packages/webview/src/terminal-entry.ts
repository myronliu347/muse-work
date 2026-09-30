/**
 * Desktop-only terminal chunk entry. Built as a separate IIFE bundle
 * (dist/terminal.js, global `window.MuseTerminal`) and lazy-injected by
 * TerminalPane only on the desktop host, so xterm stays out of the main
 * webview bundle.
 */
import "@xterm/xterm/css/xterm.css";

export { Terminal } from "@xterm/xterm";
export { FitAddon } from "@xterm/addon-fit";
export { WebLinksAddon } from "@xterm/addon-web-links";
