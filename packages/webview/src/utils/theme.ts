/**
 * Dark theme detection for the desktop host.
 * - The host sets vscode-dark / vscode-light / vscode-high-contrast(-light)
 *   classes on <body>.
 * - The desktop preload sets <html data-theme="dark|light"> based on the in-app
 *   system/light/dark preference.
 */
export const isDarkTheme = (): boolean => {
  const dataTheme = document.documentElement.getAttribute("data-theme");
  if (dataTheme === "dark") return true;
  if (dataTheme === "light") return false;

  const bodyClass = document.body?.classList;
  if (
    bodyClass?.contains("vscode-dark") ||
    bodyClass?.contains("vscode-high-contrast")
  ) {
    return true;
  }
  if (
    bodyClass?.contains("vscode-light") ||
    bodyClass?.contains("vscode-high-contrast-light")
  ) {
    return false;
  }
  return false;
};
