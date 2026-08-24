/**
 * hostBridge was split into hostBridge/ (ctx/utils + session/desktop/auth/
 * chat/tasks/confirm domain modules). This file keeps the original module path
 * and export surface so existing importers (ChatApp, settings, tests) are
 * untouched.
 */
export * from "./hostBridge/index.js";
